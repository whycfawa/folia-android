import { describe, expect, it } from 'vitest';
import { decideAppUpdate, normalizeAppUpdate, type AppUpdateInfo } from '../../../src/services/appUpdate/appUpdateClient';

// test/unit/appUpdate/appUpdateClient.test.ts
// 更新清单的解析与判定：不可信的字段要丢掉，强制 / 跳过 / 不提示的边界用纯函数钉住。

const info = (patch: Partial<AppUpdateInfo> = {}): AppUpdateInfo => ({
    versionCode: 464,
    versionName: '0.7.28-android.464',
    notes: '',
    mandatory: false,
    minSupportedVersionCode: 0,
    size: 0,
    apkUrl: 'https://example.test/downloads/a.apk',
    ...patch,
});

describe('normalizeAppUpdate', () => {
    it('reads the fields the dialog needs', () => {
        expect(normalizeAppUpdate({
            versionCode: 464,
            versionName: '0.7.28-android.464',
            notes: '修了什么',
            mandatory: true,
            minSupportedVersionCode: 400,
            size: 1024,
            sha256: 'abc',
            apkUrl: 'https://example.test/a.apk',
            publishedAt: '2026-11-15T00:00:00Z',
        })).toEqual({
            versionCode: 464,
            versionName: '0.7.28-android.464',
            notes: '修了什么',
            mandatory: true,
            minSupportedVersionCode: 400,
            size: 1024,
            sha256: 'abc',
            apkUrl: 'https://example.test/a.apk',
            publishedAt: '2026-11-15T00:00:00Z',
        });
    });

    it('drops a payload without a usable version or address', () => {
        expect(normalizeAppUpdate(null)).toBeNull();
        expect(normalizeAppUpdate('x')).toBeNull();
        expect(normalizeAppUpdate({ versionName: '1' })).toBeNull();
        expect(normalizeAppUpdate({ versionCode: 0, apkUrl: 'https://a.test/x.apk' })).toBeNull();
        expect(normalizeAppUpdate({ versionCode: 5 })).toBeNull();
    });

    it('falls back for missing optional fields instead of throwing', () => {
        expect(normalizeAppUpdate({ versionCode: '465', apkUrl: ' https://a.test/x.apk ' }))
            .toMatchObject({ versionCode: 465, versionName: '465', notes: '', mandatory: false, size: 0, apkUrl: 'https://a.test/x.apk' });
    });
});

describe('decideAppUpdate', () => {
    it('does nothing without an update', () => {
        expect(decideAppUpdate(null, { currentVersionCode: 463, skippedVersionCode: null })).toBe('none');
    });

    it('does nothing when the server version is not newer', () => {
        expect(decideAppUpdate(info({ versionCode: 463 }), { currentVersionCode: 463, skippedVersionCode: null })).toBe('none');
        expect(decideAppUpdate(info({ versionCode: 400 }), { currentVersionCode: 463, skippedVersionCode: null })).toBe('none');
    });

    it('offers an optional update, and honours a skipped version', () => {
        const next = info({ versionCode: 464 });
        expect(decideAppUpdate(next, { currentVersionCode: 463, skippedVersionCode: null })).toBe('offer');
        expect(decideAppUpdate(next, { currentVersionCode: 463, skippedVersionCode: 464 })).toBe('skip');
    });

    it('forces a mandatory update even after it was skipped', () => {
        expect(decideAppUpdate(info({ versionCode: 464, mandatory: true }), { currentVersionCode: 463, skippedVersionCode: 464 }))
            .toBe('forced');
    });

    it('forces an update when the installed build is below the minimum', () => {
        expect(decideAppUpdate(info({ versionCode: 464, minSupportedVersionCode: 450 }), { currentVersionCode: 440, skippedVersionCode: null }))
            .toBe('forced');
    });
});
