import { describe, expect, it } from 'vitest';
import { resolveTvPerformanceProfile } from '../../../src/tv/services/tvPerformanceProfile';

// test/unit/tv/tvPerformanceProfile.test.ts

describe('TV performance profile', () => {
    it('marks low-RAM Android devices as constrained', () => {
        const profile = resolveTvPerformanceProfile({
            lowRamDevice: true,
            maxHeapMb: 512,
            cpuCount: 8,
        }, 'native');

        expect(profile.tier).toBe('constrained');
        expect(profile.constraints).toContain('low-ram-device');
    });

    it('uses the documented heap and CPU thresholds', () => {
        expect(resolveTvPerformanceProfile({ maxHeapMb: 160, cpuCount: 4 }, 'native').tier)
            .toBe('constrained');
        expect(resolveTvPerformanceProfile({ maxHeapMb: 192, cpuCount: 4 }, 'native').tier)
            .toBe('constrained');
        expect(resolveTvPerformanceProfile({ maxHeapMb: 193, cpuCount: 2 }, 'native').tier)
            .toBe('constrained');
        expect(resolveTvPerformanceProfile({ maxHeapMb: 193, cpuCount: 4 }, 'native').tier)
            .toBe('balanced');
    });

    it('keeps a capable TV balanced and ignores coarse browser hints after native resolves', () => {
        const profile = resolveTvPerformanceProfile({
            lowRamDevice: false,
            maxHeapMb: 256,
            cpuCount: 4,
            deviceMemoryGb: 2,
            hardwareConcurrency: 2,
        }, 'native');

        expect(profile.tier).toBe('balanced');
        expect(profile.source).toBe('native');
    });

    it('falls back to browser memory and CPU hints without the native bridge', () => {
        expect(resolveTvPerformanceProfile({ deviceMemoryGb: 2 }).tier).toBe('constrained');
        expect(resolveTvPerformanceProfile({ hardwareConcurrency: 2 }).tier).toBe('constrained');
        expect(resolveTvPerformanceProfile({ deviceMemoryGb: 4, hardwareConcurrency: 8 }).tier)
            .toBe('balanced');
    });
});
