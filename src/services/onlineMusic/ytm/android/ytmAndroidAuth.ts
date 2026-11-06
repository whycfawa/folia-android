// Android WebView can issue only secure SID cookies; youtubei.js 18 recognizes SAPISID alone.
const cookieValue = (cookie: string, name: string): string | undefined => cookie.split(';')
    .map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || undefined;

/** Sign the actual account cookies, without inventing a login or exposing any secret to logs. */
export const ytmCookieAuthorization = async (cookie: string, now = Date.now()): Promise<string | null> => {
    const sid = cookieValue(cookie, 'SAPISID');
    const firstParty = cookieValue(cookie, '__Secure-1PAPISID');
    const thirdParty = cookieValue(cookie, '__Secure-3PAPISID');
    const timestamp = Math.floor(now / 1000);
    const sign = async (name: string, value: string): Promise<string> => {
        // youtubei.js signs its WEB/YTMUSIC session against the canonical YouTube origin.
        const data = new TextEncoder().encode(`${timestamp} ${value} https://www.youtube.com`);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
        return `${name} ${timestamp}_${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
    };
    const base = sid || thirdParty || firstParty;
    if (!base) return null;
    const parts = [await sign('SAPISIDHASH', base)];
    if (firstParty) parts.push(await sign('SAPISID1PHASH', firstParty));
    if (thirdParty) parts.push(await sign('SAPISID3PHASH', thirdParty));
    return parts.join(' ');
};
