import type { ScriptStorage } from '../../../../../sources/lxmusic/main/scripts';

// src/services/onlineMusic/web/androidLx/storage.ts
// 洛雪脚本库在安卓上存在 WebView 的 localStorage 里（桌面版是模组自己的 api.storage）。
// 读不出来（JSON 坏了、配额满了）就当没有：一个坏键不该让这家音源整体起不来。

const PREFIX = 'folia:lxmusic:';

export const createLocalScriptStorage = (): ScriptStorage => ({
    async get<T = unknown>(key: string): Promise<T | undefined> {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (raw === null) return undefined;
            return JSON.parse(raw) as T;
        } catch {
            return undefined;
        }
    },
    async set(key: string, value: unknown): Promise<void> {
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify(value));
        } catch {
            // 存不进去就相当于这次改动没生效，下一次读会回到旧值；不抛，免得把一次导入变成整个音源的故障。
        }
    },
    async delete(key: string): Promise<void> {
        try {
            localStorage.removeItem(PREFIX + key);
        } catch {
            // 同上。
        }
    },
});
