import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/nativeBridge/qqWriteDispatch.test.ts
//
// 直接走桥的入口（handleFoliaApiRequest），不是直接调写入处理函数：
// 现场出问题的那一层正是入口把 androidBridgeFetch 送来的字符串正文丢掉，
// 只测处理函数永远测不出来。

const COOKIE = [
    'uin=o002774749',
    'qqmusic_uin=o002774749',
    'str_musicid=3379082',
    'qm_keyst=MUSICKEY',
    'qqmusic_key=MUSICKEY',
    'login_type=1',
].join('; ');

const SONG_ID = 123456;
const SONG_MID = '0039MnYb0qxYhV';

vi.mock('@/nativeBridge/api/cookies.js', async importOriginal => ({
    ...(await importOriginal<typeof import('@/nativeBridge/api/cookies.js')>()),
    getQQCookie: async () => COOKIE,
}));

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
});

const installFetchStub = () => {
    const writes: Array<{ module: string; method: string; param: Record<string, any> }> = [];
    let liked = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        const payload = JSON.parse(String(init?.body || '{}'));
        const module = String(payload?.req_0?.module || '');
        const method = String(payload?.req_0?.method || '');
        const param = payload?.req_0?.param || {};

        if (module === 'music.pf_song_detail_svr') {
            return jsonResponse({ code: 0, req_0: { code: 0, data: { track_info: { id: SONG_ID, mid: SONG_MID } } } });
        }
        if (module === 'music.getSession.session') {
            return jsonResponse({ code: 0, req_0: { code: 0, data: { session: { uid: 'UID', sid: 'SID', vkey: 0 } } } });
        }
        if (module === 'music.musicasset.PlaylistBaseRead') {
            return jsonResponse({ code: 0, req_0: { code: 0, data: { v_playlist: [{ dirId: 201, dirName: '我喜欢' }] } } });
        }
        if (module === 'music.musicasset.SongFavRead') {
            return jsonResponse({ code: 0, req_0: { code: 0, data: { m_fan: { [SONG_MID]: liked } } } });
        }
        if (module === 'music.musicasset.PlaylistDetailWrite') {
            writes.push({ module, method, param });
            liked = method === 'AddSonglist';
            return jsonResponse({ code: 0, req_0: { code: 0, data: { retCode: 0, result: { dirId: 201, tid: 1 } } } });
        }
        return jsonResponse({ code: 0, req_0: { code: 0, data: {} } });
    }));
    return writes;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

const loadBridge = async () => (await import('@/nativeBridge/api/folia.js')).handleFoliaApiRequest;

describe('QQ write routes at the bridge entry', () => {
    it('takes the like body sent as a JSON string, not just an object', async () => {
        const writes = installFetchStub();
        const bridge = await loadBridge();
        const result = await bridge({
            provider: 'qq',
            operation: 'user_song_like',
            method: 'POST',
            path: '/user/song/like',
            body: JSON.stringify({ song: { id: SONG_ID, mid: SONG_MID, type: 0 }, liked: true }),
        });

        expect(result).not.toMatchObject({ __foliaBridgeError: 'UNSUPPORTED' });
        expect(result).toMatchObject({ code: 0, liked: true });
        expect(writes.length).toBeGreaterThan(0);
        expect(writes[0].method).toBe('AddSonglist');
    });

    it('still answers UNSUPPORTED when the body really is empty', async () => {
        installFetchStub();
        const bridge = await loadBridge();
        const result = await bridge({
            provider: 'qq',
            operation: 'user_song_like',
            method: 'POST',
            path: '/user/song/like',
            body: '{}',
        });

        expect(result).toMatchObject({ __foliaBridgeError: 'UNSUPPORTED' });
    });
});
