// Android-only shim that makes the bundled Folia Bridge API modules believe they
// are running inside a browser extension while all privileged work is delegated
// to the native Capacitor plugin.

const PAGE_SOURCE = 'folia-web-page';
const BRIDGE_SOURCE = 'folia-extension-bridge';
const BRIDGE_VERSION = 'android-0.1.0';
// A hung upstream (one KuGou CDN node that never answers, say) would otherwise hold the page's
// request open until OkHttp's own 45s read timeout, which is long enough to look like a freeze.
// AI and image requests call the plugin directly and keep their own longer budgets.
const BRIDGED_REQUEST_TIMEOUT_MS = 15000;
// 长轮询端点（酷狗扫码状态）会一直挂到状态变化，15 秒必然被误杀：调用方可以在 fetch init 上
// 传 `foliaTimeoutMs` 单独放宽（只从我们自己的桥模块传，普通请求仍是 15 秒）。
const BRIDGED_REQUEST_MAX_TIMEOUT_MS = 120000;
// Cookie calls are millisecond work, but Capacitor can drop a reply (plugin exception,
// WebView reload) and the page-side bridge request has no timer of its own. Login waits on
// these calls, so a lost reply used to leave the QR modal parked on "waiting" after the
// phone had already reported success. Every shim call therefore settles within a budget.
const COOKIE_CALL_TIMEOUT_MS = 4000;
// 启动时各平台一起要 cookie：一次批量读要遍历多个目标，比单条慢，预算单独放宽。
const COOKIE_BATCH_TIMEOUT_MS = 8000;
// 读到的 cookie 复用多久。启动、登录、拉列表常常在几百毫秒内重复问同一批域。
const COOKIE_CACHE_TTL_MS = 1500;

const API_HOSTS = [
  'music.163.com',
  'interface.music.163.com',
  'interface3.music.163.com',
  'c.y.qq.com',
  'u.y.qq.com',
  'ssl.ptlogin2.qq.com',
  'xui.ptlogin2.qq.com',
  'graph.qq.com',
  // 微信扫码通道：qrconnect 取 uuid、qrcode 取图、lp 长轮询都在 weixin.qq.com 下。
  // 这三个请求同样只有走原生代理才能绕开 CORS，漏掉就会是 "Failed to fetch"。
  'weixin.qq.com',
  // KuGou spreads its API over many hosts (songsearch, complexsearch, trackercdn, vip, ...) and the
  // set keeps moving, so match the whole domain instead of listing hosts one by one. Only requests
  // that stay inside the WebView are subject to CORS; anything the bridge calls has to be proxied
  // here, which is why a missing host silently returns an empty result rather than an error.
  'kugou.com',
  'kuwo.cn',
  'api.qrserver.com',
  // 封面与头像。前端会为了封面缓存 / 预加载直接 fetch 这些 CDN（coverCache、playedTrackCache、
  // useLocalCoverPreloader 都是 `mode: 'cors'`），漏掉一个就是「封面永远缓存不上」且不报错。
  // 整域名匹配，网易云的 p1/p2/... 与酷狗的 c1/imge 等子域一并覆盖。
  // Spotify：登录后 Web API 走 /v1/*、图片与 30 秒试听走 CDN；不带进白名单就是跨域失败。
  'spotify.com',
  'spotifycdn.com',
  'scdn.co',
  'y.gtimg.cn',
  'qlogo.cn',
  '126.net',
  'kgimg.com',
  // QQ 门户：warmQQLoginCookies 先访问它让服务端下发 / 刷新 cookie（credentials: include），
  // 再读 cookie 罐。不在白名单时这一步被 CORS 挡掉、异常又被 catch 吞了，表现为「登录态时好时坏」。
  // i.y.qq.com 也在这个域名下。
  'y.qq.com',
  // QQ 的 QIMEI 设备指纹引导（参考实现的 android comm 带 QIMEI / QIMEI36，写接口尤其需要）。
  'api.tencentmusic.com',
  // Car SDK（LunaOpenSDK）的开放接口、二维码与媒体 CDN：漏掉一个就是跨域失败或封面/音频取不到。
  // 匹配整域名：open.qishui.com、open.douyin.com、open-client.douyin.com 都在下面。
  'qishui.com',
  'douyin.com',
  'douyinpic.com',
  'douyinvod.com',
  'douyinscdn.com',
  'douyinstatic.com',
  'byteimg.com',
  '365yg.com',
  'bytefcdn.com',
  'bytecdn.cn',
  'byteicdn.com',
  'ibytedtos.com',
  'pstatp.com',
  'snssdk.com',
  'bytedance.com',
  'bytetos.com',
  'volcvideo.com',
  'volccdn.com',
  'volces.com',
  'volcengineapi.com',
  'zijieapi.com',
  'zjcdn.com',
];

type NativePlugin = {
  cookiesGetAll: (options: Record<string, unknown>) => Promise<{ cookies?: unknown[] }>;
  cookiesGetBatch: (options: { targets: Array<{ url?: string; domain?: string }> }) => Promise<{ results?: unknown[][] }>;
  cookiesGet: (options: Record<string, unknown>) => Promise<{ cookie?: unknown }>;
  cookiesSet: (options: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  cookiesRemove: (options: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  cookiesRemoveBatch: (options: Record<string, unknown>) => Promise<{ ok?: boolean; removed?: number }>;
  httpRequest: (options: Record<string, unknown>) => Promise<{
    status: number;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    bodyBase64?: string;
  }>;
};

type ApiHandler = (input: Record<string, unknown>) => Promise<unknown>;

let apiHandler: ApiHandler | null = null;
const queuedRequests = new Map<string, Record<string, unknown>>();

const getPlugin = (): NativePlugin | null => {
  const capacitor = (window as any).Capacitor;
  return capacitor?.Plugins?.FoliaNative ?? null;
};

const postToPage = (payload: Record<string, unknown>) => {
  window.postMessage({ source: BRIDGE_SOURCE, ...payload }, '*');
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (value?: string): Uint8Array => {
  if (!value) return new Uint8Array();
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** True when a request must go through the native OkHttp proxy instead of the WebView's fetch. */
export const isBridgedApiUrl = (url: string): boolean => (
  resolveBridgedRequestUrl(url) !== null
);

/**
 * 桌面/网页版把绕 CORS 的请求交给同源的 `/api/lyric-proxy?url=...`（封面缓存、QQ 歌词、
 * 酷狗歌词与 legacy 搜索都在用它）。安卓这边由 Capacitor 的本地服务器提供 dist，
 * **没有任何东西实现这个路由** —— 相对路径解析到 https://localhost，既不在白名单里、
 * 原样发出去又是 404，于是这些功能在安卓上静默失败。
 *
 * 这里把同源的代理请求解回真正的目标地址，交给原生 OkHttp 去取（同样绕开 CORS），
 * 顺带不必再把每个图片 CDN 一个个加进白名单。
 *
 * 返回 null 表示这次请求不走原生代理。
 */
export const resolveBridgedRequestUrl = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url, location.href);
  } catch {
    return null;
  }
  if (API_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
    return parsed.toString();
  }
  // 只认自己页面发出的同源代理请求，避免把外部地址当代理入口。
  const sameOrigin = parsed.hostname === location.hostname
    && parsed.protocol === location.protocol
    && parsed.port === location.port;
  if (!sameOrigin || !/^\/api\/lyric-proxy\/?$/.test(parsed.pathname)) return null;
  const target = parsed.searchParams.get('url');
  if (!target) return null;
  try {
    return new URL(target).toString();
  } catch {
    return null;
  }
};

const serializeBody = async (body: BodyInit | null | undefined): Promise<{
  bodyText?: string;
  bodyBase64?: string;
  contentType?: string;
}> => {
  if (body == null) return {};
  if (typeof body === 'string') return { bodyText: body };
  if (body instanceof URLSearchParams) {
    return {
      bodyText: body.toString(),
      contentType: 'application/x-www-form-urlencoded',
    };
  }
  const response = new Response(body as BodyInit);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bodyBase64: bytesToBase64(bytes),
    contentType: response.headers.get('content-type') || undefined,
  };
};

const installCookieShim = (plugin: NativePlugin) => {
  const chromeObject = ((globalThis as any).chrome ??= {});
  chromeObject.runtime = {
    id: 'folia-native-android',
    getManifest: () => ({ version: BRIDGE_VERSION }),
  };
  chromeObject.storage = {
    local: {
      get: async (keys?: string | string[] | null) => {
        const result: Record<string, unknown> = {};
        const requested = keys == null
          ? Object.keys(localStorage)
          : Array.isArray(keys)
            ? keys
            : [keys];
        requested.forEach((key) => {
          const value = localStorage.getItem(String(key));
          if (value != null) {
            try {
              result[String(key)] = JSON.parse(value);
            } catch {
              result[String(key)] = value;
            }
          }
        });
        return result;
      },
      set: async (values: Record<string, unknown>) => {
        Object.entries(values || {}).forEach(([key, value]) => {
          localStorage.setItem(key, JSON.stringify(value));
        });
      },
      remove: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((key) => localStorage.removeItem(key));
      },
    },
  };
  const callPlugin = <T,>(label: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const work = (async () => {
      try {
        return await run();
      } catch (error) {
        console.warn(`[FoliaNativeBridge] ${label} failed`, error);
        return fallback;
      }
    })();
    const deadline = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => {
        console.warn(`[FoliaNativeBridge] ${label} timed out after ${COOKIE_CALL_TIMEOUT_MS}ms`);
        resolve(fallback);
      }, COOKIE_CALL_TIMEOUT_MS);
    });
    return Promise.race([work, deadline]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });
  };
  // 同一个目标（url|domain）在 COOKIE_CACHE_TTL_MS 内只读一次；同一帧里来的多个目标合并成
  // 一次过桥。插件调用是单线程串行的，逐条读会在启动时排队，先到的那条一慢就全部撞上超时。
  const cookieCache = new Map<string, { at: number; rows: unknown[] }>();
  const cookieKey = (details: Record<string, unknown>) => `${String(details?.url ?? '')}|${String(details?.domain ?? '')}`;
  let cookieQueue: Array<{ key: string; details: Record<string, unknown>; resolve: (rows: unknown[]) => void }> = [];
  let cookieFlush: ReturnType<typeof setTimeout> | null = null;
  const flushCookies = () => {
    cookieFlush = null;
    const pending = cookieQueue;
    cookieQueue = [];
    if (!pending.length) return;
    const targets = pending.map(item => ({
      url: typeof item.details.url === 'string' ? item.details.url : '',
      domain: typeof item.details.domain === 'string' ? item.details.domain : '',
    }));
    void callPlugin('cookies.getBatch', [] as unknown[][], async () => (await plugin.cookiesGetBatch({ targets })).results || [])
      .then((results) => {
        pending.forEach((item, index) => {
          const rows = Array.isArray(results?.[index]) ? results[index] as unknown[] : [];
          cookieCache.set(item.key, { at: Date.now(), rows });
          item.resolve(rows);
        });
      });
  };
  // 写操作之后按 url 前缀清缓存：{url} 与 {domain} 两种键都可能有，宁多清不漏清。
  const invalidateCookies = (details: Record<string, unknown>) => {
    const url = typeof details?.url === 'string' ? details.url : '';
    const domain = typeof details?.domain === 'string' ? details.domain : '';
    if (!url && !domain) { cookieCache.clear(); return; }
    for (const key of [...cookieCache.keys()]) {
      if ((url && key.startsWith(`${url}|`)) || (domain && key.endsWith(`|${domain}`))) cookieCache.delete(key);
    }
  };
  const readCookies = (details: Record<string, unknown>): Promise<unknown[]> => {
    const key = cookieKey(details);
    const hit = cookieCache.get(key);
    if (hit && Date.now() - hit.at < COOKIE_CACHE_TTL_MS) return Promise.resolve(hit.rows);
    return new Promise<unknown[]>((resolve) => {
      cookieQueue.push({ key, details, resolve });
      cookieFlush ??= setTimeout(flushCookies, 0);
    });
  };
  chromeObject.cookies = {
    getAll: async (details: Record<string, unknown> = {}) => readCookies(details),
    // 单条按名字读：走同一个缓存/批量，不再单独过桥。
    get: async (details: Record<string, unknown>) => {
      const name = typeof details?.name === 'string' ? details.name : '';
      if (!name) return null;
      const rows = await readCookies({ url: details.url, domain: details.domain });
      return rows.find(row => (row as { name?: unknown })?.name === name) ?? null;
    },
    set: async (details: Record<string, unknown>) => {
      await callPlugin('cookies.set', { ok: false }, () => plugin.cookiesSet(details));
      // 刚写进去的 cookie 不能被上一次的读结果盖住。
      invalidateCookies(details);
      return details;
    },
    remove: async (details: Record<string, unknown>) => {
      const answer = await callPlugin(
        'cookies.remove',
        null,
        async () => ((await plugin.cookiesRemove(details)).ok ? details : null),
      );
      invalidateCookies(details);
      return answer;
    },
    // 非标准扩展：一次删掉一批 cookie，避免几十条逐个过桥拖过调用方的截止时间。
    // 失败/超时返回 null，调用方会退回逐条删除。
    removeBatch: async (entries: Array<{ url: string; name: string }>) => callPlugin(
      'cookies.removeBatch',
      null,
      async () => {
        await plugin.cookiesRemoveBatch({ entries });
        // 这一批删掉的都过期：按 url 逐条失效，别让缓存的旧值救活它们。
        entries.forEach(entry => invalidateCookies({ url: entry.url }));
        return entries;
      },
    ),
  };
  chromeObject.declarativeNetRequest = {
    RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
    updateSessionRules: async () => undefined,
  };
  chromeObject.tabs = {
    create: async ({ url }: { url?: string } = {}) => {
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return {};
    },
    query: async () => [],
    onRemoved: { addListener: () => undefined },
    onUpdated: { addListener: () => undefined },
  };
};

const installFetchShim = (plugin: NativePlugin) => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const rawUrl = request?.url ?? String(input);
    // 同源的 /api/lyric-proxy 会被解回它包着的真实地址，再交给原生去取。
    const targetUrl = resolveBridgedRequestUrl(rawUrl);
    if (!targetUrl) {
      return originalFetch(input, init);
    }

    const method = (init?.method || request?.method || 'GET').toUpperCase();
    const headers = new Headers();
    const requestHeaders = request?.headers
      ? Array.from(request.headers.entries()).map(([name, value]) => [name, toHeaderSafeValue(value)] as [string, string])
      : [];
    const initHeaders = toHeaderEntries(init?.headers);
    for (const [name, value] of [...requestHeaders, ...initHeaders]) {
      headers.append(name, value);
    }
    const serialized = await serializeBody(init?.body ?? null);
    if (serialized.contentType && !headers.has('content-type')) {
      headers.set('content-type', serialized.contentType);
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const requestedTimeoutMs = Number(
      (init as (RequestInit & { foliaTimeoutMs?: number }) | undefined)?.foliaTimeoutMs,
    );
    const bridgeTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? Math.min(requestedTimeoutMs, BRIDGED_REQUEST_MAX_TIMEOUT_MS)
      : BRIDGED_REQUEST_TIMEOUT_MS;
    const result = await Promise.race([
      plugin.httpRequest({
        url: targetUrl,
        method,
        headers: Object.fromEntries(headers.entries()),
        bodyText: serialized.bodyText || '',
        bodyBase64: serialized.bodyBase64 || '',
        redirect: init?.redirect || request?.redirect || 'follow',
        timeoutMs: bridgeTimeoutMs,
        // credentials:'omit' 的调用方（汽水的车机协议）自带 access-token / bd-ticket-guard-*，
        // 不能带上 WebView 里别的站点的 cookie；Java 侧按这个字段决定是否加 OkHttp 的 cookie 头。
        ...((init?.credentials ?? request?.credentials) === 'omit' ? { sendCookies: false } : {}),
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Bridged request timed out after ${bridgeTimeoutMs}ms: ${method} ${targetUrl}`)),
          bridgeTimeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });
    const responseBytes = base64ToBytes(result.bodyBase64);
    const responseBuffer = responseBytes.buffer.slice(
      responseBytes.byteOffset,
      responseBytes.byteOffset + responseBytes.byteLength,
    ) as ArrayBuffer;
    const responseHeaders = new Headers();
    const exposedSetCookies: string[] = [];
    if (Array.isArray(result.headers)) {
      result.headers.forEach((entry) => {
        if (!entry?.name || entry.value == null) return;
        // Headers.set() collapses repeats, so append Set-Cookie individually
        // to keep every cookie the server sent.
        if (entry.name.toLowerCase() === 'set-cookie') {
          responseHeaders.append(entry.name, String(entry.value));
          // ...but Set-Cookie is a forbidden response-header name, so a Response built here drops it
          // before JS can read it. The bridge modules need those values (qrsig, p_skey, NMTID ...) and
          // otherwise have to guess them back out of the cookie jar, where a previous session's value
          // may still be sitting. Mirror them into a header JS is allowed to read.
          exposedSetCookies.push(String(entry.value));
        } else {
          responseHeaders.set(entry.name, String(entry.value));
        }
      });
    } else if (result.headers) {
      Object.entries(result.headers).forEach(([name, value]) => {
        if (value != null) responseHeaders.set(name, String(value));
      });
    }
    exposedSetCookies.forEach((value) => responseHeaders.append('x-folia-set-cookie', value));
    return new Response(responseBuffer, {
      status: result.status,
      headers: responseHeaders,
    });
  };
};

/**
 * Headers are decoded by Chromium as ISO-8859-1. A single Chinese character in an upstream
 * cookie/header otherwise throws before the native request is even dispatched. Keep Latin-1
 * intact and percent-encode only the code points Chromium rejects.
 */
export const toHeaderSafeValue = (value: unknown): string => {
  const text = value == null ? '' : String(value);
  let safe = '';
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    safe += codePoint <= 0xff ? character : encodeURIComponent(character);
  }
  return safe;
};

/** Flattens every supported HeadersInit shape without constructing Headers from raw unsafe text. */
export const toHeaderEntries = (headers: HeadersInit | undefined): Array<[string, string]> => {
  if (!headers) return [];
  if (headers instanceof Headers) {
    return Array.from(headers.entries()).map(([name, value]) => [name, toHeaderSafeValue(value)]);
  }
  const entries = Array.isArray(headers)
    ? headers
    : Object.entries(headers);
  return entries.map(([name, value]) => [String(name), toHeaderSafeValue(value)]);
};

const flushQueuedRequests = () => {
  if (!apiHandler) return;
  queuedRequests.forEach((payload, id) => {
    void handleApiRequest(id, payload);
  });
  queuedRequests.clear();
};

const handleApiRequest = async (id: string, payload: Record<string, unknown>) => {
  if (!apiHandler) {
    queuedRequests.set(id, payload);
    return;
  }
  try {
    const data = await apiHandler(payload);
    postToPage({ type: 'FOLIA_API_RESPONSE', id, ok: true, data });
  } catch (error) {
    postToPage({
      type: 'FOLIA_API_RESPONSE',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const installMessageBridge = () => {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as Record<string, any> | null;
    if (!data || data.source !== PAGE_SOURCE) return;

    if (data.type === 'FOLIA_BRIDGE_PING') {
      postToPage({
        type: 'FOLIA_BRIDGE_PONG',
        ready: true,
        version: BRIDGE_VERSION,
        extId: 'folia-native-android',
      });
      return;
    }

    if (data.type === 'FOLIA_API_REQUEST' && typeof data.id === 'string') {
      void handleApiRequest(data.id, data.payload || {});
    }
  });
};

export const installNativeAndroidBridge = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  const capacitor = (window as any).Capacitor;
  if (!capacitor?.isNativePlatform?.() && capacitor?.getPlatform?.() !== 'android') return;

  const plugin = getPlugin();
  if (!plugin) {
    console.error('[FoliaNativeBridge] FoliaNative Capacitor plugin is not registered');
    return;
  }

  installCookieShim(plugin);
  installFetchShim(plugin);
  installMessageBridge();
  const { installNativePlaybackBridge } = await import('./nativePlaybackBridge');
  await installNativePlaybackBridge(plugin as any);

  // @ts-ignore The bundled extension module is plain JavaScript.
  const module = await import('../nativeBridge/api/folia.js');
  apiHandler = module.handleFoliaApiRequest as ApiHandler;
  postToPage({
    type: 'FOLIA_BRIDGE_READY',
    ready: true,
    version: BRIDGE_VERSION,
    extId: 'folia-native-android',
  });
  flushQueuedRequests();
};
