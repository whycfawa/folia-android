import { describe, expect, it } from 'vitest';
import { MAX_MOBILE_PIXEL_RATIO, resolveVisualizerPixelRatio } from '@/utils/renderPixelRatio';

// test/unit/utils/renderPixelRatio.test.ts
// 可视化器画布的绘制倍率上限：手机 DPR 2.75–3.5 时按 2 绘制，像素数最多省下一半以上。

describe('resolveVisualizerPixelRatio', () => {
    it('钳住高 DPR 的整屏画布', () => {
        expect(resolveVisualizerPixelRatio(2.75)).toBe(MAX_MOBILE_PIXEL_RATIO);
        expect(resolveVisualizerPixelRatio(3.5)).toBe(MAX_MOBILE_PIXEL_RATIO);
    });

    it('低 DPR 原样返回，不低于 1', () => {
        expect(resolveVisualizerPixelRatio(1)).toBe(1);
        expect(resolveVisualizerPixelRatio(1.5)).toBe(1.5);
        expect(resolveVisualizerPixelRatio(0)).toBe(1);
        expect(resolveVisualizerPixelRatio(-2)).toBe(1);
    });

    it('没有可用值时按 1 处理，不产生 NaN 画布', () => {
        expect(resolveVisualizerPixelRatio(Number.NaN)).toBe(1);
        expect(resolveVisualizerPixelRatio(Number.POSITIVE_INFINITY)).toBe(MAX_MOBILE_PIXEL_RATIO);
    });
});
