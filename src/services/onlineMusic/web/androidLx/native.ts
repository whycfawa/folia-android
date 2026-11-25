import { registerPlugin } from '@capacitor/core';

// src/services/onlineMusic/web/androidLx/native.ts
// 洛雪在安卓上的两个原生面：
//   - FoliaLxSandbox：一个隐藏 WebView，里面跑沙箱页面和 sandbox.cjs（上游那份运行环境），页面里的 fetch 全被
//     WebViewClient.shouldInterceptRequest 接住，交给 Java 侧的受控出口（LxEgress + OkHttp）；
//   - FoliaNative 已有的两条：httpRequest（曲库请求，等价桌面 api.net.fetch）与 registerRemoteAudio
//     （把脚本给的音频地址挂到本地 Range 服务上，等价桌面 api.media.serve）。
// 这里只做类型和一点点适配，不掺业务。

export interface FoliaLxSandboxPlugin {
    /** 开一个新的隐藏窗口跑 `code`，回它 inited 里声明的 sources（原样，调用方再校验）。 */
    load(options: { scriptId: string; code: string; info: Record<string, unknown> }): Promise<{ sources?: unknown }>;
    /** 调当前脚本的 request 回调；窗口不在了或脚本换了，原生侧自己重新加载。 */
    call(options: { scriptId: string; code: string; info: Record<string, unknown>; payload: Record<string, unknown> })
        : Promise<{ result?: unknown }>;
    /** 销毁窗口；下次用到再开。 */
    destroy(): Promise<void>;
    /** 系统文件选择器挑一个脚本文件，读成文本交回来（原生的 ACTION_OPEN_DOCUMENT）。 */
    pickScript(): Promise<{ canceled?: boolean; name?: string; text?: string }>;
}

export const FoliaLxSandbox = registerPlugin<FoliaLxSandboxPlugin>('FoliaLxSandbox');

type NativeHttpResponse = {
    status?: number;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    bodyBase64?: string;
};

interface FoliaNativeFace {
    httpRequest?: (options: Record<string, unknown>) => Promise<NativeHttpResponse>;
    registerRemoteAudio?: (options: Record<string, unknown>) => Promise<{ url?: string }>;
}

const nativeFace = (): FoliaNativeFace | null => {
    const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    return (capacitor?.Plugins?.FoliaNative as FoliaNativeFace | undefined) ?? null;
};

const decodeBase64Text = (value: string): string => {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
};

/**
 * 桌面 `api.net.fetch` 的安卓等价物：原生 OkHttp 发出去，正文整个读回来。
 * 曲库这几家都只发 GET，不带凭据；UA 用桌面那条 Chromium 的（原生默认 UA 会被网易云当爬虫）。
 */
export const nativeFetchText = async (
    url: string,
    options: { referer?: string; timeoutMs?: number } = {},
): Promise<{ status: number; headers: Record<string, string>; text: string }> => {
    const plugin = nativeFace();
    if (!plugin?.httpRequest) throw new Error('native http is not available');
    const headers: Record<string, string> = {
        accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
    if (options.referer) headers.referer = options.referer;
    const response = await plugin.httpRequest({
        url,
        method: 'GET',
        headers,
        bodyText: '',
        redirect: 'follow',
        timeoutMs: options.timeoutMs ?? 12_000,
    });
    const flat: Record<string, string> = {};
    const given = response?.headers;
    if (Array.isArray(given)) {
        for (const header of given) {
            if (typeof header?.name === 'string') flat[header.name.toLowerCase()] = String(header.value ?? '');
        }
    } else if (given && typeof given === 'object') {
        for (const [name, value] of Object.entries(given)) flat[name.toLowerCase()] = String(value ?? '');
    }
    return { status: Number(response?.status ?? 0), headers: flat, text: decodeBase64Text(response?.bodyBase64 ?? '') };
};

/** 把脚本给的音频地址挂到本地服务上，回一个 `http://127.0.0.1:<port>/remote-audio/<token>`（带 Range 与 CORS）。 */
export const registerRemoteAudio = async (url: string, headers: Record<string, string>): Promise<string> => {
    const plugin = nativeFace();
    if (!plugin?.registerRemoteAudio) throw new Error('the local audio server is not available');
    // scripted：这一路是脚本给的地址，原生侧按桌面 rateLimit.ts 那套收口（音频流的每秒请求数、
    // 同时 8 条流、单流 4 GiB、上游 30 秒不来数据就断）。别家平台的转发不传这个标记。
    const answer = await plugin.registerRemoteAudio({ url, headers, allowAnyHost: true, scripted: true });
    if (!answer?.url) throw new Error('the local audio server gave no address');
    return answer.url;
};

/** 网页里没有 Node 的随机 id：Capacitor 的 WebView 是安全上下文，crypto.randomUUID 有就用它。 */
export const randomId = (): string => {
    const webCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
    const bytes = new Uint8Array(16);
    (webCrypto as unknown as { getRandomValues: (view: Uint8Array) => void }).getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};
