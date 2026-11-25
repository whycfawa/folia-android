import { requestFoliaExtension, type FoliaBridgeProvider } from '../../foliaExtensionBridge';

// src/services/onlineMusic/web/androidBridgeFetch.ts
// 安卓的音源接法（上游 0.8.0 把九个平台搬进 sources/<id>/ 之后）。
// 安卓既没有 KuGouMusicApi / NeteaseCloudMusicApi 部署，也没有 Electron 主进程去跑模组的 main 入口，
// 所以走网页版那条通道（createSource + web.apiBase），只是把 apiBase 指向下面这个伪主机：
// 到这里的请求交给原生内置桥（src/nativeBridge/api/folia.js，经 Capacitor 的 FoliaNative 插件，
// 也就是 .492 之前 requestFoliaExtension 走的那条路），答复再包回一个 Response。
// 这条 shim 只认伪主机，其余请求原样交给原来的 fetch（原生 CORS 代理那条 shim 也在那一层）。

/** 伪主机：`.invalid` 保证永远解析不到，只在这层 shim 里被认出来。 */
export const ANDROID_BRIDGE_ORIGIN = 'https://folia-bridge.invalid';

/** 某个平台给 web 通道的 apiBase（音源拿它拼 `${base}${路径}`）。 */
export const androidBridgeBase = (provider: FoliaBridgeProvider): string => `${ANDROID_BRIDGE_ORIGIN}/${provider}`;

const PROVIDERS: readonly FoliaBridgeProvider[] = ['netease', 'qq', 'kugou', 'bodian', 'qishui', 'qq_raw', 'spotify', 'ytm'];

const providerOf = (segment: string): FoliaBridgeProvider | null => (
    (PROVIDERS as readonly string[]).includes(segment) ? segment as FoliaBridgeProvider : null
);

/**
 * `/song/url/new` → `song_url_new`：路径名与桥的操作名是同一套叫法（KugouMusicApi / qq-music-api 的路由）。
 * 段名里的连字符在操作名里是下划线：0.8.0 的 QQ 用 `/user/liked-songs`、`/user/playlist-detail`、
 * `/recommend/new-songs` 这些带连字符的路径，只换 `/` 的话到这里是 `user_liked-songs`，桥里的
 * `user_liked_songs` 匹配不上，回 UNSUPPORTED，页面就只看到「加载失败：QQMusicApi request failed」。
 */
const operationOf = (segments: string[]): string => segments.join('/').replace(/[/-]/g, '_');

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { 'content-type': 'application/json' },
});

export const installAndroidBridgeFetch = (): void => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const target = window as Window & { __foliaAndroidBridgeFetch?: boolean };
    if (target.__foliaAndroidBridgeFetch) return;
    target.__foliaAndroidBridgeFetch = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(`${ANDROID_BRIDGE_ORIGIN}/`)) return original(input, init);
        const parsed = new URL(url);
        const [providerSegment, ...segments] = parsed.pathname.split('/').filter(Boolean);
        const provider = providerOf(providerSegment ?? '');
        if (!provider) return jsonResponse({ __foliaBridgeError: 'UNSUPPORTED', message: 'unknown bridge provider' }, 404);
        const method = String(init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
        const body = typeof init?.body === 'string' && init.body ? init.body : undefined;
        try {
            const answer = await requestFoliaExtension<Record<string, unknown>>({
                provider,
                operation: operationOf(segments),
                method,
                path: `/${segments.join('/')}`,
                query: Object.fromEntries(parsed.searchParams.entries()),
                ...(body ? { body } : {}),
            });
            const failure = answer && typeof answer === 'object'
                ? (answer as { __foliaBridgeError?: unknown }).__foliaBridgeError
                : undefined;
            if (failure) {
                // 桥自己的失败：AUTH_REQUIRED 是没登录（401）；「桥里没有这条路由」照上游旧后端的 404 回 ——
                // 音源把 404 读成 `unsupported`，按自己的回退走（旧后端缺路由时的同一套），而不是当成网络故障
                // 反复失败；其余当成上游 502。
                const missingRoute = failure === 'UNSUPPORTED' || failure === 'ROUTE_NOT_IMPLEMENTED';
                const status = failure === 'AUTH_REQUIRED' ? 401 : missingRoute ? 404 : 502;
                const message = String((answer as { message?: unknown }).message || `Folia bridge failed: ${String(failure)}`);
                return jsonResponse({ code: status, message }, status);
            }
            return jsonResponse(answer);
        } catch (error) {
            console.warn('[AndroidBridge] source request failed', provider, error);
            return jsonResponse({ code: 502, message: error instanceof Error ? error.message : String(error) }, 502);
        }
    };
};
