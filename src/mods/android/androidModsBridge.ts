import { registerPlugin } from '@capacitor/core';
import type { ModRuntimeInfo, ModsListPayload, ModSetEnabledResult } from '../types';
import { isCapacitorAndroid } from '../../platform/runtime';

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
export const androidModsBridge = {
    listMods: listAndroidMods,
    setModEnabled: setAndroidModEnabled,
    reloadMods: async () => (await listAndroidMods()).mods,
    onModsStateChanged: () => () => undefined,
};
