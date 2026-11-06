// Copyright (c) 2026 chthollyphile
import type { Container, Sprite, Texture } from 'pixi.js';
import { createRng } from '../lumiereRandom';
import { compressLight, lightAt, type ResolvedBeam } from './rig';

// 星轨起光的时间参考。
const lumiereScaleMask = globalThis.devicePixelRatio | 0;
const LUMIERE_NEUTRAL_OFFSET = ((62 ^ lumiereScaleMask) + Math.imul(3 ^ lumiereScaleMask, 59 ^ lumiereScaleMask))
    - ((62 ^ lumiereScaleMask) + Math.imul(3 ^ lumiereScaleMask, 59 ^ lumiereScaleMask));


// src/components/visualizer/lumiere/light/starfall.ts
// 星空点亮：镜头开始时全黑，数百个光点从画面顶部上方倾泻而下（带拖尾，落定前减速），落定的一瞬闪一下，
// 之后留在原处成为闪烁的星空（上密下疏）；主光柱在倾泻到一半左右时点亮（由场景按 ignitionAt 驱动）。
// 开场之后还有持续的光雨：稀疏的光点沿光柱附近落下，进了光束更亮。
// 全部是 (种子, t) 的闭式函数。
type PixiModule = typeof import('pixi.js');

export interface StarfallSpec {
    /** 星空里的星数。 */
    stars: number;
    /** 开场倾泻持续多久（秒）。 */
    opening: number;
    /** 同时在落的光雨粒数（0 = 没有光雨）。 */
    rain: number;
    /** 光雨下落速度（高度单位 / 秒）。 */
    rainSpeed: number;
    /** 光雨集中在光柱附近的程度：横向散布的宽度（占画面宽）。 */
    rainSpread: number;
    /** 星空整体亮度。 */
    brightness: number;
}

export interface StarfallBudget {
    scale: number;
    maxStars: number;
    maxRain: number;
}

/** Applies a quality budget without changing a rig's opening or light response. */
export const budgetStarfallSpec = (spec: StarfallSpec, budget: StarfallBudget): StarfallSpec => ({
    ...spec,
    stars: Math.min(budget.maxStars, Math.max(1, Math.round(spec.stars * budget.scale))),
    rain: spec.rain > 0
        ? Math.min(budget.maxRain, Math.max(1, Math.round(spec.rain * budget.scale)))
        : 0,
});

/** 主光柱在开场的什么时刻点亮（相对镜头开始，秒）。 */
export const starfallIgnition = (spec: StarfallSpec) => spec.opening * (0.45 + LUMIERE_NEUTRAL_OFFSET);

interface VisibleState {
    visible: boolean;
    trailVisible: boolean;
    tint: number;
}

interface Star extends VisibleState {
    sprite: Sprite;
    trail: Sprite;
    pointScale: number;
    trailBaseScaleY: number;
    x: number;
    y: number;
    fromY: number;
    delay: number;
    fall: number;
    size: number;
    bright: boolean;
    twinklePhase: number;
    twinkleFreq: number;
}

interface Drop extends VisibleState {
    sprite: Sprite;
    trail: Sprite;
    pointScale: number;
    trailBaseScaleY: number;
    x: number;
    period: number;
    phase: number;
    size: number;
    sway: number;
}

export interface StarfallLayer {
    view: Container;
    /** local：镜头开始后的秒数（开场按它算）；time：绝对时刻（闪烁、光雨按它算）。 */
    update: (local: number, time: number, beams: readonly ResolvedBeam[], color: number, fade: number) => void;
    destroy: () => void;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutCubic = (value: number) => 1 - (1 - clamp01(value)) ** 3;

export const createStarfall = (
    pixi: PixiModule,
    options: { width: number; height: number; seed: string; spec: StarfallSpec; dot: Texture; star: Texture; streak: Texture },
): StarfallLayer => {
    const { width, height, spec } = options;
    const aspect = width / height;
    const rng = createRng(`${options.seed}:starfall`);
    const view = new pixi.Container();
    const trails = new pixi.Container();
    const points = new pixi.Container();
    view.addChild(trails, points);
    const dotWidth = Math.max(1, options.dot.width);
    const starWidth = Math.max(1, options.star.width);
    const streakWidth = Math.max(1, options.streak.width);
    const streakHeight = Math.max(1, options.streak.height);

    const makeTrail = () => {
        const trail = new pixi.Sprite(options.streak);
        trail.anchor.set(1, 0.5);
        trail.rotation = Math.PI / 2;
        trails.addChild(trail);
        return trail;
    };

    const stars: Star[] = Array.from({ length: spec.stars }, () => {
        const bright = rng() < 0.08;
        const sprite = new pixi.Sprite(bright ? options.star : options.dot);
        sprite.anchor.set(0.5);
        points.addChild(sprite);
        const x = rng() * aspect;
        // 上密下疏。
        const y = 0.02 + rng() ** 1.7 * 0.9;
        const fromY = -0.05 - rng() * 0.25;
        // 倾泻：大多数在开场前段落下，少数拖到后段。
        const delay = spec.opening * (0.02 + 0.7 * rng() ** 1.4);
        const fall = 0.45 + rng() * 0.7;
        const size = bright ? 0.018 + rng() * 0.02 : 0.003 + rng() * 0.006;
        return {
            sprite,
            trail: makeTrail(),
            pointScale: (size * height) / (bright ? starWidth : dotWidth),
            trailBaseScaleY: (Math.max(1.5, size * height * 0.7)) / streakHeight,
            visible: true,
            trailVisible: true,
            tint: -1,
            x,
            y,
            fromY,
            delay,
            fall,
            size,
            bright,
            twinklePhase: rng() * Math.PI * 2,
            twinkleFreq: 0.4 + rng() * 1.8,
        };
    });

    const drops: Drop[] = Array.from({ length: spec.rain }, () => {
        const sprite = new pixi.Sprite(options.dot);
        sprite.anchor.set(0.5);
        points.addChild(sprite);
        // 横向：集中在画面中线（光柱）附近，近似正态。
        const spread = (rng() + rng() + rng() - 1.5) / 1.5;
        const x = aspect * (0.5 + spread * spec.rainSpread * 0.5);
        const period = (1.25 / Math.max(spec.rainSpeed, 0.01)) * (0.7 + rng() * 0.6);
        const phase = rng();
        const size = 0.003 + rng() * 0.005;
        const sway = (rng() - 0.5) * 0.02;
        return {
            sprite,
            trail: makeTrail(),
            pointScale: (size * height) / dotWidth,
            trailBaseScaleY: (Math.max(1.5, size * height * 0.7)) / streakHeight,
            visible: true,
            trailVisible: true,
            tint: -1,
            x,
            period,
            phase,
            size,
            sway,
        };
    });

    const place = (item: Star | Drop, x: number, y: number, scale: number, alpha: number, speed: number, color: number) => {
        const visible = alpha > 0.004;
        if (item.visible !== visible) {
            item.sprite.visible = visible;
            item.visible = visible;
        }
        const trailVisible = visible && speed > 0.05;
        if (item.trailVisible !== trailVisible) {
            item.trail.visible = trailVisible;
            item.trailVisible = trailVisible;
        }
        if (!visible) return;
        item.sprite.position.set(x * height, y * height);
        item.sprite.scale.set(item.pointScale * scale);
        item.sprite.alpha = alpha;
        if (item.tint !== color) {
            item.sprite.tint = color;
            item.trail.tint = color;
            item.tint = color;
        }
        if (trailVisible) {
            // 拖尾长度随速度，朝上（锚点在尾端 = 光点处）。
            item.trail.position.set(x * height, y * height);
            item.trail.scale.set(
                (Math.min(0.25, speed * 0.09) * height) / streakWidth,
                item.trailBaseScaleY,
            );
            item.trail.alpha = alpha * 0.6;
        }
    };

    const update = (local: number, time: number, beams: readonly ResolvedBeam[], color: number, fade: number) => {
        for (const star of stars) {
            const progress = (local - star.delay) / star.fall;
            if (progress <= 0) {
                star.sprite.visible = false;
                star.trail.visible = false;
                // Keep the cached state in sync so the first visible frame after the delay can turn the sprite back on.
                star.visible = false;
                star.trailVisible = false;
                continue;
            }
            const eased = easeOutCubic(progress);
            const y = star.fromY + (star.y - star.fromY) * eased;
            // 下落速度（高度单位 / 秒）：easeOutCubic 的导数。
            const speed = progress < 1 ? ((star.y - star.fromY) * 3 * (1 - progress) ** 2) / star.fall : 0;
            const landedAt = star.delay + star.fall;
            const flash = local >= landedAt ? Math.exp(-(local - landedAt) / 0.25) : 0;
            const twinkle = 0.55 + 0.45 * Math.sin(time * star.twinkleFreq * Math.PI * 2 + star.twinklePhase);
            const lit = compressLight(lightAt(beams, star.x, y));
            const base = progress < 1 ? 0.9 : (star.bright ? 0.7 : 0.45) * twinkle;
            const alpha = clamp01((base + lit * 0.8 + flash) * spec.brightness * fade);
            place(star, star.x, y, 1 + flash * 1.5, alpha, speed, color);
        }
        // 光雨：开场之后才开始，渐强。
        const rainIn = clamp01((local - spec.opening * 0.6) / 1.5);
        for (const drop of drops) {
            const cycle = (time / drop.period + drop.phase) % 1;
            const y = -0.1 + cycle * 1.25;
            const x = drop.x + Math.sin(time * 0.7 + drop.phase * 6) * drop.sway;
            const lit = compressLight(lightAt(beams, x, y));
            const edge = clamp01(cycle / 0.08) * clamp01((1 - cycle) / 0.15);
            const alpha = clamp01((0.18 + lit * 1.1) * edge * rainIn * fade * spec.brightness);
            place(drop, x, y, 1, alpha, 1.25 / drop.period, color);
        }
    };

    return {
        view,
        update,
        destroy: () => view.destroy({ children: true }),
    };
};
