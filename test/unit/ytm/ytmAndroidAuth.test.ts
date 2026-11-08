import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ytmCookieAuthorization } from '@/services/onlineMusic/ytm/android/ytmAndroidAuth';

// Regression for real WebView handoffs with only __Secure-* SID cookies (no SAPISID).
const expected = (name: string, value: string) => `${name} 1700000000_${createHash('sha1')
    .update(`1700000000 ${value} https://www.youtube.com`).digest('hex')}`;

describe('Android cookie authorization', () => {
    it('signs legacy SAPISID using the same canonical origin as youtubei.js', async () => {
        expect(await ytmCookieAuthorization('SID=unrelated; SAPISID=fixture', 1700000000000))
            .toBe(expected('SAPISIDHASH', 'fixture'));
    });

    it('signs secure-only WebView cookies without fabricating a SAPISID cookie', async () => {
        const cookie = '__Secure-1PAPISID=first; __Secure-3PAPISID=third; LOGIN_INFO=unrelated';
        expect(await ytmCookieAuthorization(cookie, 1700000000000)).toBe([
            expected('SAPISIDHASH', 'third'), expected('SAPISID1PHASH', 'first'), expected('SAPISID3PHASH', 'third'),
        ].join(' '));
    });

    it('never treats an anonymous visitor cookie as account authorization', async () => {
        expect(await ytmCookieAuthorization('VISITOR_INFO1_LIVE=anonymous')).toBeNull();
        expect(await ytmCookieAuthorization('NOTSAPISID=not-a-session')).toBeNull();
        expect(await ytmCookieAuthorization('SAPISID=')).toBeNull();
    });
});
