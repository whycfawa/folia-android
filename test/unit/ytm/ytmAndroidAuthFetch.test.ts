import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmAndroidAuthFetch.test.ts
// 带账户头的请求只许跟 YouTube 的精确主机走（ytmNativeFetch.ts）；不让原生端跟随重定向。

const request = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request } }));
import { setYtmNativeAgent, ytmNativeFetch } from '@/services/onlineMusic/ytm/android/ytmNativeFetch';

const answerOf = (status: number, data: unknown, url = '') => ({ status, headers: {}, data, url });

/** 头大小写不敏感地取出来（调用方怎么写都行）。 */
const headerOf = (config: { headers: Record<string, string> }, name: string): string | undefined => (
    Object.entries(config.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
);

beforeEach(() => {
    request.mockReset();
});

describe('account headers only go to YouTube', () => {
    it('refuses to send the cookies anywhere else, and never sends the request at all', async () => {
        await expect(ytmNativeFetch('https://api.example.test/botguard', {
            method: 'POST', headers: { Cookie: 'SAPISID=sap' }, body: '{}',
        })).rejects.toThrow('account headers are only sent to the exact YouTube Music and YouTube hosts');
        expect(request).not.toHaveBeenCalled();
    });

    it('refuses the bare youtube.com and every http address for the account headers', async () => {
        await expect(ytmNativeFetch('https://youtube.com/youtubei/v1/browse', {
            method: 'POST', headers: { Cookie: 'SAPISID=sap' }, body: '{}',
        })).rejects.toThrow('account headers');
        await expect(ytmNativeFetch('http://music.youtube.com/youtubei/v1/browse', {
            method: 'POST', headers: { Cookie: 'SAPISID=sap' }, body: '{}',
        })).rejects.toThrow('clean https addresses');
        expect(request).not.toHaveBeenCalled();
    });

    it('refuses userinfo and non-default ports over the account headers too', async () => {
        await expect(ytmNativeFetch('https://biz@music.youtube.com/youtubei/v1/browse', {
            method: 'POST', headers: { Cookie: 'SAPISID=sap' }, body: '{}',
        })).rejects.toThrow('clean https addresses');
        await expect(ytmNativeFetch('https://music.youtube.com:8443/youtubei/v1/browse', {
            headers: { Cookie: 'SAPISID=sap' },
        })).rejects.toThrow('clean https addresses');
        expect(request).not.toHaveBeenCalled();
    });

    it('never restates the raw address and its query in the error', async () => {
        await expect(ytmNativeFetch('https://attacker.test/kingdom?secret=account-cookies', {
            headers: { Cookie: 'SAPISID=sap' },
        })).rejects.toThrow(expect.not.stringContaining('secret='));
        await expect(ytmNativeFetch('not even a URL?', {
            headers: { Cookie: 'SAPISID=sap' },
        })).rejects.toThrow(expect.not.stringContaining('?'));
    });

    it('carries the cookies to music.youtube.com and disables redirect following', async () => {
        request.mockResolvedValue(answerOf(200, '{}', 'https://music.youtube.com/youtubei/v1/browse'));
        const response = await ytmNativeFetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'SAPISID=sap', Authorization: 'SAPISIDHASH 1_2' }, body: '{}',
        });
        expect(response.status).toBe(200);
        expect(response.url).toBe('https://music.youtube.com/youtubei/v1/browse');
        expect(request).toHaveBeenCalledTimes(1);
        const config = request.mock.calls[0][0];
        expect(config).toMatchObject({ url: 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', disableRedirects: true });
        // 头按传进来的走，桌面 UA 只在没有时补上。
        expect(config.headers).toMatchObject({
            cookie: 'SAPISID=sap', authorization: 'SAPISIDHASH 1_2', 'content-type': 'application/json',
            'User-Agent': expect.stringContaining('Mozilla/5.0'),
        });
    });

    it('signs secure-only cookies only after the exact-host check', async () => {
        request.mockResolvedValue(answerOf(200, '{}'));
        await ytmNativeFetch('https://music.youtube.com/youtubei/v1/account/accounts_list', {
            method: 'POST', headers: { Cookie: '__Secure-3PAPISID=fixture-only' }, body: '{}',
        });
        const config = request.mock.calls[0][0];
        expect(headerOf(config, 'authorization')).toMatch(/^SAPISIDHASH \d+_[a-f0-9]{40} SAPISID3PHASH /);
        expect(config.disableRedirects).toBe(true);
        expect(headerOf(config, 'x-goog-authuser')).toBe('0');
        expect(headerOf(config, 'origin')).toBe('https://www.youtube.com');
        expect(headerOf(config, 'x-origin')).toBe('https://www.youtube.com');
    });

    it('sets no redirect switch and no account fix for requests without credentials', async () => {
        request.mockResolvedValue(answerOf(200, '{}'));
        await ytmNativeFetch('https://www.google.com/generate_204');
        const config = request.mock.calls[0][0];
        expect(config).not.toHaveProperty('disableRedirects');
        expect(config.headers['User-Agent']).toContain('Mozilla/5.0');
        expect(headerOf(config, 'origin')).toBeUndefined();
        expect(headerOf(config, 'authorization')).toBeUndefined();
    });

    it('returns a redirect answer of YouTube as it is, unfollowed', async () => {
        request.mockResolvedValue(answerOf(302, '', 'https://www.youtube.com/redirect?usp=something'));
        const response = await ytmNativeFetch('https://www.youtube.com/watch?v=m9SMT5ipbxk', {
            headers: { Cookie: 'SAPISID=sap' },
        });
        expect(response.status).toBe(302);
        expect(response.url).toContain('/redirect');
    });

    it('guards the page id like the other account headers', async () => {
        await expect(ytmNativeFetch('https://api.example.test/history', {
            headers: { 'X-Goog-PageId': 'UCpage' },
        })).rejects.toThrow('account headers');
        expect(request).not.toHaveBeenCalled();
        request.mockResolvedValue(answerOf(200, '{}'));
        await ytmNativeFetch('https://music.youtube.com/youtubei/v1/browse', {
            method: 'POST', headers: { 'X-Goog-PageId': 'UCpage' }, body: '{}',
        });
        expect(request.mock.calls[0][0]).toMatchObject({ disableRedirects: true });
    });
});

describe('the user agent of the sign-in session', () => {
    afterEach(() => setYtmNativeAgent(null));

    it('follows the agent the session kept, and does not overwrite what a caller wrote', async () => {
        request.mockResolvedValue(answerOf(200, '{}'));
        setYtmNativeAgent('Sign-in UA');
        await ytmNativeFetch('https://music.youtube.com/youtubei/v1/browse', { headers: { Cookie: 'SAPISID=sap' } });
        expect(headerOf(request.mock.calls[0][0], 'User-Agent')).toBe('Sign-in UA');
        await ytmNativeFetch('https://music.youtube.com/youtubei/v1/browse', {
            headers: { Cookie: 'SAPISID=sap', 'User-Agent': 'Caller UA' },
        });
        expect(headerOf(request.mock.calls[1][0], 'User-Agent')).toBe('Caller UA');
    });

    it('falls back to the desktop agent once the session is gone', async () => {
        request.mockResolvedValue(answerOf(200, '{}'));
        setYtmNativeAgent('Sign-in UA');
        setYtmNativeAgent(null);
        await ytmNativeFetch('https://www.google.com/generate_204');
        expect(request.mock.calls[0][0].headers['User-Agent']).toContain('Mozilla/5.0');
    });
});
