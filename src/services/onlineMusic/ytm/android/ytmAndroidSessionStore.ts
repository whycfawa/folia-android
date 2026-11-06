import { Capacitor, registerPlugin } from '@capacitor/core';

// src/services/onlineMusic/ytm/android/ytmAndroidSessionStore.ts
// 与原生 FoliaYtm 插件里会话存取三个方法封口。会话（cookie + 登录用的 UA）在原生侧用
// Android Keystore 的 AES-GCM 密钥加密落盘（YtmSessionStore.java）；这一侧只传话：字段的长短
// 形状都过了一遍，任何一边的值都不进日志。

/** 会话算「存在」需要的两个字段，各自的长度上限。 */
const COOKIE_LIMIT = 8192;
const UA_LIMIT = 256;
const FIELD_LIMIT = 48;

type NativeSessionBox = { ok?: unknown; session?: { cookie?: unknown; userAgent?: unknown } | null; error?: { code?: unknown; message?: unknown } };
type FoliaYtmStoreNative = {
    restoreSession(): Promise<NativeSessionBox>;
    saveSession(options: { cookie: string; userAgent: string }): Promise<NativeSessionBox>;
    clearSession(options?: { eraseCookies: boolean }): Promise<NativeSessionBox>;
};

const plugin = registerPlugin<FoliaYtmStoreNative>('FoliaYtm');

/** 存下的那个登录：cookie 与登录 WebView 自己的 UA，两个都有才算数。 */
export type StoredYtmSession = { cookie: string; userAgent: string };

const bounded = (value: unknown, limit: number): string => (
    typeof value === 'string' && value.length > 0 && value.length <= limit ? value : ''
);

/** 原生交回的会话逐字段过形状：缺一个、超长一个，都当作没有存过。 */
const foldSession = (answer: unknown): StoredYtmSession | null => {
    const envelope = (answer ?? {}) as NativeSessionBox;
    if (envelope.ok !== true) return null;
    const cookie = bounded(envelope.session?.cookie, COOKIE_LIMIT);
    const userAgent = bounded(envelope.session?.userAgent, UA_LIMIT);
    return cookie && userAgent && /^[\x20-\x7e]+$/.test(cookie) && /^[\x20-\x7e]+$/.test(userAgent)
        ? { cookie, userAgent } : null;
};

/** 冷启动读回存下的会话；没有、坏掉、或原生读不了，都答 null，不撒谎说不存。 */
export const restoreNativeSession = async (): Promise<StoredYtmSession | null> => {
    if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) return null;
    let answer: unknown;
    try {
        answer = await plugin.restoreSession();
    } catch (error) {
        console.warn('[Ytm] The stored YouTube Music session could not be read', error);
        return null;
    }
    const folded = foldSession(answer);
    if (folded) return folded;
    const native = bounded((answer as NativeSessionBox)?.error?.code, FIELD_LIMIT) || 'unknown';
    console.log(`[Ytm] The stored YouTube Music session was refused: ${native}`);
    return null;
};

/** 账号对过话之后把会话存下去；存好了才算，存不上只记一行，不挡登录。 */
export const saveNativeSession = async (session: StoredYtmSession): Promise<boolean> => {
    if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) return false;
    if (!foldSession({ ok: true, session })) return false;
    let answer: unknown;
    try {
        answer = await plugin.saveSession({ cookie: session.cookie, userAgent: session.userAgent });
    } catch (error) {
        console.warn('[Ytm] The YouTube Music session could not be stored', error);
        return false;
    }
    const ok = (answer as NativeSessionBox)?.ok === true;
    if (!ok) {
        const native = bounded((answer as NativeSessionBox)?.error?.code, FIELD_LIMIT) || 'unknown';
        console.warn(`[Ytm] The YouTube Music session was not stored: ${native}`);
    }
    return ok;
};

/** 登出把存着的会话抹掉（原生侧还会顺手清 Google / YouTube 自己的 cookie）。 */
export const clearNativeSession = async (eraseCookies = true): Promise<boolean> => {
    if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) return false;
    try {
        return (await plugin.clearSession({ eraseCookies }))?.ok === true;
    } catch (error) {
        console.warn('[Ytm] The stored YouTube Music session could not be erased', error);
        return false;
    }
};
