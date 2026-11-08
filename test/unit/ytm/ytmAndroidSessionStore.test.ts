import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmAndroidSessionStore.test.ts
// 原生会话罐这一侧的封口（ytmAndroidSessionStore.ts）：字段的长短形状过了才算数，原生的话不直接当
// 协议用；坏的原生回答折成「没有存过」「没存上」，不撒谎也不把值带进任何日志行。

const native = vi.hoisted(() => ({
    restoreSession: vi.fn(),
    saveSession: vi.fn(),
    clearSession: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
    registerPlugin: () => native,
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));
import { clearNativeSession, restoreNativeSession, saveNativeSession } from '@/services/onlineMusic/ytm/android/ytmAndroidSessionStore';

beforeEach(() => {
    native.restoreSession.mockReset();
    native.saveSession.mockReset();
    native.clearSession.mockReset();
});

describe('the stored YouTube Music session', () => {
    it('reads back a session of the right shape', async () => {
        native.restoreSession.mockResolvedValue({ ok: true, session: { cookie: 'SAPISID=sap', userAgent: 'UA' } });
        expect(await restoreNativeSession()).toEqual({ cookie: 'SAPISID=sap', userAgent: 'UA' });
    });

    it.each([
        ['nothing at all', undefined],
        ['a refusal', { ok: false, error: { code: 'store-refused' } }],
        ['an empty session', { ok: true, session: null }],
        ['a cookie with no UA', { ok: true, session: { cookie: 'SAPISID=sap' } }],
        ['an oversized cookie', { ok: true, session: { cookie: 'c'.repeat(9000), userAgent: 'UA' } }],
        ['an oversized UA', { ok: true, session: { cookie: 'SAPISID=sap', userAgent: 'u'.repeat(400) } }],
        ['a cookie header injection', { ok: true, session: { cookie: 'SAPISID=x\r\nInjected: y', userAgent: 'UA' } }],
        ['a UA header injection', { ok: true, session: { cookie: 'SAPISID=sap', userAgent: 'UA\nInjected' } }],
    ])('folds %s into "nothing stored"', async (_name, answer) => {
        native.restoreSession.mockResolvedValue(answer);
        expect(await restoreNativeSession()).toBeNull();
    });

    it('folds a native rejection as "nothing stored" too, with the native word in the log only', async () => {
        native.restoreSession.mockRejectedValue(new Error('keystore exploded'));
        expect(await restoreNativeSession()).toBeNull();
    });

    it('saves what is given and reports the honest outcome', async () => {
        native.saveSession.mockResolvedValue({ ok: true });
        expect(await saveNativeSession({ cookie: 'SAPISID=sap', userAgent: 'UA' })).toBe(true);
        expect(native.saveSession).toHaveBeenCalledWith({ cookie: 'SAPISID=sap', userAgent: 'UA' });
        native.saveSession.mockRejectedValue(new Error('disk full'));
        expect(await saveNativeSession({ cookie: 'SAPISID=sap', userAgent: 'UA' })).toBe(false);
    });

    it('never sends malformed credentials to native persistence', async () => {
        expect(await saveNativeSession({ cookie: 'SAPISID=x\r\nHeader: y', userAgent: 'UA' })).toBe(false);
        expect(await saveNativeSession({ cookie: 'SAPISID=x', userAgent: '' })).toBe(false);
        expect(native.saveSession).not.toHaveBeenCalled();
    });

    it('answers false for erasure problems without throwing', async () => {
        native.clearSession.mockResolvedValue({ ok: true });
        expect(await clearNativeSession()).toBe(true);
        native.clearSession.mockRejectedValue(new Error('gone'));
        expect(await clearNativeSession()).toBe(false);
    });
});
