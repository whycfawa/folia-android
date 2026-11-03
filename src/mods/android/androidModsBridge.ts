import { registerPlugin } from '@capacitor/core';
import type { ModRuntimeInfo, ModsListPayload, ModSetEnabledResult } from '../types';
import { isCapacitorAndroid } from '../../platform/runtime';
import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';

// src/mods/android/androidModsBridge.ts
// Android 端只加载客户端模组：原生负责 zip 安装、目录、启用状态与本地 HTTP 文件服务，
// 这里把原生列表翻译成渲染层已有的 ModRuntimeInfo，复用 clientLoader 的注册/清理逻辑。

type NativeMod = {
    id: string;
    dir: string;
    manifest: string;
    digest: string;
    enabled?: boolean;
    clientUrl?: string;
};

interface FoliaModsPlugin {
    list(): Promise<{ mods?: NativeMod[] }>;
    importZip(): Promise<{ imported?: string; canceled?: boolean }>;
    remove(options: { id: string }): Promise<{ deleted?: boolean }>;
    setEnabled(options: { id: string; enabled: boolean }): Promise<{ enabled?: boolean }>;
}

const FoliaMods = registerPlugin<FoliaModsPlugin>('FoliaMods');

export const isAndroidModsAvailable = (): boolean => isCapacitorAndroid();

const text = (value: unknown, fallback = ''): string => (
    typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const strings = (value: unknown): string[] => (
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
);

const parseMod = (native: NativeMod): ModRuntimeInfo | null => {
    let manifest: Record<string, unknown>;
    try {
        manifest = JSON.parse(native.manifest) as Record<string, unknown>;
    } catch {
        return null;
    }
    const id = text(manifest.id, native.id);
    const hasMain = Boolean(manifest.main);
    return {
        id,
        name: text(manifest.name, id),
        version: text(manifest.version) || null,
        author: text(manifest.author) || null,
        description: text(manifest.description) || null,
        permissions: strings(manifest.permissions),
        status: native.enabled ? 'loaded' : 'disabled',
        error: hasMain ? 'main-unsupported' : null,
        enabled: native.enabled === true,
        trustStale: false,
        signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
        devSource: false,
        experimental: strings(manifest.experimental),
        embedOrigins: strings(manifest.embedOrigins),
        folia: text(manifest.folia) || null,
        hasMain,
        clientUrl: native.clientUrl ?? null,
    };
};

export const listAndroidMods = async (): Promise<ModsListPayload> => {
    const empty: ModsListPayload = {
        mods: [],
        ffmpeg: { available: false, path: null, version: null, candidates: [] },
        directories: [],
        startSkipped: false,
    };
    if (!isCapacitorAndroid()) return empty;
    // 总开关关闭时不加载任何模组代码：连列表都不返回，clientLoader 不会启动它们。
    if (!useDesktopSettingsStore.getState().modSystemEnabled) return empty;
    try {
        const answer = await FoliaMods.list();
        const mods = (Array.isArray(answer?.mods) ? answer.mods : [])
            .map(parseMod)
            .filter((mod): mod is ModRuntimeInfo => mod !== null);
        return { ...empty, mods };
    } catch (error) {
        console.warn('[Mods] Android list failed', error);
        return empty;
    }
};

export const setAndroidModEnabled = async (id: string, enabled: boolean): Promise<ModSetEnabledResult> => {
    try {
        await FoliaMods.setEnabled({ id, enabled });
        return { ok: true, mods: (await listAndroidMods()).mods };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), mods: [] };
    }
};

export const importAndroidModZip = async (): Promise<{ imported?: string; canceled?: boolean; error?: string }> => {
    try {
        return await FoliaMods.importZip();
    } catch (error) {
        console.warn('[Mods] Android import failed', error);
        return { error: error instanceof Error ? error.message : String(error) };
    }
};

export const removeAndroidMod = async (id: string): Promise<boolean> => {
    try {
        const answer = await FoliaMods.remove({ id });
        return answer?.deleted === true;
    } catch {
        return false;
    }
};

/** 与 electron 的 window.electron.mods 同形的最小子集；clientLoader 只用到 list/set/reload。 */

type NativeHttpResponse = {
    status?: number;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    bodyBase64?: string;
};

const nativePlugin = (): { httpRequest?: (options: Record<string, unknown>) => Promise<NativeHttpResponse> } | null => {
    const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    return (capacitor?.Plugins?.FoliaNative as { httpRequest?: (options: Record<string, unknown>) => Promise<NativeHttpResponse> } | undefined) ?? null;
};

const decodeBase64 = (value: string): string => {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
};

const normalizeHeaders = (headers: NativeHttpResponse['headers']): Record<string, string> => {
    if (Array.isArray(headers)) {
        return Object.fromEntries(headers
            .filter(header => typeof header?.name === 'string')
            .map(header => [String(header.name), String(header.value ?? '')]));
    }
    return headers && typeof headers === 'object' ? headers : {};
};

const invokeAndroidNetFetch = async (
    _modId: string,
    url: string,
    init: unknown,
): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    const plugin = nativePlugin();
    if (!plugin?.httpRequest) return { ok: false, error: 'native-http-unavailable' };
    const options = (init && typeof init === 'object' ? init : {}) as {
        method?: string;
        headers?: Record<string, string> | Array<[string, string]>;
        body?: unknown;
        redirect?: string;
    };
    const headers: Record<string, string> = {};
    if (Array.isArray(options.headers)) {
        for (const [name, value] of options.headers) headers[name] = value;
    } else if (options.headers) {
        Object.assign(headers, options.headers);
    }
    if (!Object.keys(headers).some(name => name.toLowerCase() === 'user-agent')) {
        // 桌面主进程的 net.fetch 带 Chromium UA；原生 OkHttp 默认 UA 会被豆瓣/百度直接拒绝。
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }
    let bodyText = '';
    if (typeof options.body === 'string') bodyText = options.body;
    else if (options.body instanceof URLSearchParams) bodyText = options.body.toString();
    try {
        const response = await plugin.httpRequest({
            url,
            method: (options.method || 'GET').toUpperCase(),
            headers,
            bodyText,
            redirect: options.redirect || 'follow',
            timeoutMs: 30000,
        });
        return {
            ok: true,
            result: {
                status: Number(response.status || 0),
                statusText: '',
                headers: normalizeHeaders(response.headers),
                body: decodeBase64(response.bodyBase64 || ''),
            },
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};

const storageKey = (modId: string, kind: 'data' | 'secrets') => 'folia:mod:' + modId + ':' + kind;

const readStorage = (modId: string): Record<string, unknown> => {
    try {
        const raw = localStorage.getItem(storageKey(modId, 'data'));
        return raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
        return {};
    }
};

const writeStorage = (modId: string, value: Record<string, unknown>) => {
    localStorage.setItem(storageKey(modId, 'data'), JSON.stringify(value));
};

const invokeAndroidStorage = async (
    modId: string,
    operation: 'get' | 'set' | 'has' | 'delete' | 'keys',
    key?: string,
    value?: unknown,
): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    const data = readStorage(modId);
    switch (operation) {
        case 'get': return { ok: true, result: key ? data[key] : undefined };
        case 'set': {
            if (!key) return { ok: false, error: 'key is required' };
            data[key] = value;
            writeStorage(modId, data);
            return { ok: true, result: undefined };
        }
        case 'has': return { ok: true, result: Boolean(key && Object.prototype.hasOwnProperty.call(data, key)) };
        case 'delete': {
            if (key) delete data[key];
            writeStorage(modId, data);
            return { ok: true, result: undefined };
        }
        case 'keys': return { ok: true, result: Object.keys(data) };
        default: return { ok: false, error: 'unsupported-storage-operation' };
    }
};

const invokeAndroidSecrets = async (
    modId: string,
    operation: 'get' | 'has' | 'set' | 'declare' | 'state',
    key?: string | readonly string[],
    value?: string | null,
): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    const read = (): Record<string, string> => {
        try {
            const raw = localStorage.getItem(storageKey(modId, 'secrets'));
            return raw ? JSON.parse(raw) as Record<string, string> : {};
        } catch {
            return {};
        }
    };
    const write = (data: Record<string, string>) => localStorage.setItem(storageKey(modId, 'secrets'), JSON.stringify(data));
    const data = read();
    switch (operation) {
        case 'get': return { ok: true, result: typeof key === 'string' ? data[key] : undefined };
        case 'has': return { ok: true, result: typeof key === 'string' && Boolean(data[key]) };
        case 'set': {
            if (typeof key !== 'string') return { ok: false, error: 'key is required' };
            if (typeof value === 'string' && value) data[key] = value;
            else delete data[key];
            write(data);
            return { ok: true, result: undefined };
        }
        case 'declare': return { ok: true, result: undefined };
        case 'state': {
            const keys = Array.isArray(key) ? key : [];
            return { ok: true, result: Object.fromEntries(keys.map(name => [name, Boolean(data[name])])) };
        }
        default: return { ok: false, error: 'unsupported-secret-operation' };
    }
};

export const androidModsBridge = {
    listMods: listAndroidMods,
    setModEnabled: setAndroidModEnabled,
    reloadMods: async () => (await listAndroidMods()).mods,
    onModsStateChanged: () => () => undefined,
    // 桌面主进程专属的能力：Android 上没有对应实现，明确返回不可用而不是抛错。
    getFfmpegStatus: async () => ({ available: false, path: null, version: null, candidates: [] }),
    openModsDirectory: async () => ({ ok: false, error: 'unsupported-on-android' }),
    installModFromZip: async () => ({ ok: false, error: 'unsupported-on-android' }),
    getModStorageUsage: async () => ({ ok: true, data: 0, cache: 0 }),
    clearModCache: async () => ({ ok: false, error: 'unsupported-on-android' }),
    cancelExport: async () => undefined,
    onExportProgress: () => () => undefined,
    onModLog: () => () => undefined,
    invokeModNetFetch: invokeAndroidNetFetch,
    invokeModStorage: invokeAndroidStorage,
    invokeModSecrets: invokeAndroidSecrets,
    // App 的主机桥会在播放状态变化时推快照；Android 没有主进程接收，吞掉即可。
    pushRuntimeSnapshot: async () => undefined,
};
