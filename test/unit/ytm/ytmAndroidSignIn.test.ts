import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmAndroidSignIn.test.ts
// 安卓登录这一侧的封口（ytmAndroidSignIn.ts）：i18n 的三句话传给原生、原生的话只报两样
// （unavailable / auth-required），拿不准的原生答案折下来不撒谎。

const signIn = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/core', () => ({
    registerPlugin: () => ({ signIn }),
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => `文本:${key}` } }));
import { signInWithYtmNative } from '@/services/onlineMusic/ytm/android/ytmAndroidSignIn';

beforeEach(() => {
    signIn.mockReset();
});

describe('sign-in with the native YouTube Music screen', () => {
    it('passes the three bar texts from i18n and folds the handed-over cookies', async () => {
        signIn.mockResolvedValue({ ok: true, session: { cookie: 'SAPISID=sap; SID=sid', userAgent: 'Sign-in UA' } });
        expect(await signInWithYtmNative()).toEqual({ ok: true, cookie: 'SAPISID=sap; SID=sid', userAgent: 'Sign-in UA' });
        expect(signIn).toHaveBeenCalledWith({
            title: '文本:home.loginTitleYtm',
            cancelLabel: '文本:home.ytmSignInCancel',
            doneLabel: '文本:home.ytmSignInDone',
        });
    });

    it('falls back to the desktop agent when the native side names no UA, and bounds a long one', async () => {
        signIn.mockResolvedValue({ ok: true, session: { cookie: 'SAPISID=sap' } });
        expect(await signInWithYtmNative()).toMatchObject({ ok: true, userAgent: expect.stringContaining('Mozilla/5.0') });
        signIn.mockResolvedValue({ ok: true, session: { cookie: 'SAPISID=sap', userAgent: 'x'.repeat(300) } });
        expect(await signInWithYtmNative()).toMatchObject({ ok: true, userAgent: expect.stringContaining('Mozilla/5.0') });
    });

    it.each([
        ['nothing at all', {}, { ok: false, code: 'auth-required', reason: 'unknown' }],
        ['ok with no cookie', { ok: true }, { ok: false, code: 'auth-required', reason: 'unknown' }],
        ['cookie of another shape', { ok: true, cookie: 48 }, { ok: false, code: 'auth-required', reason: 'unknown' }],
        ['a native cancelled', { ok: false, error: { code: 'cancelled', message: 'closed plainly' } }, { ok: false, code: 'auth-required', reason: 'cancelled' }],
        ['a native failure', { ok: false, error: { code: 'sign-in-failed', message: 'not in time' } }, { ok: false, code: 'auth-required', reason: 'sign-in-failed' }],
    ])('folds %s into an honest not-ok answer', async (_name, answer, expected) => {
        signIn.mockResolvedValue(answer);
        expect(await signInWithYtmNative()).toEqual({ ...expected, message: expect.any(String) });
    });

    it('keeps the unavailable code when the screen cannot open', async () => {
        signIn.mockResolvedValue({ ok: false, error: { code: 'unavailable', message: 'no launcher yet' } });
        expect(await signInWithYtmNative()).toEqual({ ok: false, code: 'unavailable', reason: 'unavailable', message: 'no launcher yet' });
    });

    it('treats a native rejection as unavailable, not as a failed sign-in', async () => {
        signIn.mockRejectedValue(new Error('bridge is gone'));
        expect(await signInWithYtmNative()).toMatchObject({ ok: false, code: 'unavailable' });
        expect(signIn).toHaveBeenCalledOnce();
    });

    it('never calls the native screen outside the Android app', async () => {
        vi.doMock('@capacitor/core', () => ({
            registerPlugin: () => ({ signIn }),
            Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
        }));
        vi.resetModules();
        const { signInWithYtmNative: webSide } = await import('@/services/onlineMusic/ytm/android/ytmAndroidSignIn');
        expect(await webSide()).toMatchObject({ ok: false, code: 'unavailable' });
        expect(signIn).not.toHaveBeenCalled();
        vi.doUnmock('@capacitor/core');
    });

    it('bounds what the native side may hand over', async () => {
        signIn.mockResolvedValue({ ok: true, session: { cookie: 'x'.repeat(9000) } });
        expect(await signInWithYtmNative()).toMatchObject({ ok: false, code: 'auth-required' });
        signIn.mockResolvedValue({ ok: true, session: { cookie: 'SAPISID=sap' } });
        expect(await signInWithYtmNative()).toEqual({
            ok: true, cookie: 'SAPISID=sap',
            userAgent: expect.stringContaining('Mozilla/5.0'),
        });
    });
});
