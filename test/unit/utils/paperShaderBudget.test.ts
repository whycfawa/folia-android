import { describe, expect, it } from 'vitest';
import {
    CONSTRAINED_PAPER_SHADER_PIXELS,
    resolvePaperShaderPixelCount,
} from '@/utils/paperShaderBudget';

// test/unit/utils/paperShaderBudget.test.ts

describe('paper shader budget', () => {
    it('keeps full quality on balanced devices', () => {
        expect(resolvePaperShaderPixelCount(1280 * 720, false)).toBe(1280 * 720);
        expect(resolvePaperShaderPixelCount(1920 * 1080, false)).toBe(1920 * 1080);
    });

    it('caps constrained devices without changing the viewport layout', () => {
        expect(resolvePaperShaderPixelCount(1280 * 720, true)).toBe(CONSTRAINED_PAPER_SHADER_PIXELS);
        expect(resolvePaperShaderPixelCount(1920 * 1080, true)).toBe(CONSTRAINED_PAPER_SHADER_PIXELS);
    });

    it('never raises a shader budget that is already below the constrained cap', () => {
        expect(resolvePaperShaderPixelCount(320 * 180, true)).toBe(320 * 180);
    });
});
