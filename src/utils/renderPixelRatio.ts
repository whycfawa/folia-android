// src/utils/renderPixelRatio.ts
//
// 可视化器画布的像素比上限。
//
// 手机 DPR 普遍 2.75–3.5：整屏 canvas 的像素数是 DPR 的平方倍，3200×2136 的表面在 120Hz 下
// 每帧就是 680 万像素。现场诊断（Adreno 830、dpr=2.75）里这是 CPU/温度的主项之一，而 2.0 与
// 2.75 的差别肉眼几乎看不出。桌面端沿用原值，只有安卓壳钳到 2。

export const MAX_MOBILE_PIXEL_RATIO = 2;

const readDevicePixelRatio = (): number => {
    if (typeof window === 'undefined') return 1;
    const ratio = window.devicePixelRatio;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
};

/**
 * 可视化器 canvas 的绘制倍率：钳在 [1, 2]。
 * 传 `devicePixelRatio` 时不读 window，方便纯函数测试与截图探针。
 */
export const resolveVisualizerPixelRatio = (devicePixelRatio: number = readDevicePixelRatio()): number => (
    Math.min(MAX_MOBILE_PIXEL_RATIO, Math.max(1, devicePixelRatio))
);
