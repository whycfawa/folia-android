// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/aiDirectClient.test.ts
// 安卓壳没有主进程：设置页里的密钥直接发给服务商（AI 主题生成与连接测试都走这条）。
// 这里把 Capacitor 平台伪装成 android、把 CapacitorHttp 换成假实现，验证请求形状与解析。

const httpRequest = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: httpRequest } }));

const sampleTheme = {
    light: {
        name: '微光', description: '窗外的光落在耳机上。',
        backgroundColor: '#fff7ed', primaryColor: '#1f2937', accentColor: '#f97316', secondaryColor: '#6b7280',
        wordColors: [], lyricsIcons: [],
    },
    dark: {
        name: '夜航', description: '夜色把城市轻轻盖住。',
        backgroundColor: '#0f172a', primaryColor: '#e2e8f0', accentColor: '#38bdf8', secondaryColor: '#94a3b8',
        wordColors: [], lyricsIcons: [],
    },
};

const loadAi = async () => {
    vi.resetModules();
    const store = await import('@/stores/useAiClientSettingsStore');
    const ai = await import('@/services/aiText');
    return { store, ai };
};

describe('AI direct client in the Android shell', () => {
    beforeEach(() => {
        (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android' };
        window.localStorage.clear();
        httpRequest.mockReset();
    });

    afterEach(() => {
        delete (window as unknown as { Capacitor?: unknown }).Capacitor;
        vi.unstubAllGlobals();
    });

    it('generates a theme through an OpenAI-compatible endpoint with the saved key', async () => {
        httpRequest.mockResolvedValue({ status: 200, data: { choices: [{ message: { content: JSON.stringify(sampleTheme) } }] } });
        const { store, ai } = await loadAi();
        store.useAiClientSettingsStore.getState().update({
            provider: 'openai',
            openaiApiKey: 'sk-test',
            openaiApiUrl: 'https://api.example.test/v1',
            openaiApiModel: 'test-model',
        });

        const theme = await ai.generateThemeFromLyrics('la la la', { isPureMusic: false, songTitle: 'Song' });

        expect(theme.light.name).toBe('微光');
        expect(theme.dark.name).toBe('夜航');
        const [request] = httpRequest.mock.calls[0];
        expect(request.url).toBe('https://api.example.test/v1/chat/completions');
        expect(request.headers.Authorization).toBe('Bearer sk-test');
        expect(request.data.model).toBe('test-model');
        expect(request.data.messages[0].content.length).toBeGreaterThan(100);
    });

    it('generates a theme through Gemini with the header key and JSON answer', async () => {
        httpRequest.mockResolvedValue({ status: 200, data: { candidates: [{ content: { parts: [{ text: JSON.stringify(sampleTheme) }] } }] } });
        const { store, ai } = await loadAi();
        store.useAiClientSettingsStore.getState().update({ provider: 'gemini', geminiApiKey: 'gemini-test' });

        const theme = await ai.generateThemeFromLyrics('la la la', { isPureMusic: false, songTitle: 'Song' });

        expect(theme.light.name).toBe('微光');
        const [request] = httpRequest.mock.calls[0];
        expect(request.url).toContain('/v1beta/models/');
        expect(request.url).toContain(':generateContent');
        expect(request.headers['x-goog-api-key']).toBe('gemini-test');
        expect(request.data.generationConfig.responseMimeType).toBe('application/json');
    });

    it('says the key is missing when none was saved', async () => {
        const { store, ai } = await loadAi();
        store.useAiClientSettingsStore.getState().update({ provider: 'gemini', geminiApiKey: '' });

        await expect(ai.generateThemeFromLyrics('la la la')).rejects.toThrow(/api key is not configured/i);
        expect(ai.isMissingAiApiKeyError(new Error('AI API key is not configured: add it in Appearance → AI theme settings.'))).toBe(true);
        expect(httpRequest).not.toHaveBeenCalled();
    });

    it('tests the unsaved form key without saving it', async () => {
        httpRequest.mockResolvedValue({ status: 200, data: { choices: [{ message: { content: 'ok' } }] } });
        const { ai } = await loadAi();

        const result = await ai.runAiConnectionTest({ provider: 'openai', apiKey: 'sk-typed', apiUrl: 'https://api.example.test/v1', model: 'm' });

        expect(result.ok).toBe(true);
        expect(result.text).toBe('ok');
        expect(httpRequest.mock.calls[0][0].headers.Authorization).toBe('Bearer sk-typed');
    });

    it('reports a rejected key as a configuration failure', async () => {
        httpRequest.mockResolvedValue({ status: 401, data: { error: { message: 'Incorrect API key provided' } } });
        const { ai } = await loadAi();

        const result = await ai.runAiConnectionTest({ provider: 'gemini', apiKey: 'bad' });

        expect(result.ok).toBe(false);
        expect(result.errorKind).toBe('invalid');
        expect(result.error).toContain('Incorrect API key');
    });

    it('lists models directly in the Android shell (model discovery is not desktop-only)', async () => {
        httpRequest.mockResolvedValue({
            status: 200,
            data: { data: [{ id: 'models/gpt-test', display_name: 'GPT Test' }, { id: 'bad\u0001' }] },
        });
        const { ai } = await loadAi();

        expect(ai.canListAiModels()).toBe(true);
        const result = await ai.fetchAiModels({
            provider: 'openai', presetId: 'custom', apiKey: 'sk-typed',
            apiUrl: 'https://api.example.test/v1', model: '',
        });

        expect(result.ok).toBe(true);
        expect(result.models).toEqual([{ id: 'gpt-test', name: 'GPT Test' }]);
        const [request] = httpRequest.mock.calls[0];
        expect(request.url).toBe('https://api.example.test/v1/models');
        expect(request.method).toBe('GET');
        expect(request.headers.Authorization).toBe('Bearer sk-typed');
    });

    it('turns a rejected model listing into an auth failure', async () => {
        httpRequest.mockResolvedValue({ status: 403, data: { error: 'Forbidden' } });
        const { ai } = await loadAi();

        const result = await ai.fetchAiModels({ provider: 'gemini', apiKey: 'bad' });

        expect(result).toMatchObject({ ok: false, errorKind: 'auth', status: 403 });
        expect(httpRequest.mock.calls[0][0].headers['x-goog-api-key']).toBe('bad');
    });

    it('refuses to list models without a key', async () => {
        const { ai } = await loadAi();

        expect(await ai.fetchAiModels({ provider: 'openai', apiKey: '', apiUrl: 'https://api.example.test/v1' }))
            .toEqual({ ok: false, errorKind: 'config' });
        expect(httpRequest).not.toHaveBeenCalled();
    });
});
