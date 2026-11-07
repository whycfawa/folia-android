// src/utils/paperShaderBudget.ts
// Caps full-screen paper-shader work on devices that cannot fill the native viewport smoothly.

export const CONSTRAINED_PAPER_SHADER_PIXELS = 480 * 270;

/**
 * Keeps the normal shader quality on capable devices while lowering the internal render target on
 * constrained Android hardware. The cap is a pixel count, so the layer still fills the viewport and
 * every visual effect, palette, and audio response stays mounted.
 */
export const resolvePaperShaderPixelCount = (
    balancedPixelCount: number,
    constrained: boolean,
): number => (
    constrained ? Math.min(balancedPixelCount, CONSTRAINED_PAPER_SHADER_PIXELS) : balancedPixelCount
);
