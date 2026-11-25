import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from '../../stores/storagePrimitives';

// src/mods/android/androidModPrefs.ts
// 安卓上那两个开关存在哪：桌面版归主进程的配置库（MOD_SYSTEM_ENABLED / MOD_COMMUNITY_ENABLED），安卓没有主进程，
// 就只能落在 WebView 的 localStorage 里。放在这个只有存储的小文件里，是为了让设置 store 与模组桥都能用它，
// 又不必互相 import（那条环会让模块求值顺序变成运气问题）。
//
// 键只有两个：一个布尔，一个「关掉的自带模组 id」的 JSON 数组 —— 不按模组 id 各开一个键，
// 免得键名要拼出来（D507 的扫描只认字面量与常量，拼出来的键它看不见，等于没登记）。

/** 「社区模组」开关：关着时只允许自带的音源模组运行，用户自己装进来的包先按住。 */
export const MOD_COMMUNITY_ENABLED_STORAGE_KEY = 'mod_community_enabled';

/** 被用户关掉的自带模组（JSON 数组）；不在里面就是开着的。默认是空的。 */
export const MOD_BUILTIN_ENABLED_STORAGE_KEY = 'mod_builtin_disabled_mods';

const readDisabledIds = (): string[] => {
    try {
        const raw = getStoredString(MOD_BUILTIN_ENABLED_STORAGE_KEY, '[]');
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const writeDisabledIds = (ids: string[]): void => {
    setStoredString(MOD_BUILTIN_ENABLED_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
};

/** 这个自带模组是不是开着的（没有记录就是开着）。 */
export const readBuiltinModEnabled = (modId: string): boolean => !readDisabledIds().includes(modId);

export const writeBuiltinModEnabled = (modId: string, enabled: boolean): void => {
    const disabled = readDisabledIds();
    if (enabled) {
        writeDisabledIds(disabled.filter(id => id !== modId));
        return;
    }
    if (!disabled.includes(modId)) writeDisabledIds([...disabled, modId]);
};

/** 「社区模组」开关的当前值（默认关）。 */
export const readCommunityModsEnabled = (): boolean => getStoredBoolean(MOD_COMMUNITY_ENABLED_STORAGE_KEY, false);

export const writeCommunityModsEnabled = (enable: boolean): void => {
    setStoredBoolean(MOD_COMMUNITY_ENABLED_STORAGE_KEY, enable);
};
