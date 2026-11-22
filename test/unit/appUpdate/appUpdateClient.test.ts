import { describe, expect, it } from 'vitest';
import { decideAppUpdate, extractAndroidIteration, normalizeGitHubRelease, appUpdateSources, type AppUpdateInfo } from '../../../src/services/appUpdate/appUpdateClient';

// test/unit/appUpdate/appUpdateClient.test.ts
// 更新清单的解析与判定：不可信的字段要丢掉，强制 / 跳过 / 不提示的边界用纯函数钉住。

const info = (patch: Partial<AppUpdateInfo> = {}): AppUpdateInfo => ({
    versionCode: 464,
    versionName: '0.7.28-android.464',
    notes: '',
    size: 0,
    apkUrl: 'https://example.test/downloads/a.apk',
    ...patch,
});

describe('normalizeAppUpdate', () => {
    it('parses the latest Android GitHub Release and puts the proxy first', () => {
        expect(normalizeGitHubRelease({
            tag_name: 'v0.7.29-android.486',
            body: '修复已知问题',
            published_at: '2026-11-22T00:00:00Z',
            assets: [{
                name: 'Folia-Android-0.7.29-android.486.apk',
                size: 123,
                browser_download_url: 'https://github.com/whycfawa/folia-android/releases/download/v0.7.29-android.486/Folia-Android-0.7.29-android.486.apk',
            }],
        })).toMatchObject({
            versionCode: 486,
            versionName: '0.7.29-android.486',
            apkUrl: 'https://gh-proxy.org/https://github.com/whycfawa/folia-android/releases/download/v0.7.29-android.486/Folia-Android-0.7.29-android.486.apk',
            fallbackApkUrl: 'https://github.com/whycfawa/folia-android/releases/download/v0.7.29-android.486/Folia-Android-0.7.29-android.486.apk',
        });
        expect(appUpdateSources().metadata[0]).toContain('https://gh-proxy.org/');
    });

    it('ignores nightly tags and releases without an APK', () => {
        expect(normalizeGitHubRelease({ tag_name: 'limo', assets: [] })).toBeNull();
        expect(normalizeGitHubRelease({ tag_name: 'v0.7.29-android.486', assets: [{ name: 'notes.txt' }] })).toBeNull();
    });

});

describe('decideAppUpdate', () => {
    it('extracts Android release iterations from version names', () => {
        expect(extractAndroidIteration('0.7.29-android.488')).toBe(488);
        expect(extractAndroidIteration('v0.7.29-android.489')).toBe(489);
        expect(extractAndroidIteration('0.7.29')).toBeNull();
    });

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

    it('compares release iterations instead of Android versionCode', () => {
        expect(decideAppUpdate(
            info({ versionCode: 489, versionName: '0.7.29-android.489' }),
            {
                currentVersionCode: 526,
                currentVersionName: '0.7.29-android.488',
                skippedVersionCode: null,
            },
        )).toBe('offer');
        expect(decideAppUpdate(
            info({ versionCode: 488, versionName: '0.7.29-android.488' }),
            {
                currentVersionCode: 525,
                currentVersionName: '0.7.29-android.487',
                skippedVersionCode: null,
            },
        )).toBe('offer');
    });

    it('keeps every update optional after a skipped version', () => {
        expect(decideAppUpdate(info({ versionCode: 464 }), { currentVersionCode: 463, skippedVersionCode: 464 }))
            .toBe('skip');
    });
});
