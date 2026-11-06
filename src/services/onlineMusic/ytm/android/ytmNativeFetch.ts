import { CapacitorHttp } from '@capacitor/core';
import { ytmCookieAuthorization } from './ytmAndroidAuth';

// src/services/onlineMusic/ytm/android/ytmNativeFetch.ts
// Android App 里给 youtubei.js 和 BotGuard 用的 fetch：YouTube 的接口不给 https://localhost 回 CORS 头，
// WebView 的 fetch 一律被拦，所以请求改走原生 HTTP（CapacitorHttp），答案再包回一个 Response。
// 登录之后请求带着账户的头（Cookie、SAPISIDHASH 一族）：这些头只许跟 YouTube 自己的那几个精确主机走，
// 别的地址一律不给；带账户头的请求让原生端不跟随重定向（CapacitorHttp 的 disableRedirects），
// 重定向返回的都是 YouTube 自己的 3xx，正文不会被引去别处。

/** 调用方写了 accept-encoding，原生连接就把压缩过的字节原样交回；这几个头交给原生端自己定。 */
const DROPPED_HEADERS = new Set(['accept-encoding', 'content-length', 'host', 'connection', 'origin', 'referer']);
/** 说出「这是这个账号的请求」的头：cookie、登录的证明，和页面 id（与桌面版 webSignIn.cjs 的清单一致）。 */
const ACCOUNT_HEADERS = new Set(['cookie', 'authorization', 'x-goog-authuser', 'x-goog-pageid']);
/** 账户头只许去的精确主机：认全等，不认子域的通配（youtube.com 不在其中）。 */
const ACCOUNT_HOSTS = new Set(['music.youtube.com', 'www.youtube.com']);
const REQUEST_LIMIT_MS = 20000;
// 页面里的 youtubei.js 不写 User-Agent（浏览器自己会写）。默认替它写一个桌面浏览器的；登录会话存下
// 登录 WebView 自己的 UA 时不写死，跟随登录时用过那一个。匿名请求不写 Origin；带账户的请求
// 使用签名的 canonical YouTube Origin，绝不转发 https://localhost（早期匿名路线实测会被拒）。
const DESKTOP_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// 登录会话交回来的 UA：带账户的请求跟着它发，不另编一个。只留内存，登出清空。
const AGENT_LIMIT = 256;
let sessionAgent: string | null = null;

/** 登录会话（ytmAndroidBridge.ts）交进来的 UA；null 回到默认的桌面浏览器。 */
export const setYtmNativeAgent = (agent: string | null): void => {
    sessionAgent = typeof agent === 'string' && agent.length > 0 && agent.length <= AGENT_LIMIT ? agent : null;
};

const urlOf = (input: RequestInfo | URL): string => (
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
);

/** 错误里说的地址：只 scheme 和主机（解析不开时截在查询串之前），不带路径、查询、用户信息。 */
const safeSite = (raw: string): string => {
    try {
        const target = new URL(raw);
        return `${target.protocol}//${target.hostname}${target.port && target.port !== '443' ? `:${target.port}` : ''}`;
    } catch {
        return raw.split(/[?#]/)[0];
    }
};

/** 读出请求体：youtubei.js 和 BotGuard 只发字符串（JSON 或 JSON+protobuf）。 */
const bodyOf = async (input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> => {
    if (typeof init?.body === 'string') return init.body;
    if (init?.body instanceof URLSearchParams) return init.body.toString();
    if (init?.body) return await new Response(init.body).text();
    if (input instanceof Request && input.body) return await input.clone().text();
    return undefined;
};

/** 包回一个与 fetch 同形的 Response（原生端已解压，content-encoding / content-length 留着会误读正文）。 */
const responseOf = (answer: { status: number; headers: Record<string, unknown>; data: unknown }): Response => {
    const text = typeof answer.data === 'string' ? answer.data : JSON.stringify(answer.data ?? null);
    const responseHeaders = new Headers();
    Object.entries(answer.headers ?? {}).forEach(([key, value]) => {
        // 原生端已经解压，留着 content-encoding / content-length 会让 Response 误读正文。
        if (/^content-(encoding|length)$/i.test(key)) return;
        try { responseHeaders.set(key, String(value)); } catch { /* 非法头名跳过 */ }
    });
    const nullBody = answer.status === 204 || answer.status === 205 || answer.status === 304;
    return new Response(nullBody ? null : text, { status: answer.status, headers: responseHeaders });
};

/** 和 fetch 一样的签名，走原生 HTTP。 */
export const ytmNativeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers: Record<string, string> = {};
    const collect = (source: HeadersInit | undefined) => {
        if (!source) return;
        new Headers(source).forEach((value, key) => {
            if (!DROPPED_HEADERS.has(key.toLowerCase())) headers[key] = value;
        });
    };
    if (input instanceof Request) collect(input.headers);
    collect(init?.headers);
    const named = (name: string) => Object.keys(headers).some(key => key.toLowerCase() === name);
    if (!named('user-agent')) headers['User-Agent'] = sessionAgent ?? DESKTOP_AGENT;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await bodyOf(input, init);
    // 原生端只在有 Content-Type 时写请求体。
    if (body !== undefined && !named('content-type')) {
        headers['Content-Type'] = 'text/plain;charset=UTF-8';
    }
    // 每个请求的地址都要干净：https、没有 URL 里的用户信息（userinfo）、端口就是默认的 443。错形状的
    // 一律不发——错误里只说地址的形状（scheme、host），带回原始地址会把查询串（可能带着请求的凭证）
    // 写进日志。
    let host: string | null = null;
    try {
        const target = new URL(url);
        const defaultPort = target.port === '' || target.port === '443';
        if (target.protocol === 'https:' && target.username === '' && target.password === '' && defaultPort) {
            host = target.hostname;
        }
    } catch { /* host 留空 */ }
    if (host === null) {
        throw new Error(`ytmNativeFetch only takes clean https addresses, got ${safeSite(url)}`);
    }
    // 账户头只许跟 YouTube 的精确主机走：别的地址不给，请求也直接失败——悄悄剥掉会把带账户的请求
    // 说成匿名请求，问题就被埋掉了。
    const withAccount = Object.keys(headers).filter(key => ACCOUNT_HEADERS.has(key.toLowerCase()) && headers[key]);
    if (withAccount.length > 0 && !ACCOUNT_HOSTS.has(host)) {
        throw new Error(`account headers are only sent to the exact YouTube Music and YouTube hosts, got ${safeSite(url)}`);
    }
    const cookie = Object.entries(headers).find(([key]) => key.toLowerCase() === 'cookie')?.[1];
    if (cookie && !named('authorization')) {
        const authorization = await ytmCookieAuthorization(cookie);
        if (authorization) {
            headers.authorization = authorization;
            if (!named('x-goog-authuser')) headers['x-goog-authuser'] = '0';
        }
    }
    // Native account requests must match youtubei.js's canonical signing origin. Never forward
    // the WebView's https://localhost Origin (or any caller-provided origin) to YouTube.
    if (cookie && named('authorization')) {
        headers.origin = 'https://www.youtube.com';
        headers['x-origin'] = 'https://www.youtube.com';
    }
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // 带账户头的请求不让原生端跟随重定向：三○几由调用方（youtubei.js）自己看。
    const request = CapacitorHttp.request({
        url, method, headers, data: body, connectTimeout: REQUEST_LIMIT_MS, readTimeout: REQUEST_LIMIT_MS * 2,
        responseType: 'text', shouldEncodeUrlParams: false,
        ...(withAccount.length > 0 ? { disableRedirects: true } : {}),
    });
    // 原生请求停不下来；signal 中止时只是不再等它。
    const answer = init?.signal
        ? await Promise.race([request, new Promise<never>((_, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        })])
        : await request;
    const response = responseOf(answer);
    // youtubei.js 在错误里写 response.url；构造出来的 Response 没有它。
    Object.defineProperty(response, 'url', { value: answer.url || url });
    return response;
};
