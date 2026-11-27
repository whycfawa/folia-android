import { CapacitorHttp } from '@capacitor/core';
import { DualTheme } from "../types";
import {
  AI_CLIENT_GEMINI_MODEL,
  DEFAULT_AI_CLIENT_MODEL,
  DEFAULT_AI_CLIENT_TEMPERATURE,
  aiClientApiKeyOf,
  isDirectAiTextRuntime,
  useAiClientSettingsStore,
} from '../stores/useAiClientSettingsStore';
import { THEME_GENERATION_PROMPT_PREFIX, buildThemeSourcePrompt, parseAiThemeJsonInput } from '../utils/aiThemePrompts';
import { DEFAULT_OPENAI_CHAT_COMPLETIONS_URL, geminiGenerateContentUrl } from '../utils/openAIEndpoint';
import { applyStoredAnimationIntensityToDualTheme } from "./themePreferences";
import { sanitizeDualTheme } from "./themeSanitizer";
import { getWebAiProvider, type WebAiProvider } from "./runtimeConfig";
import { segmentLyricLines } from '../../shared/lyricSegmentationService.mjs';
import { getAiAdapter, resolveAiConnection } from '../../shared/ai/providerRegistry.mjs';
export {
  AI_PROVIDER_PRESETS,
  inferAiProviderFromUrl,
  modelAlwaysThinks,
  resolveAiConnection,
  resolveAiProviderPreset,
  retiredModelHint,
} from '../../shared/ai/providerRegistry.mjs';

// src/services/aiText.ts

/**
 * The window's one way out to the AI text services (Gemini, OpenAI and OpenAI-compatible hosts).
 * The app asks them for three things: a theme made from a song's lyrics, a segmentation of lyric
 * lines into words, and the connection test of the settings form. This file is the only place in
 * src/ that knows how those asks leave the window: the desktop bridge (window.electron's
 * generateTheme, segmentLyrics and testAiConnection) and our own web routes (/api/generate-theme,
 * /api/generate-theme_openai, /api/segment-lyrics).
 *
 * The window never sends a request to a service itself. The only key it handles is the one typed
 * into the settings form, which it hands to the main process to store or to test. On the desktop
 * the main process sends the request, with the service and the key from the user's settings
 * (electron/aiTextClient.cjs, behind the IPC handlers in electron/main.cjs). On the web our
 * serverless routes send it, with the deployment's key (worker/, and api-ts/ built into api/;
 * segmentation in shared/lyricSegmentationService.mjs). Which service the web build uses is the
 * deployment's choice, read by ./runtimeConfig.
 *
 * The Android shell has neither: the key typed in settings stays in the renderer
 * (useAiClientSettingsStore) and the request goes straight to the service through CapacitorHttp.
 *
 * It lives in src/services/ because the theme controller, the OBS overlay, the lyric segmentation
 * and the settings form all use it, and none of them owns it.
 *
 * The settings form also reads the provider registry through here (presets, sites, default and
 * retired models: shared/ai/providerRegistry.mjs), so no component imports shared/ai/ itself.
 */

/** Our web route for the theme ask, one per service. */
const THEME_ROUTES: Record<WebAiProvider, string> = {
  gemini: '/api/generate-theme',
  openai: '/api/generate-theme_openai',
};

/** Anything that is not a service of the table goes to Gemini's route. */
const themeRoute = (provider: WebAiProvider) => THEME_ROUTES[provider] ?? THEME_ROUTES.gemini;

/** Our web route for the segmentation ask. The route picks the service itself. */
const SEGMENTATION_ROUTE = '/api/segment-lyrics';

/**
 * 安卓壳里的分词：没有主进程桥，也没有部署的 /api/segment-lyrics，只有设置页里那把密钥。
 * 共用 shared/lyricSegmentationService.mjs（与 Vercel / Worker 同一份提示词与解析），
 * 网络出口换成原生 CapacitorHttp，避开 WebView 的 CORS。
 */
const bridgedAiFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => { headers[key] = value; });
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? {});
    const reply = await postDirectAiJson(url, headers, body);
    return new Response(reply.text, {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
    });
}) as typeof fetch;

const requestDirectLyricSegmentation = async (lines: string[]): Promise<unknown> => {
    const settings = useAiClientSettingsStore.getState().settings;
    const env = {
        AI_PROVIDER: settings.provider,
        OPENAI_API_KEY: settings.openaiApiKey,
        GEMINI_API_KEY: settings.geminiApiKey,
        OPENAI_API_URL: settings.openaiApiUrl,
        OPENAI_API_MODEL: settings.openaiApiModel,
        GEMINI_API_MODEL: AI_CLIENT_GEMINI_MODEL,
    };
    return await segmentLyricLines(lines, env, bridgedAiFetch);
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? '');
};

// ---------------------------------------------------------------------------
// 安卓壳直连：没有主进程也没有部署的 /api，密钥来自设置页（useAiClientSettingsStore），
// 请求在 WebView 里直接发；原生 CapacitorHttp 优先，避开浏览器 CORS。
// ---------------------------------------------------------------------------

const AI_DIRECT_TIMEOUT_MS = 120_000;
const DIRECT_AI_ERROR_PREFIX = 'AI direct request failed';

const missingDirectAiKeyError = () => new Error(
  'AI API key is not configured: add it in Appearance → AI theme settings.',
);

const resolveDirectAiKey = (savedKey: string): string => {
  const trimmed = savedKey.trim();
  if (!trimmed) throw missingDirectAiKeyError();
  return trimmed;
};

const parseJsonText = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const providerErrorOf = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return String((error as { message: string }).message);
  }
  return typeof record.message === 'string' ? record.message : '';
};

type DirectAiReply = { status: number; ok: boolean; text: string };

const postDirectAiJson = async (
  url: string,
  headers: Record<string, string>,
  body: unknown,
  method = 'POST',
  timeoutMs = AI_DIRECT_TIMEOUT_MS,
): Promise<DirectAiReply> => {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    // 原生外壳里先走 CapacitorHttp：WebView 的 CORS 策略对第三方 AI 接口不一定放行。
    if (typeof CapacitorHttp?.request === 'function') {
      const response = await CapacitorHttp.request({
        url,
        method,
        headers,
        data: body,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? ''),
      };
    }
    const response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller?.signal,
    });
    return { status: response.status, ok: response.ok, text: await response.text() };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new Error(`${DIRECT_AI_ERROR_PREFIX}: timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
};

/** OpenAI 兼容接口的 chat-completions 地址：与主进程的 normalizeOpenAIChatCompletionsUrl 同规则。 */
const directOpenAiChatCompletionsUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (!normalizedPath || normalizedPath === '/') {
      parsed.pathname = '/v1/chat/completions';
    } else if (/\/v\d+$/.test(normalizedPath)) {
      parsed.pathname = `${normalizedPath}/chat/completions`;
    } else {
      parsed.pathname = normalizedPath;
    }
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const directAiTemperature = (raw: string): number => {
  const parsed = Number.parseFloat(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : Number(DEFAULT_AI_CLIENT_TEMPERATURE);
};

const textOfOpenAiContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === 'object')
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => String(part.text))
    .join('');
};

const generateThemeWithDirectClient = async (
  lyricsText: string,
  options?: { isPureMusic?: boolean; songTitle?: string },
): Promise<DualTheme> => {
  const settings = useAiClientSettingsStore.getState().settings;
  const snippet = lyricsText.slice(0, 2000);
  const sourcePrompt = buildThemeSourcePrompt(snippet, options?.isPureMusic === true, options?.songTitle);
  const temperature = directAiTemperature(settings.openaiTemperature);
  let text = '';

  if (settings.provider === 'openai') {
    const key = resolveDirectAiKey(settings.openaiApiKey);
    const reply = await postDirectAiJson(
      directOpenAiChatCompletionsUrl(settings.openaiApiUrl),
      { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      {
        model: settings.openaiApiModel.trim() || DEFAULT_AI_CLIENT_MODEL,
        messages: [
          { role: 'system', content: THEME_GENERATION_PROMPT_PREFIX },
          { role: 'user', content: sourcePrompt },
        ],
        temperature,
        response_format: { type: 'json_object' },
      },
    );
    const payload = parseJsonText(reply.text);
    if (!reply.ok) {
      throw new Error(`${DIRECT_AI_ERROR_PREFIX} (${reply.status}): ${providerErrorOf(payload) || reply.text.slice(0, 300)}`);
    }
    text = textOfOpenAiContent((payload as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content);
  } else {
    const key = resolveDirectAiKey(settings.geminiApiKey);
    const reply = await postDirectAiJson(
      geminiGenerateContentUrl(AI_CLIENT_GEMINI_MODEL),
      { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      {
        systemInstruction: { parts: [{ text: THEME_GENERATION_PROMPT_PREFIX }] },
        contents: [{ role: 'user', parts: [{ text: sourcePrompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' },
      },
    );
    const payload = parseJsonText(reply.text);
    if (!reply.ok) {
      throw new Error(`${DIRECT_AI_ERROR_PREFIX} (${reply.status}): ${providerErrorOf(payload) || reply.text.slice(0, 300)}`);
    }
    const parts = (payload as { candidates?: { content?: { parts?: unknown } }[] } | null)?.candidates?.[0]?.content?.parts;
    text = Array.isArray(parts)
      ? parts
        .filter((part): part is { text?: unknown } => Boolean(part) && typeof part === 'object')
        .filter(part => typeof part.text === 'string')
        .map(part => String(part.text))
        .join('')
      : '';
  }

  if (!text.trim()) {
    throw new Error('The AI answered an empty theme; try again or switch models.');
  }
  return applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(parseAiThemeJsonInput(text) as DualTheme));
};

const testDirectAiConnection = async (payload: AiConnectionTestPayload): Promise<AiConnectionTestResult> => {
  const settings = useAiClientSettingsStore.getState().settings;
  const provider = payload.provider === 'openai' ? 'openai' : 'gemini';
  const typedKey = payload.apiKey.trim();
  const savedKey = aiClientApiKeyOf(settings, provider);
  const key = typedKey || savedKey;
  if (!key) {
    return { ok: false, durationMs: 0, errorKind: 'config', error: missingDirectAiKeyError().message };
  }
  const started = Date.now();
  const prompt = 'Reply with exactly one word: ok';
  try {
    if (provider === 'openai') {
      const reply = await postDirectAiJson(
        directOpenAiChatCompletionsUrl(payload.apiUrl ?? settings.openaiApiUrl),
        { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        {
          model: (payload.model ?? '').trim() || settings.openaiApiModel.trim() || DEFAULT_AI_CLIENT_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        },
      );
      const payloadJson = parseJsonText(reply.text);
      const text = textOfOpenAiContent((payloadJson as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content).trim();
      return reply.ok
        ? { ok: true, status: reply.status, durationMs: Date.now() - started, model: (payload.model ?? '').trim() || settings.openaiApiModel.trim(), text }
        : {
          ok: false,
          status: reply.status,
          durationMs: Date.now() - started,
          error: providerErrorOf(payloadJson) || reply.text.slice(0, 300) || `HTTP ${reply.status}`,
          errorKind: reply.status === 401 || reply.status === 403 ? 'invalid' : 'http',
        };
    }
    const reply = await postDirectAiJson(
      geminiGenerateContentUrl(AI_CLIENT_GEMINI_MODEL),
      { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } },
    );
    const payloadJson = parseJsonText(reply.text);
    const parts = (payloadJson as { candidates?: { content?: { parts?: unknown } }[] } | null)?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
        .filter((part): part is { text?: unknown } => Boolean(part) && typeof part === 'object')
        .filter(part => typeof part.text === 'string')
        .map(part => String(part.text))
        .join('')
        .trim()
      : '';
    return reply.ok
      ? { ok: true, status: reply.status, durationMs: Date.now() - started, model: AI_CLIENT_GEMINI_MODEL, text }
      : {
        ok: false,
        status: reply.status,
        durationMs: Date.now() - started,
        error: providerErrorOf(payloadJson) || reply.text.slice(0, 300) || `HTTP ${reply.status}`,
        errorKind: reply.status === 401 || reply.status === 403 ? 'invalid' : 'http',
      };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: message,
      errorKind: /timed out/i.test(message) ? 'timeout' : 'network',
    };
  }
};

/** What our web theme routes answer when the deployment has no key; they say it for nothing else. */
const WEB_ROUTE_WITHOUT_KEY = 'Server configuration error';

export const isMissingAiApiKeyError = (error: unknown) => {
  const message = getErrorMessage(error);
  return message === WEB_ROUTE_WITHOUT_KEY
    || (/(?:openai_api_key|gemini_api_key|api key)/i.test(message)
      && /(?:not configured|missing|configure)/i.test(message));
};

export const generateThemeFromLyrics = async (
  lyricsText: string,
  options?: { isPureMusic?: boolean; songTitle?: string }
): Promise<DualTheme> => {
  try {
    // Check if running in Electron environment
    if ((window as any).electron && typeof (window as any).electron.generateTheme === 'function') {
      const dualTheme = await (window as any).electron.generateTheme(lyricsText, options);
      return sanitizeDualTheme(dualTheme);
    }

    // 安卓壳：没有主进程、也没有部署的 /api，用设置页里的密钥直接问服务商。
    if (isDirectAiTextRuntime()) {
      return await generateThemeWithDirectClient(lyricsText, options);
    }

    const response = await fetch(themeRoute(getWebAiProvider()), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lyricsText, ...options }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate theme');
    }

    const dualTheme = await response.json();
    return applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme as DualTheme));
  } catch (error) {
    console.error("Failed to generate theme via API:", error);
    throw error;
  }
};

// The AI connection the web OBS overlay (Dynamic AI mode) generates a theme with. The overlay runs
// in a separate browser context, so it takes an explicit provider instead of reading anything from
// the app; the provider is selected by Docker runtime config or the Vite build fallback.
export interface ObsAiConfig {
  provider: WebAiProvider;
}

// OBS-overlay variant of generateThemeFromLyrics: keyless (the endpoint uses its own server env
// key), abortable, and with no Electron branch since the overlay is web-only. Used per song by the
// overlay; the caller falls back to the builtin theme if it rejects.
export const generateObsThemeFromLyrics = async (
  lyricsText: string,
  options: { isPureMusic?: boolean; songTitle?: string } | undefined,
  aiConfig: ObsAiConfig,
  signal?: AbortSignal,
): Promise<DualTheme> => {
  const response = await fetch(themeRoute(aiConfig.provider), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lyricsText, ...(options ?? {}) }),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error || 'Failed to generate theme');
  }

  const dualTheme = await response.json();
  return applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme as DualTheme));
};

type SegmentationBridge = {
  segmentLyrics?: (lines: string[]) => Promise<string[][]>;
};

const getSegmentationBridge = (): SegmentationBridge | null => {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { electron?: SegmentationBridge }).electron;
  return bridge && typeof bridge.segmentLyrics === 'function' ? bridge : null;
};

/** Whether an AI segmentation request can be made at all from this build. */
export const isLyricSegmentationAiAvailable = (): boolean => (
  typeof window !== 'undefined' && (Boolean(getSegmentationBridge()) || isDirectAiTextRuntime() || typeof fetch === 'function')
);

/**
 * One segmentation request: the desktop build goes through IPC so it can use the model the user
 * configured in settings, and the web build posts to the deployment's own route because its
 * credentials live server-side. Resolves to the rows as they were answered; checking them against
 * the lines is the caller's. `signal` only reaches the web path; ipcRenderer.invoke cannot be
 * cancelled.
 */
export const requestLyricSegmentation = async (lines: string[], signal?: AbortSignal): Promise<unknown> => {
  const bridge = getSegmentationBridge();
  if (bridge?.segmentLyrics) {
    return bridge.segmentLyrics(lines);
  }
  // 安卓壳：直连用户配置的模型（与「连接测试」同一条路），不再打本地根本没有的 /api 路由。
  if (isDirectAiTextRuntime()) {
    return requestDirectLyricSegmentation(lines);
  }

  const response = await fetch(SEGMENTATION_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || 'Failed to segment lyrics');
  }

  return (payload as { lines?: unknown }).lines;
};

/** Whether model discovery can run here: desktop's main process, or Android's direct client. */
export const canListAiModels = (): boolean => Boolean(window.electron?.listAiModels) || isDirectAiTextRuntime();

const DIRECT_MODEL_LIST_TIMEOUT_MS = 30_000;
const DIRECT_MODEL_MAX_PAGES = 20;
const DIRECT_MODEL_MAX_MODELS = 2000;
const DIRECT_MODEL_MAX_BODY_BYTES = 2_000_000;

/**
 * 安卓壳没有主进程的 `/models` 代理：这里用与 electron/ai/modelDiscovery.cjs 相同的适配器数据
 *（shared/ai 的 `models` 描述）和同样的限值，在 WebView 里直连服务商；密钥用设置页里这一份
 *（未保存时用刚输入的），网络出口仍是 CapacitorHttp，避开 CORS。
 *
 * 只取模型清单，不跟随服务端给的地址，正文有大小上限，回传的模型 id 与名字都剥掉密钥，
 * 失败时把适配器的 suggestedModels 一起带回去让设置页还能选。
 */
const fetchDirectAiModels = async (payload: AiConnectionTestPayload): Promise<AiModelListResult> => {
  const typedKey = payload.apiKey.trim();
  const settings = useAiClientSettingsStore.getState().settings;
  const provider = payload.provider === 'openai' ? 'openai' : 'gemini';
  const savedKey = aiClientApiKeyOf(settings, provider);
  const apiKey = typedKey || savedKey;
  if (!apiKey.trim()) return { ok: false, errorKind: 'config' };
  const connection = resolveAiConnection({
    AI_PROVIDER: provider,
    AI_PROVIDER_PRESET: payload.presetId,
    OPENAI_API_URL: payload.apiUrl ?? '',
    OPENAI_API_MODEL: payload.model ?? '',
    GEMINI_API_MODEL: payload.model ?? '',
  });
  const adapter = getAiAdapter(connection.adapterId);
  const catalogue = adapter?.models;
  const suggested = Array.isArray(adapter?.suggestedModels) && adapter.suggestedModels.length
    ? { suggestedModels: [...adapter.suggestedModels] } : {};
  const withSuggestions = (result: AiModelListResult): AiModelListResult => ({ ...result, ...suggested });
  if (!catalogue) return withSuggestions({ ok: false, errorKind: 'empty' });

  const url = new URL(
    adapter.protocol === 'gemini' ? adapter.endpoints[0].baseUrl
      : adapter.protocol === 'anthropic' ? (payload.apiUrl || 'https://api.anthropic.com/v1')
        : directOpenAiChatCompletionsUrl(payload.apiUrl ?? ''),
  );
  url.pathname = catalogue.path ?? url.pathname.replace(/\/(?:chat\/completions|messages|models)\/?$/, '') + '/models';
  for (const [name, value] of Object.entries(catalogue.query ?? {})) url.searchParams.set(name, value);
  const headers: Record<string, string> = adapter.protocol === 'gemini' ? { 'x-goog-api-key': apiKey }
    : adapter.protocol === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: 'Bearer ' + apiKey };
  const models = new Map<string, { id: string; name: string }>();
  const cursors = new Set<string>();
  const failure = (errorKind: AiModelListResult['errorKind'], status?: number): AiModelListResult => ({
    ok: false, errorKind, ...(status ? { status } : {}),
  });

  try {
    for (let page = 0; page < DIRECT_MODEL_MAX_PAGES; page += 1) {
      const reply = await postDirectAiJson(url.toString(), headers, undefined, 'GET', DIRECT_MODEL_LIST_TIMEOUT_MS);
      if (!reply.ok) return withSuggestions(failure(reply.status === 401 || reply.status === 403 ? 'auth' : 'http', reply.status));
      if (reply.text.length > DIRECT_MODEL_MAX_BODY_BYTES) return withSuggestions(failure('invalid'));
      const data = JSON.parse(reply.text);
      if (!data || typeof data !== 'object') return withSuggestions(failure('invalid'));
      const rows = catalogue.rows(data);
      if (!Array.isArray(rows)) return withSuggestions(failure('invalid'));
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const rawId = catalogue.id(row);
        const id = typeof rawId === 'string' ? rawId.replace(/^models\//, '').trim() : '';
        if (!id || id.length > 256 || /[\u0000-\u001f]/.test(id)) continue;
        if (!catalogue.keep(row, id) || id.includes(apiKey)) continue;
        const rawName = catalogue.name(row);
        const name = typeof rawName === 'string' ? rawName.split(apiKey).join('***').slice(0, 256) : id;
        models.set(id, { id, name });
        if (models.size > DIRECT_MODEL_MAX_MODELS) return withSuggestions(failure('invalid'));
      }
      const cursor = catalogue.next ? catalogue.next(data, rows, page) : null;
      if (!cursor) {
        return models.size ? { ok: true, models: [...models.values()] } : withSuggestions(failure('empty'));
      }
      if (typeof cursor.value !== 'string' || !cursor.value) return withSuggestions(failure('invalid'));
      url.searchParams.set(cursor.param, cursor.value);
      if (cursors.has(cursor.value) || page === DIRECT_MODEL_MAX_PAGES - 1) return withSuggestions(failure('invalid'));
      cursors.add(cursor.value);
    }
  } catch (error) {
    const kind = error instanceof Error && /timed out/.test(error.message) ? 'timeout'
      : error instanceof SyntaxError || error instanceof RangeError ? 'invalid' : 'network';
    return withSuggestions(failure(kind));
  }
  return withSuggestions(failure('invalid'));
};

/** Loads the current connection's models without exposing its saved key to the renderer. */
export const fetchAiModels = (payload: AiConnectionTestPayload): Promise<AiModelListResult> => (
  window.electron?.listAiModels
    ? window.electron.listAiModels(payload)
    : fetchDirectAiModels(payload)
);

/** Whether the connection test can run here. It is desktop only: there is no web route for it. */
/** Whether the connection test can run here. No web route exists for it: desktop bridge, or the Android shell's direct client. */
export const canRunAiConnectionTest = (): boolean => (
  Boolean(window.electron?.testAiConnection) || isDirectAiTextRuntime()
);

/**
 * Hands the unsaved values of the settings form to wherever the request can be sent from: the main
 * process on the desktop, the service itself in the Android shell (the key typed in the form is
 * the one it uses, so the test runs before anything is saved).
 */
export const runAiConnectionTest = (payload: AiConnectionTestPayload): Promise<AiConnectionTestResult> => {
  if (window.electron?.testAiConnection) {
    return window.electron.testAiConnection(payload);
  }
  return testDirectAiConnection(payload);
};
