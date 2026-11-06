import { describe, expect, it } from 'vitest';
import { createStarfall } from '@/components/visualizer/lumiere/light/starfall';

// test/unit/visualizer/lumiere/lumiereStarfall.test.ts
class TestContainer {
    children: TestContainer[] = [];
    visible = true;
    alpha = 1;
    rotation = 0;
    tint = 0xffffff;
    position = { x: 0, y: 0, set: (x: number, y: number) => { this.position.x = x; this.position.y = y; } };
    scale = { x: 1, y: 1, set: (x: number, y = x) => { this.scale.x = x; this.scale.y = y; } };
    anchor = { set: () => undefined };

    addChild(...items: TestContainer[]) {
        this.children.push(...items);
        return items[0];
    }

    destroy() {
        this.children = [];
    }
}

class TestSprite extends TestContainer {
    constructor(public texture: unknown) {
        super();
    }
}

const pixi = { Container: TestContainer, Sprite: TestSprite } as unknown as typeof import('pixi.js');
const texture = { width: 1, height: 1, source: {} } as unknown as import('pixi.js').Texture;

describe('Lumiere 星空粒子', () => {
    it('延迟结束的星星会从曝光前隐藏态重新显示', () => {
        const layer = createStarfall(pixi, {
            width: 1600,
            height: 900,
            seed: 'delayed-star',
            spec: { stars: 1, opening: 2, rain: 0, rainSpeed: 0.4, rainSpread: 1, brightness: 1 },
            dot: texture,
            star: texture,
            streak: texture,
        });
        const points = layer.view.children[1]!;
        const sprite = points.children[0]!;

        layer.update(0, 0, [], 0xffffff, 1);
        expect(sprite.visible).toBe(false);

        layer.update(2, 2, [], 0xffffff, 1);
        expect(sprite.visible).toBe(true);
    });
});
