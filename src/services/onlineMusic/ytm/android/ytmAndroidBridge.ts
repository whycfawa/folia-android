import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ProviderErrorCode, ProviderUser } from '../../../../types/onlineMusic';
import type { YtmBridgeResult, YtmOperation, YtmParams, YtmWireCollection, YtmWireSong } from '../ytmTransport';
import {
    VIDEO_ID, albumFromCard, albumFromPage, artistFromPage, bitrateOf, lrcFromLyricsPage, lyricsBrowseId,
    pickAudioFormat, songFromListItem, songFromQueueItem,
} from './ytmAndroidCatalog';
import { createYtmSandbox } from './ytmAndroidSandbox';
import { mintYtmToken } from './ytmAndroidToken';
import { clearNativeSession, restoreNativeSession, saveNativeSession } from './ytmAndroidSessionStore';
import { setYtmNativeAgent, ytmNativeFetch } from './ytmNativeFetch';
import { signInWithYtmNative } from './ytmAndroidSignIn';
import { readYtmAccountHistory } from './ytmAndroidHistory';
import { accountFromYtmWebList } from './ytmAndroidAccount';

// src/services/onlineMusic/ytm/android/ytmAndroidBridge.ts
// Android App 上的 YouTube Music：桌面版的这些操作在主进程（electron/ytm/ytmApiBridge.cjs）里跑，
// Android 没有主进程，改在 WebView 里用 youtubei.js 跑，请求走原生 HTTP（ytmNativeFetch.ts）。
// 登录走原生的一座 Activity（android/app 的 FoliaYtm）：它完成后把 YouTube 的 cookie 交回来，
// 会话从此带着它建（ytmAndroidSignIn.ts）。验证过真账号的会话由原生侧加密落盘（YtmSessionStore），
// 下一次启动先读回来、再拿它对账号，对上了才算数；登出把内存里的和落盘的一起丢掉，在途的
// 一轮操作和一轮登录也随之作废。
// 除登录、登录状态、登出外的每个操作都先过已登录的门：这里没有访客模式，匿名什么都不做。
// 音频保留它原本的公开路线（BotGuard 令牌换整首歌下载到缓存），但同样在登录之后才放行。

/* eslint-disable @typescript-eslint/no-explicit-any */

class YtmAndroidError extends Error {
    constructor(public readonly code: ProviderErrorCode, message: string, public readonly reason?: string) { super(message); }
}
const fail = (code: ProviderErrorCode, message: string, reason?: string): never => { throw new YtmAndroidError(code, message, reason); };

const MOBILE_BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
const WATCH_URL = 'https://music.youtube.com/youtubei/v1/next?prettyPrint=false';
// 手机版 YouTube Music 的歌词页带逐行时间轴，网页版的没有。
const MOBILE_CLIENT = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50' };
// App 的语言对应 YouTube 页面的语言。
const PAGE_LANGUAGES: Record<string, string> = { 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en', in: 'id' };
// 一个会话用多久就重建（播放器脚本会更新）。
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const AUDIO_DIR = 'ytm-audio';
// 缓存目录里最多留几首；多出来的按时间先后删掉。
const KEPT_AUDIO_FILES = 6;

const boundedText = (value: unknown, max: number): string | null => (
    typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
);
const entityId = (value: unknown): string | null => (typeof value === 'string' && /^[\w-]{2,128}$/.test(value) ? value : null);
const videoId = (value: unknown): string => (typeof value === 'string' && VIDEO_ID.test(value) ? value : fail('invalid-response', 'Invalid track id'));
const pageToken = (value: unknown): string | undefined => {
    if (value === undefined) return undefined;
    return boundedText(value, 8192) ?? fail('invalid-response', 'Invalid page token');
};

// ---- 会话 ----

/*
 * 会话的两条来路，用力不一样：
 * - 登录屏交回来的（web_login_start）：原生已经确认页面上有登录的 cookie，门就为它开，
 *   但落盘要等账号对过话（validateSession）才做——「存下的会话」必须是应用自己验证过的。
 * - 冷启动读回来的（restoreNativeSession）：落盘的是应用验证过的那份，但读回来时谁也不敢
 *   替 YouTube 担保它还有效，所以先不给过门：先拿它去问 YouTube 真账号（validateSession），
 *   问得到真账号才过门；问不到（YouTube 拒了、或是别人的）就把存的连同内存里的一起丢掉。
 */

// 登录 得到的 cookie：账号的全部凭据，只在内存里，登出清掉。
let sessionCookie: string | null = null;
// 登录 WebView 自己的 UA：带账户的请求跟着它发（ytmNativeFetch.ts），不另编一个。
let sessionUserAgent: string | null = null;
// 账号已经拿这个 cookie 对过话：设了才许落盘。
let sessionValidated = false;
// 这个会话是冷启动读回来的：过门前要先验证真账号。
let sessionRestored = false;
// 同一个会话的第几轮：登录成功和登出都算新的一轮。在途操作记账时记下自己的轮次，回来发现换轮就不许交话。
let generation = 0;
// 起过几次原生登录：web_login_cancel 和登出把在途的那一轮作废，晚到的原生结果不许再立会话。
let loginAttempts = 0;

const hasSession = (): boolean => sessionCookie !== null;

// 会话立起来（登录交回、或冷启动读回）：cookie 与 UA 定型，轮次换新，UA 跟着交给原生连接。
// 读回来的那一份本来就在盘上（不用再写）；登录屏交回来那一份要验证过真账号才落盘。
const adoptSession = (cookie: string, userAgent: string | null, restored: boolean): void => {
    sessionCookie = cookie;
    sessionUserAgent = userAgent;
    sessionRestored = restored;
    sessionValidated = false;
    sessionStored = restored;
    validating = null;
    generation += 1;
    setYtmNativeAgent(userAgent);
};

// 登出（或又一个登录）把会话清掉：cookie 与 UA 丢掉，在途操作与在途登录一并作废。
const forgetSession = (): void => {
    sessionCookie = null;
    sessionUserAgent = null;
    sessionRestored = false;
    sessionValidated = false;
    sessionStored = false;
    validating = null;
    generation += 1;
    loginAttempts += 1;
    setYtmNativeAgent(null);
};

type Library = typeof import('youtubei.js');
let library: Promise<Library> | null = null;
const sandbox = createYtmSandbox();

// youtubei.js 只在第一次用到 YouTube Music 时加载（几百 KB）。播放器的解密脚本在沙盒 iframe 里跑。
const loadLibrary = (): Promise<Library> => {
    if (!library) {
        const loading = import('youtubei.js').then(loaded => {
            loaded.Platform.shim.eval = (data: { output: string }) => sandbox.evaluate(`(() => { ${data.output}\n })()`) as any;
            loaded.Parser.setParserErrorHandler(() => {});
            return loaded;
        });
        library = loading;
        loading.catch(() => { if (library === loading) library = null; });
    }
    return library;
};

const languageOf = (): string => {
    const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
    return PAGE_LANGUAGES[lang] ?? (lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');
};

type Session = InstanceType<Library['Innertube']>;
// 会话的两把钥匙：页面的语言，和会话的轮次。换了语言或换来 cookie 都得重建。
const lazySession = (create: () => Promise<Session>, stamp: () => string) => {
    let current: { promise: Promise<Session>; at: number; stamp: string } | null = null;
    return () => {
        const withStamp = stamp();
        if (!current || current.stamp !== withStamp || Date.now() - current.at > SESSION_MAX_AGE_MS) {
            const holder = { promise: create(), at: Date.now(), stamp: withStamp };
            holder.promise.catch(error => {
                if (current === holder) current = null;
                console.warn('[Ytm] A YouTube Music session could not be built', error);
            });
            current = holder;
        }
        return current.promise;
    };
};

// 登录后的会话：带着 cookie 建，请求经它走原生 HTTP（ytmNativeFetch.ts 里账户头只许给 YouTube 的主机），
// UA 用登录时那个。
const signedSession = lazySession(async () => {
    if (!hasSession()) fail('auth-required', 'Sign in to YouTube Music first');
    const { Innertube } = await loadLibrary();
    return Innertube.create({
        cookie: sessionCookie!, user_agent: sessionUserAgent ?? undefined, lang: languageOf(),
        retrieve_player: false, fetch: ytmNativeFetch,
    });
}, () => `${languageOf()}|${generation}`);

const postJson = async (url: string, body: unknown): Promise<any> => {
    const response = await ytmNativeFetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) fail(response.status === 429 ? 'network' : 'unavailable', `YouTube Music answered status ${response.status}`);
    return await response.json();
};

const songOfWatchPage = (page: any, id: string, YTNodes: Library['YTNodes']): YtmWireSong | null => {
    const entries = page.contents_memo?.getType(YTNodes.PlaylistPanelVideo) ?? [];
    return songFromQueueItem(entries.find((entry: any) => entry.video_id === id)) ?? null;
};

const songInLanguage = async (params: YtmParams, hl: string): Promise<YtmWireSong | null> => {
    const id = videoId(params.id);
    const { Constants, Parser, YTNodes } = await loadLibrary();
    const { NAME: clientName, VERSION: clientVersion } = Constants.CLIENTS.YTMUSIC;
    const data = await postJson(WATCH_URL, { context: { client: { clientName, clientVersion, hl } }, videoId: id });
    return songOfWatchPage(Parser.parseResponse(data), id, YTNodes);
};

const playlistPageOf = (page: any, further: boolean, YTNodes: Library['YTNodes']) => {
    const shelf = further ? undefined : page.contents_memo?.getType(YTNodes.MusicPlaylistShelf)?.[0];
    const rows = [...(further
        ? page.on_response_received_actions?.find((action: any) => action?.type === 'AppendContinuationItemsAction')?.contents ?? []
        : shelf?.contents ?? [])];
    if (further && rows.length === 0) fail('invalid-response', 'YouTube Music playlist page has no rows');
    const next = rows.find((row: any) => row?.type === 'ContinuationItem')?.endpoint?.payload?.token ?? shelf?.continuation;
    return {
        items: rows.map((row: any) => songFromListItem(row)).filter(Boolean) as YtmWireSong[],
        ...(typeof next === 'string' && next ? { continuation: next } : {}),
    };
};

// ---- 音频 ----

const extensionOf = (mimeType: string): string => (/webm/i.test(mimeType) ? 'webm' : 'm4a');

// 缓存目录里只留最近几首；正在下载的那首不算在内。
const pruneAudio = async (keep: string): Promise<void> => {
    try {
        const { files } = await Filesystem.readdir({ directory: Directory.Cache, path: AUDIO_DIR });
        const old = files
            .filter(file => file.type === 'file' && file.name !== keep)
            .sort((left, right) => (right.mtime ?? 0) - (left.mtime ?? 0))
            .slice(KEPT_AUDIO_FILES - 1);
        await Promise.all(old.map(file => Filesystem.deleteFile({ directory: Directory.Cache, path: `${AUDIO_DIR}/${file.name}` }).catch(() => undefined)));
    } catch { /* 目录还不在 */ }
};

// 播放器那一面（拿流转格式）走的是公开接口、访客的加密路线，与登录无关；能走到这里就已过了已登录的门。
// 隔一段时间重建（播放器的解密脚本会更新），与登录会话各是各的。
const playerSession = lazySession(async () => {
    const { Innertube } = await loadLibrary();
    return Innertube.create({ retrieve_player: true, fetch: ytmNativeFetch });
}, () => 'player');

const audio = async (params: YtmParams) => {
    const id = videoId(params.id);
    const level = params.quality === 'standard' ? 'standard' : 'high';
    const [yt, poToken] = await Promise.all([playerSession(), mintYtmToken(id)]);
    let info: any;
    try {
        info = await yt.getBasicInfo(id, { client: 'YTMUSIC', po_token: poToken } as any);
    } catch (error) {
        console.warn(`[Ytm] The player request for ${id} failed`, error);
        fail('not-playable', 'YouTube Music cannot play this track');
    }
    if (info.playability_status?.status !== 'OK') {
        const status = String(info.playability_status?.status ?? '');
        fail('not-playable', `YouTube Music cannot play this track${/^[A-Z_]{2,40}$/.test(status) ? ` (${status})` : ''}`);
    }
    const format = pickAudioFormat(info.streaming_data?.adaptive_formats ?? [], level);
    if (!format) fail('not-playable', 'YouTube Music offered no audio for this track');
    const length = Number(format.content_length);
    const address = new URL(await format.decipher(yt.session.player));
    address.searchParams.set('pot', poToken);
    // 一次要整个文件：音频服务器对不写 range 的大请求只按播放速度给（桌面版实测）。
    address.searchParams.set('range', `0-${length - 1}`);
    const mimeType = String(format.mime_type).split(';')[0];
    const name = `${id}-${format.itag}.${extensionOf(mimeType)}`;
    const path = `${AUDIO_DIR}/${name}`;
    const startedAt = Date.now();
    let uri: string | null = null;
    try {
        const kept = await Filesystem.stat({ directory: Directory.Cache, path });
        if (Number(kept.size) === length) uri = kept.uri;
    } catch { /* 还没下过 */ }
    if (!uri) {
        await Filesystem.mkdir({ directory: Directory.Cache, path: AUDIO_DIR, recursive: true }).catch(() => undefined);
        const done = await Filesystem.downloadFile({
            url: address.href, directory: Directory.Cache, path, recursive: true,
            connectTimeout: 15000, readTimeout: 30000,
        } as any);
        const stat = await Filesystem.stat({ directory: Directory.Cache, path });
        if (Number(stat.size) !== length) {
            await Filesystem.deleteFile({ directory: Directory.Cache, path }).catch(() => undefined);
            console.warn(`[Ytm] The download of ${id} gave ${stat.size} of ${length} bytes`);
            fail('network', 'YouTube Music audio download was cut off');
        }
        uri = done.path ? `file://${done.path}` : stat.uri;
        console.log(`[Ytm] Downloaded ${id} (itag ${format.itag}, ${Math.round(length / 1024)} KB) in ${Date.now() - startedAt}ms`);
    }
    void pruneAudio(name);
    return { url: Capacitor.convertFileSrc(uri), route: 'android', itag: format.itag, bitrate: bitrateOf(format) };
};

// ---- 登录与账户 ----

/*
 * login_status 的返回形状是 wire 契约的一部分，不能自创：ytmProvider 写的是
 * `requestYtm<ProviderUser | null>('login_status')`，没登录必须是 null。
 * 规矩与 nishino 的一条对齐：只有平台承认「这个登录不算数」才报没有账号，其它错误如实抛出 ——
 * 一律吞成 null 会把一次网络抖动说成「你没登录」，账号当场被清掉。
 */
const readSignedInUser = async (): Promise<ProviderUser | null> => {
    if (!hasSession()) return null;
    let info: any;
    try {
        const yt: any = await signedSession();
        const response = await yt.actions.execute('/account/accounts_list', {
            client: 'YTMUSIC', parse: false,
        });
        const feedback = response.data?.responseContext?.serviceTrackingParams?.find((entry: any) => entry?.service === 'GFEEDBACK');
        const signedIn = feedback?.params?.find((entry: any) => entry?.key === 'logged_in')?.value;
        if (signedIn !== '1') fail('auth-required', 'YouTube Music did not accept the sign-in', 'not-taken');
        info = await accountFromYtmWebList(response.data);
    } catch (error) {
        console.warn('[Ytm] Could not read the signed-in account', logged(error));
        if (error instanceof YtmAndroidError && error.code === 'auth-required') throw error;
        throw error;
    }
    if (!info) fail('invalid-response', 'YouTube Music did not identify the signed-in account', 'account-missing');
    return info;
};

// 会话落盘：只有应用自己验证过的会话才存（saveNativeSession 在原生侧过 Keystore 加密）。
let sessionStored = false;
// Serialize native writes and clears. Logout is queued after any older save, never before it.
let storageTail: Promise<unknown> = Promise.resolve();
const storageTask = <T>(work: () => Promise<T>): Promise<T> => {
    const task = storageTail.then(work, work);
    storageTail = task.catch(() => undefined);
    return task;
};
const eraseSession = (eraseCookies = true): Promise<boolean> => storageTask(() => clearNativeSession(eraseCookies));
let persisting: { generation: number; promise: Promise<void> } | null = null;
const persistSession = (): Promise<void> => {
    if (sessionStored || !sessionCookie || !sessionValidated || !sessionUserAgent) return Promise.resolve();
    const mine = generation;
    if (persisting?.generation === mine) return persisting.promise;
    const session = { cookie: sessionCookie, userAgent: sessionUserAgent };
    const promise = storageTask(async () => {
        if (mine !== generation) return;
        const saved = await saveNativeSession(session);
        if (mine !== generation) return;
        if (!saved) {
            sessionValidated = false;
            fail('unavailable', 'YouTube Music sign-in could not be securely saved', 'session-save-failed');
        }
        sessionStored = true;
        console.log('[Ytm] The validated YouTube Music session was stored for next time');
    }).finally(() => { if (persisting?.generation === mine) persisting = null; });
    persisting = { generation: mine, promise };
    return promise;
};

// 错误里带的地址一律截掉查询串：youtubei.js 的错（「Request to … failed with status …」），带着原始地址。
const withoutQuery = (text: string): string => text.replace(/https?:\/\/\S+/g, match => match.split('?')[0]);

// 留给日志的错：message 和栈里的地址都不带查询串，其余（名字、栈）照旧。
const logged = (error: unknown): unknown => {
    if (!(error instanceof Error)) return error;
    const clean = new Error(withoutQuery(error.message || ''));
    clean.name = error.name;
    if (error.stack) clean.stack = withoutQuery(error.stack);
    return clean;
};

// YouTube 明说这份 cookie 不算数：401/403。谁拒的要说清楚，别把「没网络」混进来。
const sessionRefused = (error: unknown): boolean => {
    const text = withoutQuery(error instanceof Error ? `${error.name} ${error.message}` : String(error));
    return /\bstatus code 40[13]\b/.test(text);
};

/*
 * 拿现在的 cookie 问 YouTube 真账号。问到才许落盘、才许过门；问到时存的没有存也补存。
 * YouTube 拒了（401/403）或问不出账号、而这份会话是冷启动读回来的：连同落盘的那份一起清掉，
 * 不留一份每次启动都白读的。网络恰好断了就照实抛，读回来的那份留给下次再验证。
 */
/** 原生登录屏是否开着：开着的时候 check 答 waiting，不答 expired。 */
let nativeSignInPending = false;
let validating: Promise<ProviderUser | null> | null = null;
const validateSession = (): Promise<ProviderUser | null> => {
    const mine = generation;
    if (validating) return validating;
    const task = (async () => {
        let user: ProviderUser | null = null;
        let refused = false;
        try {
            user = await readSignedInUser();
        } catch (error) {
            if (!(error instanceof YtmAndroidError && error.code === 'auth-required') && !sessionRefused(error)) throw error;
            refused = true;
            console.warn('[Ytm] YouTube refused the session cookie', logged(error));
        }
        if (mine !== generation) return null;
        if (user) {
            sessionValidated = true;
            sessionRestored = false;
            await persistSession();
        } else if (refused || sessionRestored) {
            console.log(refused ? '[Ytm] The session cookie was refused; the stored one is erased' : '[Ytm] The session cookie named no account; the stored one is erased');
            forgetSession();
            await eraseSession(false);
        }
        return mine === generation ? user : null;
    })();
    validating = task;
    void task.finally(() => { if (validating === task) validating = null; }).catch(() => undefined);
    return task;
};

// ---- 各个操作 ----

type Handler = (params: YtmParams) => Promise<unknown>;

// 冷启动只问一次原生「存着会话吗」：没有登录过的设备别在每个数据操作上都问一遍。
let restoreTried = false;
let restoring: Promise<void> | null = null;
const seekStoredSession = async (): Promise<void> => {
    if (restoring) return restoring;
    if (restoreTried) return;
    restoreTried = true;
    const mine = generation;
    restoring = (async () => {
        const stored = await restoreNativeSession();
        if (mine === generation && stored && !hasSession()) adoptSession(stored.cookie, stored.userAgent, true);
    })().finally(() => { restoring = null; });
    return restoring;
};

// 除登录、登录状态、登出外全部都会过的门：确认过的会话才放行，一轮在途的操作在会话结束后不许交话。
// 冷启动读回来的会话先不去过门：等它拿 cookie 问过 YouTube（validateSession 问到真账号）再说。
const gated = (handler: Handler): Handler => async params => {
    if (!hasSession()) await seekStoredSession();
    if (!hasSession()) fail('auth-required', 'Sign in to YouTube Music first');
    if (!sessionValidated && !(await validateSession())) {
        fail('auth-required', 'The stored YouTube Music session could not be confirmed');
    }
    // 记账放在验证之后：读回来立会话不算「换了一轮」，在途的去留只看这一轮里有没有人登出。
    const seen = generation;
    const data = await handler(params);
    if (seen !== generation) fail('auth-required', 'The YouTube Music session ended while the operation was running');
    return data;
};

const handlers: Partial<Record<YtmOperation, Handler>> = {
    // 不受会话限制的三个之外，每个都要已登录（在 requestYtmOnAndroid 里过门）。
    login_status: async () => {
        if (!hasSession()) await seekStoredSession();
        if (!hasSession()) return null;
        const user = await validateSession();
        if (!user) return null;
        console.log('[Ytm] The signed-in YouTube Music account was confirmed');
        return user;
    },
    logout: async () => {
        restoreTried = true;
        forgetSession();
        validating = null;
        // Await erasure; a concurrent cold-start read must not restore the signed-out session.
        if (!(await eraseSession())) fail('unavailable', 'The stored YouTube Music session could not be fully erased', 'logout-clear-failed');
        console.log('[Ytm] YouTube Music session was cleared');
        return {};
    },
    web_login_start: async () => {
        // 原生登录屏开着的时候，账号还没到页面里：这期间 web_login_check 必须答 waiting，
        // 不能把「还没登完」当成「已过期」——否则登录窗口刚开就被界面判定失效并取消。
        if (nativeSignInPending) fail('unavailable', 'A YouTube Music sign-in is already open');
        // 起原生登录屏并等它交回 cookie。cancel（provider 那头的 key 失效）或登出会把在途的一轮作废：
        // 晚到的原生结果发现不是自己那一轮，直接丢掉，不许再把会话立起来。
        const attempt = ++loginAttempts;
        const base = generation;
        nativeSignInPending = true;
        let answer: Awaited<ReturnType<typeof signInWithYtmNative>>;
        try {
            answer = await signInWithYtmNative();
        } finally {
            nativeSignInPending = false;
        }
        if (attempt !== loginAttempts || base !== generation) {
            console.log('[Ytm] A native sign-in finished after its round was over; its session was discarded');
            return {};
        }
        if (answer.ok) {
            adoptSession(answer.cookie, answer.userAgent, false);
        } else {
            fail(answer.code, answer.message, answer.reason);
        }
        console.log('[Ytm] The native YouTube Music sign-in handed its cookies over');
        return {};
    },
    // Android 上登录在 start 那一步一次性做完：这里把结果折回桌面端同一套状态，并给存盘放行。
    web_login_check: async () => {
        // 登录屏还开着是 waiting，不是 expired：界面据此继续等，而不是把这一轮判成失败。
        if (nativeSignInPending) return { state: 'waiting' };
        const user = await validateSession();
        return user ? { state: 'confirmed', account: user } : { state: 'expired' };
    },
    web_login_open: async () => ({}),
    // 取消把在途的登录作废：晚交回的 cookie 不再立会话。已登录的会话不受它影响。
    web_login_cancel: async () => {
        loginAttempts += 1;
        return {};
    },

    async search_songs(params) {
        const yt = await signedSession();
        let shelf: any;
        const continuation = pageToken(params.continuation);
        if (continuation !== undefined) {
            const page: any = await yt.actions.execute('/search', { continuation, client: 'YTMUSIC', parse: true });
            shelf = page.continuation_contents;
        } else {
            const query = boundedText(typeof params.query === 'string' ? params.query.trim() : null, 200)
                ?? fail('invalid-response', 'Search query is missing');
            const search: any = await yt.music.search(query, { type: 'song' });
            shelf = (search.contents ?? []).find((section: any) => section?.type === 'MusicShelf');
        }
        const items = (shelf?.contents ?? []).map((item: any) => songFromListItem(item)).filter(Boolean);
        return { items, ...(typeof shelf?.continuation === 'string' && shelf.continuation ? { continuation: shelf.continuation } : {}) };
    },

    async song_detail(params) {
        const id = videoId(params.id);
        const [yt, { YTNodes }] = await Promise.all([signedSession(), loadLibrary()]);
        return songOfWatchPage(await yt.actions.execute('/next', { videoId: id, client: 'YTMUSIC', parse: true }), id, YTNodes);
    },
    song_detail_en: params => songInLanguage(params, 'en'),
    song_detail_zh: params => songInLanguage(params, 'zh-CN'),

    async lyrics(params) {
        const id = videoId(params.id);
        const yt = await signedSession();
        const watch: any = await yt.actions.execute('/next', { videoId: id, client: 'YTMUSIC', parse: false });
        const browseId = lyricsBrowseId(watch.data);
        if (!browseId) return null;
        const mainText = lrcFromLyricsPage(await postJson(MOBILE_BROWSE_URL, { context: { client: MOBILE_CLIENT }, browseId }));
        return mainText ? { mainText } : null;
    },

    async album(params) {
        const id = entityId(params.id);
        if (!id?.startsWith('MPRE')) fail('invalid-response', 'Invalid album id');
        const yt = await signedSession();
        return albumFromPage(await yt.music.getAlbum(id!), id!);
    },

    async artist(params) {
        const id = entityId(params.id);
        if (!id?.startsWith('UC')) fail('invalid-response', 'Invalid artist id');
        const [yt, { YTNodes }] = await Promise.all([signedSession(), loadLibrary()]);
        const { albumShelves, ...artist } = artistFromPage(await yt.music.getArtist(id!), id!);
        const self = [{ id: id!, name: artist.collection.name }];
        const shelves = await Promise.all(albumShelves.map(async shelf => {
            if (!shelf.more) return shelf.items;
            try {
                const page: any = await shelf.more.call(yt.actions, { client: 'YTMUSIC', parse: true });
                const full = (page.contents_memo?.getType(YTNodes.MusicTwoRowItem) ?? [])
                    .map((item: any) => albumFromCard(item, self)).filter(Boolean) as YtmWireCollection[];
                return full.length > 0 ? full : shelf.items;
            } catch { return shelf.items; }
        }));
        const albums = [...new Map(shelves.flat().map(album => [album.id, album])).values()];
        return { ...artist, albums };
    },

    async public_playlist(params) {
        const id = entityId(params.id) ?? fail('invalid-response', 'Invalid playlist id');
        const continuation = pageToken(params.continuation);
        const [yt, { YTNodes }] = await Promise.all([signedSession(), loadLibrary()]);
        const page = await yt.actions.execute('/browse', {
            ...(continuation ? { continuation } : { browseId: `VL${id}` }), client: 'YTMUSIC', parse: true,
        });
        return playlistPageOf(page, Boolean(continuation), YTNodes);
    },

    async mix(params) {
        const id = entityId(params.id) ?? fail('invalid-response', 'Invalid mix id');
        const first = params.videoId === undefined ? undefined : videoId(params.videoId);
        const [yt, { YTNodes }] = await Promise.all([signedSession(), loadLibrary()]);
        const page: any = await yt.actions.execute('/next', {
            playlistId: id, ...(first ? { videoId: first } : {}), client: 'YTMUSIC', parse: true,
        });
        const entries = page.contents_memo?.getType(YTNodes.PlaylistPanelVideo) ?? [];
        return { items: entries.map((entry: any) => songFromQueueItem(entry)).filter(Boolean) };
    },

    account_history: params => readYtmAccountHistory({ loadLibrary, session: signedSession }, params),
    audio,
};

// 不经过会话门的操作放在一起，其余的数据操作在 requestYtmOnAndroid 里都过门。
const OPEN_DOOR_OPS = new Set<YtmOperation>([
    'login_status', 'logout', 'web_login_start', 'web_login_check', 'web_login_open', 'web_login_cancel',
]);

// 库和网络抛出的错带着请求地址和响应正文，只交出一个码和一句固定的话（带着它自己的 reason，如果有）。
const toErrorResult = (error: unknown): YtmBridgeResult => {
    if (error instanceof YtmAndroidError) {
        return { ok: false, error: { code: error.code, message: error.message, ...(error.reason ? { reason: error.reason } : {}) } };
    }
    const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    if (/status code 429\b|status 429\b/i.test(text)) {
        return { ok: false, error: { code: 'network', message: 'YouTube Music asked to wait before trying again' } };
    }
    if (/fetch|network|timeout|timed out|socket|unable to resolve|abort|status code 5\d\d\b|connect/i.test(text)) {
        return { ok: false, error: { code: 'network', message: 'YouTube Music could not be reached' } };
    }
    return { ok: false, error: { code: 'invalid-response', message: 'YouTube Music operation failed' } };
};

/** 和桌面版 window.electron.ytmRequest 一样的回答格式。 */
export const requestYtmOnAndroid = async (operation: YtmOperation, params: YtmParams): Promise<YtmBridgeResult> => {
    const handler = handlers[operation];
    if (!handler) {
        // 没接的操作只有两种答复：已登录的说还没能力做到，没登录的说去登录。空列表不说真话。
        return hasSession()
            ? { ok: false, error: { code: 'unsupported', message: `YouTube Music ${operation} is not available on Android` } }
            : { ok: false, error: { code: 'auth-required', message: 'Sign in to YouTube Music' } };
    }
    const run = OPEN_DOOR_OPS.has(operation) ? handler : gated(handler);
    try {
        return { ok: true, data: await run(params) };
    } catch (error) {
        if (!(error instanceof YtmAndroidError)) console.warn(`[Ytm] ${operation} failed on Android`, logged(error));
        return toErrorResult(error);
    }
};
