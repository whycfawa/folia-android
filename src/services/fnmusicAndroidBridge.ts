import { Capacitor, registerPlugin } from '@capacitor/core';
import type { FnMusicBridgeParams, FnMusicBridgeResult, FnMusicBridgeStatus } from './onlineMusic/fnmusic/fnmusicTransport';

type FnMusicPlugin = {
    api: (options: { operation: string; params?: Record<string, unknown> }) => Promise<FnMusicBridgeResult>;
};

const FnMusic = registerPlugin<FnMusicPlugin>('FoliaFnMusic');

// src/services/fnmusicAndroidBridge.ts
// 飞牛音乐在安卓没有 Electron 主进程：这里把同一套桥操作（getStatus / login / logout / request /
// stream）转给原生插件 FoliaFnMusic。原生侧负责 Cookie、CORS、自签名证书与 127.0.0.1 回环代理，
// 渲染层照旧只发操作，地址与 token 不进页面。

// 回环代理的地址（封面要它）：登录后由 getStatus 给出，没配置时为 null。放在 window 上，
// 让同步的封面地址生成不必反向依赖这个模块。
const rememberOrigin = (value: string | null): void => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __foliaFnMusicOrigin?: string | null }).__foliaFnMusicOrigin = value;
};

const call = async (operation: string, params: FnMusicBridgeParams): Promise<FnMusicBridgeResult> => {
    const result = await FnMusic.api({ operation, params: params as Record<string, unknown> });
    if (operation === 'getStatus' && result.ok) {
        const status = result.data as FnMusicBridgeStatus | null;
        const proxyBase = (status as unknown as { proxyBase?: unknown } | null)?.proxyBase;
        rememberOrigin(typeof proxyBase === 'string' && proxyBase ? proxyBase : null);
    }
    return result;
};

export const installFnMusicAndroidBridge = (): void => {
    if (Capacitor.getPlatform() !== 'android' || typeof window === 'undefined') return;
    const target = window as Window & { foliaFnMusicRequest?: typeof call };
    if (typeof target.foliaFnMusicRequest === 'function') return;
    target.foliaFnMusicRequest = call;
    // 预热一次状态：已经登录过的机器不必等用户打开账号页才知道代理地址。
    void call('getStatus', {}).catch(error => {
        console.warn('[FnMusic] Android bridge status failed', error);
    });
};
