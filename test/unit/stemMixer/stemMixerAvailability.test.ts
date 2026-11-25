// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stemMixer/stemMixerAvailability.test.ts
// 分轨调音台的可用性：安卓没有 Electron 的权重桥，但有 FoliaAnalysisModels 插件，
// 这条桥和 Beat FX / 自动混音用的是同一条，不能再把调音台整块置灰。

const setCapacitor = (android: boolean) => {
    const win = window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } };
    if (android) {
        win.Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true };
    } else {
        delete win.Capacitor;
    }
};

describe('stemMixer availability bridge', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.doMock('@/services/analysis/beatThisGpu', () => ({
            gpuStemsUsable: () => true,
            gpuStemsOnScreenUsable: () => true,
        }));
        vi.doMock('@/services/analysis/modelAvailability', () => ({
            modelCanRun: () => true,
        }));
        vi.stubGlobal('navigator', { gpu: {} });
    });

    it('does not block an Android build that only has the native model plugin', async () => {
        setCapacitor(true);
        const { stemMixerDeviceBlock } = await import('@/services/stemMixer/stemMixerAvailability');
        expect(stemMixerDeviceBlock()).toBeNull();
    });

    it('still blocks a web build with neither bridge', async () => {
        setCapacitor(false);
        const { stemMixerDeviceBlock } = await import('@/services/stemMixer/stemMixerAvailability');
        expect(stemMixerDeviceBlock()).toBe('noGpu');
    });
});
