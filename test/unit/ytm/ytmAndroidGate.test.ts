import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmAndroidGate.test.ts
// Android 上的会话门（ytmAndroidBridge.ts）：登录以外的每个操作都得等已登录的门；没有访客模式。
// 会话的生命周期也在这里：登录屏交回的要验证过账号才落盘；冷启动读回的要对过真账号才过门；
// 登出清掉内存里和盘上的；在途的那一轮在取消或登出之后，晚到的原生结果不许再立会话。

const native = vi.hoisted(() => ({
    signIn: vi.fn(),
    restoreSession: vi.fn(),
    saveSession: vi.fn(),
    clearSession: vi.fn(),
}));
const youtube = vi.hoisted(() => ({ create: vi.fn() }));
const httpons = vi.hoisted(() => ({ request: vi.fn() }));
const filesystem = vi.hoisted(() => ({
    readdir: vi.fn(), deleteFile: vi.fn(), mkdir: vi.fn(), stat: vi.fn(), downloadFile: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: (name: string) => (name === 'FoliaYtm' ? native : undefined),
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', convertFileSrc: (x: string) => `converted:${x}` },
    CapacitorHttp: httpons,
}));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: filesystem }));
// youtubei.js 在 WebView 里加载；门要关上时留给它的唯一证据就是它一次也没被加载。
vi.mock('youtubei.js', () => ({
    Innertube: { create: youtube.create },
    Platform: { shim: {} },
    Parser: { setParserErrorHandler: () => undefined },
    Constants: { CLIENTS: { YTMUSIC: { NAME: 'YTMUSIC', VERSION: '1.0' } } },
    YTNodes: {},
}));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
import type { YtmOperation } from '@/services/onlineMusic/ytm/ytmTransport';

// 原生那一罐的假账：restore 读到的就是罐里存的，save 写进去，clear 抹掉。
const cannedSession = vi.hoisted(() => ({ box: null as unknown }));
cannedSession.box = null;
native.restoreSession.mockImplementation(async () => ({ ok: true, session: cannedSession.box }));
native.saveSession.mockImplementation(async (options: unknown) => {
    cannedSession.box = options ?? null;
    return { ok: true };
});
native.clearSession.mockImplementation(async () => {
    cannedSession.box = null;
    return { ok: true };
});

// 会话状态在模块的闭包里：每个用例都换一个全新的模块，从干净出发。
let requestYtmOnAndroid!: typeof import('@/services/onlineMusic/ytm/android/ytmAndroidBridge').requestYtmOnAndroid;
beforeEach(async () => {
    cannedSession.box = null;
    native.signIn.mockReset();
    native.signIn.mockResolvedValue(undefined);
    native.restoreSession.mockReset();
    native.saveSession.mockReset();
    native.clearSession.mockReset();
    native.restoreSession.mockImplementation(async () => ({ ok: true, session: cannedSession.box }));
    native.saveSession.mockImplementation(async (options: unknown) => {
        cannedSession.box = options ?? null;
        return { ok: true };
    });
    native.clearSession.mockImplementation(async () => {
        cannedSession.box = null;
        return { ok: true };
    });
    youtube.create.mockReset();
    httpons.request.mockReset();
    vi.resetModules();
    ({ requestYtmOnAndroid } = await import('@/services/onlineMusic/ytm/android/ytmAndroidBridge'));
});

const signedIn = async () => {
    native.signIn.mockResolvedValue({ ok: true, session: { cookie: 'SAPISID=sap; SID=sid', userAgent: 'UA' } });
    expect(await requestYtmOnAndroid('web_login_start', {})).toEqual({ ok: true, data: {} });
};

// 需要一个「读得出账号」的 youtubei.js 会话：账号三件套都给全。
const webAccount = () => ({ data: { responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'logged_in', value: '1' }] }] }, actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [{ accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [{ accountItem: { isSelected: true, accountName: { simpleText: 'Fixture' }, channelHandle: { simpleText: '@fixture' }, accountPhoto: { thumbnails: [{ url: 'photo' }] } } }] } }] } }] } } } }] } });
const accountSession = () => {
    youtube.create.mockResolvedValue({ actions: { execute: vi.fn(async () => webAccount()) }, music: { search: vi.fn() } });
};

describe('the YouTube Music gate on Android', () => {
    it('answers auth-required with no session and never builds one', async () => {
        for (const operation of ['search_songs', 'audio', 'lyrics', 'album', 'artist', 'mix', 'song_detail', 'public_playlist'] as YtmOperation[]) {
            expect(await requestYtmOnAndroid(operation, { id: 'm9SMT5ipbxk', quality: 'high' }))
                .toMatchObject({ ok: false, error: { code: 'auth-required' } });
        }
        expect(youtube.create).not.toHaveBeenCalled();
        expect(httpons.request).not.toHaveBeenCalled();
        expect(native.signIn).not.toHaveBeenCalled();
    });

    it('answers login_status with no account and logout without one', async () => {
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({ ok: true, data: null });
        expect(await requestYtmOnAndroid('logout', {})).toEqual({ ok: true, data: {} });
        expect(youtube.create).not.toHaveBeenCalled();
    });

    it('keeps the not-yet-port operations honest: authentication first, then unsupported', async () => {
        for (const operation of ['playlist', 'user_playlists', 'user_albums', 'explore', 'playlist_edit', 'list_save', 'list_saved', 'song_like'] as YtmOperation[]) {
            expect(await requestYtmOnAndroid(operation, { id: 'x' })).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        }
        await signedIn();
        for (const operation of ['playlist', 'user_playlists', 'user_albums', 'explore', 'playlist_edit', 'list_save', 'list_saved', 'song_like'] as YtmOperation[]) {
            expect(await requestYtmOnAndroid(operation, { id: 'x' })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        }
    });

    it('hands the cookie over and builds the signed session with it', async () => {
        accountSession();
        await signedIn();
        // 存盘只认应用自己验证过的会话：登录屏交回来、还没对过账号，先一个字节都不写。
        expect(native.saveSession).not.toHaveBeenCalled();
        expect(await requestYtmOnAndroid('login_status', {})).toMatchObject({ ok: true, data: { nickname: 'Fixture' } });
        expect(youtube.create).toHaveBeenCalledWith(expect.objectContaining({
            cookie: 'SAPISID=sap; SID=sid', user_agent: 'UA', lang: 'en', retrieve_player: false,
        }));
        // 验证过之后才落盘，cookie 与 UA 一对。
        expect(native.saveSession).toHaveBeenCalledWith({ cookie: 'SAPISID=sap; SID=sid', userAgent: 'UA' });
        expect(cannedSession.box).toEqual({ cookie: 'SAPISID=sap; SID=sid', userAgent: 'UA' });
    });

    it('reads the signed-in account through the session', async () => {
        const account = accountSession();
        await signedIn();
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({
            ok: true, data: { id: expect.stringMatching(/^[a-f0-9]{64}$/), nickname: 'Fixture', avatarUrl: 'photo' },
        });
    });

    it('answers web_login_check with the same states as the desktop side', async () => {
        expect(await requestYtmOnAndroid('web_login_check', {})).toEqual({ ok: true, data: { state: 'expired' } });
        accountSession();
        await signedIn();
        expect(await requestYtmOnAndroid('web_login_check', {})).toEqual({
            ok: true, data: { state: 'confirmed', account: { id: expect.stringMatching(/^[a-f0-9]{64}$/), nickname: 'Fixture', avatarUrl: 'photo' } },
        });
    });

    it('lets search pass the gate and run through the signed session', async () => {
        const search = vi.fn(async () => ({ contents: [] }));
        youtube.create.mockResolvedValue({ actions: { execute: vi.fn(async () => webAccount()) }, music: { search } });
        await signedIn();
        expect(await requestYtmOnAndroid('search_songs', { query: 'YOASOBI' })).toEqual({ ok: true, data: { items: [] } });
        expect(search).toHaveBeenCalledWith('YOASOBI', { type: 'song' });
    });

    it('folds the native sign-in refusal into the report', async () => {
        native.signIn.mockResolvedValue({ ok: false, error: { code: 'cancelled', message: 'The YouTube Music sign-in was cancelled' } });
        expect(await requestYtmOnAndroid('web_login_start', {})).toEqual({
            ok: false, error: { code: 'auth-required', message: 'The YouTube Music sign-in was cancelled', reason: 'cancelled' },
        });
        expect(youtube.create).not.toHaveBeenCalled();
    });

    it('discards an operation of a session that ended while it ran', async () => {
        let release!: (value: unknown) => void;
        const search = vi.fn(() => new Promise(resolve => { release = resolve; }));
        youtube.create.mockResolvedValue({ actions: { execute: vi.fn(async () => webAccount()) }, music: { search } });
        await signedIn();
        const running = requestYtmOnAndroid('search_songs', { query: 'YOASOBI' });
        await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
        await requestYtmOnAndroid('logout', {});
        release({ contents: [] });
        expect(await running).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        expect(search).toHaveBeenCalledOnce();
    });

    it('answers with auth-required when a new sign-in starts without a cookie', async () => {
        native.signIn.mockResolvedValue({ ok: false, error: { code: 'cancelled', message: 'The YouTube Music sign-in was cancelled' } });
        expect(await requestYtmOnAndroid('web_login_start', {})).toMatchObject({ ok: false, error: { code: 'auth-required', reason: 'cancelled' } });
        // 被中途取消的登录不该留下半个会话：数据操作还是过不去。
        expect(await requestYtmOnAndroid('search_songs', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'auth-required' } });
    });

    it('discards a native sign-in whose round was cancelled while it ran', async () => {
        let settle!: (value: unknown) => void;
        native.signIn.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
        const starting = requestYtmOnAndroid('web_login_start', {});
        await vi.waitFor(() => expect(native.signIn.mock.calls.length).toBe(1));
        await requestYtmOnAndroid('web_login_cancel', {});
        // 登录屏过了一阵才把 cookie 交回来：round 已经作废，cookie 不许再立会话。
        settle({ ok: true, session: { cookie: 'SAPISID=late', userAgent: 'UA' } });
        expect(await starting).toEqual({ ok: true, data: {} });
        expect(await requestYtmOnAndroid('search_songs', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        expect(youtube.create).not.toHaveBeenCalled();
        expect(native.saveSession).not.toHaveBeenCalled();
    });

    it('discards a native sign-in whose round was ended by a logout while it ran', async () => {
        let settle!: (value: unknown) => void;
        native.signIn.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
        const clears = native.clearSession.mock.calls.length;
        const starting = requestYtmOnAndroid('web_login_start', {});
        await vi.waitFor(() => expect(starting).toBeDefined());
        await requestYtmOnAndroid('logout', {});
        expect(native.clearSession.mock.calls.length).toBe(clears + 1);
        settle({ ok: true, session: { cookie: 'SAPISID=late', userAgent: 'UA' } });
        expect(await starting).toEqual({ ok: true, data: {} });
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({ ok: true, data: null });
        expect(native.saveSession).not.toHaveBeenCalled();
    });

    it('restores a stored session for the next run only together with its real account', async () => {
        cannedSession.box = { cookie: 'SAPISID=kept', userAgent: 'kept UA' };
        accountSession();
        // 冷启动第一次读登录状态：读回来的 cookie 先对着 YouTube 问真账号，问到才答有账号。
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({
            ok: true, data: { id: expect.stringMatching(/^[a-f0-9]{64}$/), nickname: 'Fixture', avatarUrl: 'photo' },
        });
        expect(youtube.create).toHaveBeenCalledWith(expect.objectContaining({ cookie: 'SAPISID=kept', user_agent: 'kept UA' }));
    });

    it('opens the gate for a restored session only after the account read', async () => {
        cannedSession.box = { cookie: 'SAPISID=kept', userAgent: 'kept UA' };
        const called: string[] = [];
        const getInfo = vi.fn(async () => { called.push('account'); return webAccount(); });
        const search = vi.fn(async () => { called.push('search'); return { contents: [] }; });
        youtube.create.mockResolvedValue({ actions: { execute: getInfo }, music: { search } });
        expect(await requestYtmOnAndroid('search_songs', { query: 'YOASOBI' })).toEqual({ ok: true, data: { items: [] } });
        // 先对账号、再放数据：门没有在读回来的 cookie 面前直接打开。
        expect(called).toEqual(['account', 'search']);
    });

    it('erases a restored session that YouTube refuses, and tells the truth about it', async () => {
        cannedSession.box = { cookie: 'SAPISID=stale', userAgent: 'kept UA' };
        // YouTube 明拒 401：连落盘那份一起清掉，别让每次启动都白读一遍。
        youtube.create.mockResolvedValue({
            actions: {
                execute: async () => { throw new Error('Request to https://music.youtube.com/youtubei/v1/account/accounts_list?prettyPrint=false failed with status code 401'); },
            },
        });
        const clears = native.clearSession.mock.calls.length;
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({ ok: true, data: null });
        expect(native.clearSession.mock.calls.length).toBe(clears + 1);
        expect(native.clearSession).toHaveBeenLastCalledWith({ eraseCookies: false });
        expect(cannedSession.box).toBeNull();
        expect(await requestYtmOnAndroid('search_songs', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        // 数据操作不再把读回来的那份当作自己的会话：真钱袋（save）一直没开过。
        expect(native.saveSession).not.toHaveBeenCalled();
    });

    it('leaves a restored session for another try when the network is the one that failed', async () => {
        cannedSession.box = { cookie: 'SAPISID=kept', userAgent: 'kept UA' };
        youtube.create.mockResolvedValue({ actions: { execute: async () => { throw new Error('fetch failed: network unreachable'); } } });
        const clears = native.clearSession.mock.calls.length;
        expect(await requestYtmOnAndroid('login_status', {})).toMatchObject({ ok: false, error: { code: 'network' } });
        // 网络抖动不算「没登录」：读回来的那份留着，盘上的不清。
        expect(native.clearSession.mock.calls.length).toBe(clears);
        expect(cannedSession.box).not.toBeNull();
        expect(await requestYtmOnAndroid('login_status', {})).toMatchObject({ ok: false });
    });

    it('erases what is stored on a plain logout too', async () => {
        cannedSession.box = { cookie: 'SAPISID=kept', userAgent: 'kept UA' };
        accountSession();
        expect(await requestYtmOnAndroid('login_status', {})).toMatchObject({ ok: true });
        // 验证过的读回会话本来就在盘上，不重写一份。
        expect(native.saveSession).not.toHaveBeenCalled();
        await requestYtmOnAndroid('logout', {});
        expect(cannedSession.box).toBeNull();
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({ ok: true, data: null });
    });

    it('does not accept an account-shaped guest response without the signed-in mark', async () => {
        const guest = webAccount();
        guest.data.responseContext.serviceTrackingParams[0].params[0].value = '0';
        youtube.create.mockResolvedValue({ actions: { execute: async () => guest } });
        await signedIn();
        expect(await requestYtmOnAndroid('web_login_check', {})).toMatchObject({ ok: true, data: { state: 'expired' } });
        expect(native.saveSession).not.toHaveBeenCalled();
        expect(await requestYtmOnAndroid('search_songs', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'auth-required' } });
    });

    it('queues logout after an in-flight save and never resurrects the disk session', async () => {
        accountSession();
        let finishSave!: () => void;
        native.saveSession.mockImplementation(options => new Promise(resolve => {
            finishSave = () => { cannedSession.box = options; resolve({ ok: true }); };
        }));
        await signedIn();
        const checking = requestYtmOnAndroid('login_status', {});
        await vi.waitFor(() => expect(native.saveSession).toHaveBeenCalledOnce());
        const logout = requestYtmOnAndroid('logout', {});
        expect(native.clearSession).not.toHaveBeenCalled();
        finishSave();
        expect(await checking).toMatchObject({ ok: true, data: null });
        expect(await logout).toMatchObject({ ok: true });
        expect(cannedSession.box).toBeNull();
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({ ok: true, data: null });
    });

    it('does not reuse an older pending validation after a new sign-in', async () => {
        let finishOld!: (value: unknown) => void;
        const old = { actions: { execute: vi.fn(() => new Promise(resolve => { finishOld = resolve; })) } };
        youtube.create.mockResolvedValueOnce(old).mockResolvedValue({ actions: { execute: async () => webAccount() } });
        await signedIn();
        const previous = requestYtmOnAndroid('login_status', {});
        await vi.waitFor(() => expect(old.actions.execute).toHaveBeenCalledOnce());
        await requestYtmOnAndroid('logout', {});
        await signedIn();
        expect(await requestYtmOnAndroid('login_status', {})).toMatchObject({ ok: true, data: { nickname: 'Fixture' } });
        finishOld(webAccount());
        expect(await previous).toEqual({ ok: true, data: null });
        expect(await requestYtmOnAndroid('login_status', {})).toMatchObject({ ok: true, data: { nickname: 'Fixture' } });
    });

    it('reports a failed native logout clear rather than claiming success', async () => {
        native.clearSession.mockResolvedValue({ ok: false });
        expect(await requestYtmOnAndroid('logout', {})).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'logout-clear-failed' } });
    });

    it('does not report persistent sign-in when the native encrypted save failed', async () => {
        accountSession();
        native.saveSession.mockResolvedValue({ ok: false });
        await signedIn();
        expect(await requestYtmOnAndroid('web_login_check', {})).toMatchObject({
            ok: false, error: { code: 'unavailable', reason: 'session-save-failed' },
        });
        expect(await requestYtmOnAndroid('search_songs', { query: 'x' })).toMatchObject({ ok: false });
        expect(cannedSession.box).toBeNull();
    });

    it('fills nothing in when the native store hands over a story of the wrong shape', async () => {
        native.restoreSession.mockImplementation(async () => ({ ok: true, session: { cookie: 'SAPISID=half' } }));
        expect(await requestYtmOnAndroid('login_status', {})).toEqual({ ok: true, data: null });
        expect(youtube.create).not.toHaveBeenCalled();
        expect(await requestYtmOnAndroid('search_songs', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'auth-required' } });
    });
});
