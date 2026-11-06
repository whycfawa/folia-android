import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ProviderErrorCode } from '../../../../types/onlineMusic';
import i18n from '../../../../i18n/config';

// src/services/onlineMusic/ytm/android/ytmAndroidSignIn.ts
// 安卓上 YouTube Music 登录的这一侧封口：把登录屏顶栏要用的三句话按 i18n 翻好传下去（原生侧没有自己的
// 文案系统），原生 FoliaYtm 里那座登录 Activity 完成后把 YouTube 的 cookie 交回来。cookie 就是账号的
// 凭据：只在这里定型、只留在内存里，不落盘，也不写进日志。

/** 交回的字段都过一遍长度和形状：原生的话不直接当协议用。 */
const COOKIE_LIMIT = 8192;
const UA_LIMIT = 256;
const CODE_LIMIT = 48;
const MESSAGE_LIMIT = 300;
// 原生没交回 UA 时的兜底：和 ytmNativeFetch 的默认一致。
const DEFAULT_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

type NativeSignInAnswer = { ok?: unknown; session?: { cookie?: unknown; userAgent?: unknown }; error?: { code?: unknown; message?: unknown } };
type FoliaYtmNative = { signIn(options: { title: string; cancelLabel: string; doneLabel: string }): Promise<NativeSignInAnswer> };

const plugin = registerPlugin<FoliaYtmNative>('FoliaYtm');

/** 原生一侧的关键字是「为什么没成」：一路带着它是 reason，登录报告才查得清。 */
export type YtmNativeSignIn = { ok: true; cookie: string; userAgent: string } | { ok: false; code: ProviderErrorCode; reason: string; message: string };

const bounded = (value: unknown, limit: number): string => (
    typeof value === 'string' && value.length > 0 && value.length <= limit ? value : ''
);

// 原生只报两样：这台设备没有这条路（unavailable），和登录这一轮没成（auth-required，原因走 reason）。
const foldCode = (native: string): ProviderErrorCode => (native === 'unavailable' ? 'unavailable' : 'auth-required');

const foldAnswer = (answer: unknown): YtmNativeSignIn => {
    const envelope = (answer ?? {}) as NativeSignInAnswer;
    const cookie = bounded(envelope.session?.cookie, COOKIE_LIMIT);
    // 登录 WebView 自己的 UA 一起交回来：之后带账户的请求跟着它发，不再另编一个。
    const userAgent = bounded(envelope.session?.userAgent, UA_LIMIT);
    if (envelope.ok === true && cookie && /^[\x20-\x7e]+$/.test(cookie)
        && (!userAgent || /^[\x20-\x7e]+$/.test(userAgent))) {
        return { ok: true, cookie, userAgent: userAgent || DEFAULT_AGENT };
    }
    const native = bounded(envelope.error?.code, CODE_LIMIT);
    return {
        ok: false, code: foldCode(native),
        reason: native || 'unknown',
        message: bounded(envelope.error?.message, MESSAGE_LIMIT) || 'The YouTube Music sign-in did not finish',
    };
};

/** 起原生登录屏并等它交回 cookie；三句话按 i18n 当下的语言给出。 */
export const signInWithYtmNative = async (): Promise<YtmNativeSignIn> => {
    if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) {
        return { ok: false, code: 'unavailable', reason: 'unavailable', message: 'YouTube Music sign-in needs the Android app' };
    }
    let answer: unknown;
    try {
        answer = await plugin.signIn({
            title: String(i18n.t('home.loginTitleYtm')),
            cancelLabel: String(i18n.t('home.ytmSignInCancel')),
            doneLabel: String(i18n.t('home.ytmSignInDone')),
        });
    } catch (error) {
        console.warn('[Ytm] The native YouTube Music sign-in could not be started', error);
        return { ok: false, code: 'unavailable', reason: 'unavailable', message: 'The YouTube Music sign-in could not be started' };
    }
    return foldAnswer(answer);
};
