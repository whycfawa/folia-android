import md5 from 'blueimp-md5';
import appleMusicPackage from 'virtual:folia-source/appleMusic';
import bodianPackage from 'virtual:folia-source/bodian';
import fnmusicPackage from 'virtual:folia-source/fnmusic';
import kugouPackage from 'virtual:folia-source/kugou';
import neteasePackage from 'virtual:folia-source/netease';
import qqPackage from 'virtual:folia-source/qq';
import qishuiPackage from 'virtual:folia-source/qishui';
import spotifyPackage from 'virtual:folia-source/spotify';
import ytmPackage from 'virtual:folia-source/ytm';
import { COVER_HOSTS as KUGOU_COVER_HOSTS, createSource as createKugouSource } from '../../../../sources/kugou/core';
import { createSource as createNeteaseSource } from '../../../../sources/netease/core';
import { PROXIED_COVER_HOSTS, createSource as createQqSource } from '../../../../sources/qq/core';
import { connectAppleMusicTransport } from '../../../../sources/appleMusic/client/appleMusicTransport';
import { connectAppleMusicLibraryName } from '../../../../sources/appleMusic/client/appleMusicData';
import { createAppleMusicSource } from '../../../../sources/appleMusic/client/appleMusicProvider';
import { connectBodianTransport } from '../../../../sources/bodian/client/bodianTransport';
import { createBodianSource } from '../../../../sources/bodian/client/bodianProvider';
import { connectFnMusicTransport } from '../../../../sources/fnmusic/client/fnmusicTransport';
import { createFnMusicSource } from '../../../../sources/fnmusic/client/fnmusicProvider';
import { connectQishuiTransport } from '../../../../sources/qishui/client/qishuiTransport';
import { createQishuiSource } from '../../../../sources/qishui/client/qishuiProvider';
import { connectSpotifyTransport } from '../../../../sources/spotify/client/spotifyTransport';
import { createSpotifySource } from '../../../../sources/spotify/client/spotifyProvider';
import { connectYtmTransport } from '../../../../sources/ytm/client/ytmTransport';
import { createYtmSource } from '../../../../sources/ytm/client/ytmProvider';
import { requestFoliaExtension, type FoliaBridgeProvider } from '../../foliaExtensionBridge';
import { requestYtmOnAndroid } from '../ytm/android/ytmAndroidBridge';
import { androidBridgeBase, installAndroidBridgeFetch } from './androidBridgeFetch';
import { registerFoliumWebSource, unregisterFoliumWebSource } from './foliumWebSource';
import { registerLxMusic, unregisterLxMusic } from './androidLx';
import builtinModPackages from 'virtual:folia-builtin-mods';
import { readBuiltinModEnabled } from '../../../mods/android/androidModPrefs';

// src/services/onlineMusic/web/androidSources.ts
// 安卓的音源注册（上游 0.8.0：九个平台都搬进了 sources/<id>/ 成了音源模组）。
// 桌面版由主进程的模组运行时把模组的 client 交给 folium.rpc；安卓没有主进程，走的是网页版那条通道：
// createSource(env, web) 自己注册（web/<id>.ts 的同一套），请求经 androidBridgeFetch 交给原生内置桥。
// 三家用 apiBase 通道（网易云、酷狗、QQ）：请求走 androidBridgeFetch → 原生内置桥。
// 其余六个（Apple Music、Spotify、YouTube Music、汽水、波点、飞牛）在桌面上是「client 经 folium.rpc 问 main」，
// 安卓没有 main：这些模组的 transport 换成原生插件（window.foliaAppleMusicRequest / FoliaFnMusic /
// requestYtmOnAndroid / requestFoliaExtension），音源定义仍用模组自己的 create…Source。

/** 宿主侧的 call：安卓的「main 入口」就是原生桥，名字与参数跟桌面 rpc 一样（`request`, operation, params）。 */
type HostCall = <T>(name: string, ...args: unknown[]) => Promise<T>;

type BridgeAnswer = { __foliaBridgeError?: unknown; message?: unknown };

/**
 * 桥自己已经按 `{ ok, data }` / `{ ok: false, error }` 回答的平台（`src/nativeBridge/api/bodian.js`、`qishui.js`
 * 就是照桌面 rpc 的形状写的）。其余平台的桥回的是「原样的数据 + `__foliaBridgeError` 标记」，那是旧的约定。
 *
 * 这两种形状不能再套一层：套了以后客户端读到的 `result.data` 变成整个 `{ ok, data }`，
 * 于是 `(await requestBodian('login_qr_create', { key })).imageUrl` 是 undefined —— 安卓上波点、汽水的二维码
 * 就是这么空白的（`login_qr_key` 拿到的 key 也成了 undefined，后面每一步都跟着坏）。
 */
const BRIDGE_RESULT_PROVIDERS: ReadonlySet<string> = new Set<FoliaBridgeProvider>(['bodian', 'qishui']);

/** 原生内置桥的失败与旧安卓补丁同口径：没登录、桥不认识这条路、其余算网络。 */
const extensionCall = (provider: FoliaBridgeProvider): HostCall => async <T>(name: string, ...args: unknown[]) => {
    if (name !== 'request') throw new Error(`[android] ${provider}: no main entry for ${name}`);
    const [operation, params] = args as [string, Record<string, unknown> | undefined];
    try {
        const answer = await requestFoliaExtension<T & BridgeAnswer>({
            provider,
            operation: String(operation),
            params: params ?? {},
        });
        // 这两个平台的桥自己就是 {ok,data} / {ok:false,error}：原样交出去，错误码（not-playable、
        // region-restricted 之类）也才能一路传到客户端。
        if (BRIDGE_RESULT_PROVIDERS.has(provider)) {
            const wrapped = answer as {
                ok?: unknown;
                data?: unknown;
                error?: { code?: unknown; message?: unknown };
            } | null;
            if (wrapped && wrapped.ok === true) return { ok: true, data: wrapped.data } as T;
            return {
                ok: false,
                error: {
                    code: String(wrapped?.error?.code || 'invalid-response'),
                    message: String(wrapped?.error?.message || `Folia ${provider} bridge failed`),
                },
            } as T;
        }
        const failure = answer && typeof answer === 'object' ? (answer as BridgeAnswer).__foliaBridgeError : undefined;
        if (failure) {
            const code = failure === 'AUTH_REQUIRED' ? 'auth-required' : failure === 'UNSUPPORTED' ? 'unsupported' : 'network';
            const message = String((answer as BridgeAnswer).message || `Folia ${provider} bridge failed`);
            return { ok: false, error: { code, message } } as T;
        }
        return { ok: true, data: answer } as T;
    } catch (error) {
        return { ok: false, error: { code: 'network', message: error instanceof Error ? error.message : String(error) } } as T;
    }
};

/** 原生 Capacitor 插件直接给 `{ok, data}` / `{ok:false, error}` 的平台（Apple Music、飞牛、YouTube Music）。 */
const pluginCall = (provider: string, run: () => ((operation: string, params: Record<string, unknown>) => Promise<unknown>) | null): HostCall => async <T>(name: string, ...args: unknown[]) => {
    if (name !== 'request') throw new Error(`[android] ${provider}: no main entry for ${name}`);
    const request = run();
    if (!request) return { ok: false, error: { code: 'unavailable', message: `[android] ${provider}: bridge is not installed` } } as T;
    const [operation, params] = args as [string, Record<string, unknown> | undefined];
    return await request(String(operation), params ?? {}) as T;
};

type NativeWindow = Window & {
    foliaAppleMusicRequest?: (operation: string, params?: Record<string, unknown>) => Promise<unknown>;
    foliaFnMusicRequest?: (operation: string, params?: Record<string, unknown>) => Promise<unknown>;
};

const nativeWindow = (): NativeWindow | null => (typeof window === 'undefined' ? null : window as NativeWindow);

// 封面的地址原样用：安卓的原生 fetch shim 已经把封面 CDN 放进白名单（不经跨域），不需要网页版的歌词代理。
const passthroughRelay = (url: string): string => url;

/** 网易云：KuGouMusicApi 式的 apiBase 换成本地桥。 */
const registerNetease = (): string[] => registerFoliumWebSource({
    package: neteasePackage,
    create: env => createNeteaseSource({ ...env, web: { apiBase: androidBridgeBase('netease') } }),
});

/** 酷狗：同一条桥，另外它要 md5（登录参数）与封面地址改写。 */
const registerKugou = (): string[] => registerFoliumWebSource({
    package: kugouPackage,
    create: env => createKugouSource({
        ...env,
        web: { apiBase: androidBridgeBase('kugou'), md5: (text: string) => md5(text), relayUrl: passthroughRelay },
    }),
    proxiedCoverHosts: KUGOU_COVER_HOSTS,
});

/** QQ 音乐：桥按 musicu 的路径接。 */
const registerQq = (): string[] => registerFoliumWebSource({
    package: qqPackage,
    create: env => createQqSource({
        ...env,
        web: { apiBase: androidBridgeBase('qq'), relayUrl: passthroughRelay },
    }),
    proxiedCoverHosts: PROXIED_COVER_HOSTS,
});

/** Apple Music：伴侣程序在原生 WebView 里（FoliaAppleMusic 插件），不是 rpc。 */
const registerAppleMusic = (): string[] => registerFoliumWebSource({
    package: appleMusicPackage,
    call: pluginCall('appleMusic', () => nativeWindow()?.foliaAppleMusicRequest ?? null),
    create: env => {
        connectAppleMusicTransport({ call: pluginCall('appleMusic', () => nativeWindow()?.foliaAppleMusicRequest ?? null), error: env.error });
        connectAppleMusicLibraryName(() => env.translate('libraryPlaylistName'));
        return createAppleMusicSource({ text: key => env.text(key), platform: 'android' });
    },
});

/** 波点：内置桥（nativeBridge/api/bodian.js）按操作名接。 */
const registerBodian = (): string[] => {
    const call = extensionCall('bodian');
    return registerFoliumWebSource({
        package: bodianPackage,
        call,
        create: env => {
            connectBodianTransport({ call, error: env.error });
            return createBodianSource({ text: key => env.text(key), isPureMusicText: text => env.isPureMusicText(text) });
        },
    });
};

/** 飞牛音乐：原生插件 FoliaFnMusic（Cookie、自签名证书、回环代理都在原生侧）。 */
const registerFnMusic = (): string[] => {
    const call = pluginCall('fnmusic', () => nativeWindow()?.foliaFnMusicRequest ?? null);
    return registerFoliumWebSource({
        package: fnmusicPackage,
        call,
        create: env => {
            connectFnMusicTransport({ call, error: env.error });
            return createFnMusicSource({ text: key => env.text(key) });
        },
    });
};

/** 汽水：内置桥（nativeBridge/api/qishui.js，LunaOpenSDK 协议）。 */
const registerQishui = (): string[] => {
    const call = extensionCall('qishui');
    return registerFoliumWebSource({
        package: qishuiPackage,
        call,
        create: env => {
            connectQishuiTransport({ call, error: env.error });
            return createQishuiSource({ text: key => env.text(key), translate: key => env.translate(key) });
        },
    });
};

/** Spotify：内置桥（nativeBridge/api/spotify.js），登录另走原生 SpotifyAuth。 */
const registerSpotify = (): string[] => {
    const call = extensionCall('spotify');
    return registerFoliumWebSource({
        package: spotifyPackage,
        call,
        create: env => {
            connectSpotifyTransport({ call, error: env.error });
            return createSpotifySource({ text: key => env.text(key), translate: key => env.translate(key) });
        },
    });
};

/** YouTube Music：桌面版在主进程里跑 youtubei.js，安卓改在 WebView 里跑、请求走原生 HTTP（ytmAndroidBridge）。 */
const registerYtm = (): string[] => {
    const call: HostCall = async <T>(name: string, ...args: unknown[]) => {
        if (name !== 'request') throw new Error(`[android] ytm: no main entry for ${name}`);
        const [operation, params] = args as [string, Record<string, string> | undefined];
        return await requestYtmOnAndroid(operation as never, (params ?? {}) as never) as T;
    };
    return registerFoliumWebSource({
        package: ytmPackage,
        call,
        create: env => {
            connectYtmTransport({ call, error: env.error });
            return createYtmSource({
                text: (key, params) => env.text(key, params),
                translate: key => env.translate(key),
                store: env.pageStore('ytm'),
                isMac: false,
            });
        },
    });
};

/**
 * 安卓带的平台：[sources/ 下的目录名, 注册函数]。顺序就是注册表（providerRegistry）的顺序，这里只为结果稳定。
 * 目录名同时是 `virtual:folia-builtin-mods` 里那个 `id`，模组开关按它找注册函数。
 */
const ANDROID_SOURCE_REGISTRARS: ReadonlyArray<readonly [string, () => string[]]> = [
    ['netease', registerNetease],
    ['kugou', registerKugou],
    ['qq', registerQq],
    ['bodian', registerBodian],
    ['ytm', registerYtm],
    ['spotify', registerSpotify],
    ['qishui', registerQishui],
    ['appleMusic', registerAppleMusic],
    ['fnmusic', registerFnMusic],
    ['lxmusic', registerLxMusic],
];

/** 目录名（音源短 id）→ 模组 id。Apple Music 的目录叫 appleMusic、模组 id 是 apple-music。 */
const modIdOfSource = new Map<string, string>(
    builtinModPackages.map(entry => [entry.id, entry.manifest.id] as const),
);

/**
 * 把安卓带的平台注册进宿主；一个平台注册失败不拖累别的：安卓这边的失败只该让它自己那个音源不可用。
 * 在模组窗口里关掉的内置音源模组这一轮不注册（下一次启动也不会）。
 */
export const registerAndroidSources = (): string[] => {
    installAndroidBridgeFetch();
    const ids: string[] = [];
    for (const [id, register] of ANDROID_SOURCE_REGISTRARS) {
        const modId = modIdOfSource.get(id) ?? id;
        // 这个内置音源模组在模组窗口里是不是开着（没记录就是开着）。
        if (!readBuiltinModEnabled(modId)) continue;
        try {
            ids.push(...register());
        } catch (error) {
            console.warn(`[Sources] Android: ${id} could not be registered`, error);
        }
    }
    return ids;
};

/**
 * 模组窗口里拨动了某个内置音源模组的开关：把它的音源从宿主上注销（关）或重新注册（开），当场生效。
 * 不认识这个模组 id 的返回 false（那是用户自己装的包，走原生那条路）。
 */
export const applyAndroidBuiltinSourceEnabled = (modId: string, enabled: boolean): boolean => {
    const entry = ANDROID_SOURCE_REGISTRARS.find(([id]) => (modIdOfSource.get(id) ?? id) === modId);
    if (entry === undefined) return false;
    const [sourceId, register] = entry;
    if (!enabled) {
        if (sourceId === 'lxmusic') unregisterLxMusic();
        else unregisterFoliumWebSource(modId);
        return true;
    }
    try {
        register();
    } catch (error) {
        console.warn(`[Sources] Android: ${sourceId} could not be registered again`, error);
        return false;
    }
    return true;
};
