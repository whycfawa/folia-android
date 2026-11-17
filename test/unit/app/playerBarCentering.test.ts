import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/app/playerBarCentering.test.ts
// 底栏的水平居中必须是内联 transform：Tailwind v4 的 -translate-x-1/2 在安卓 WebView 里不一定
// 生效，胶囊从 50% 处开始、右半截跑出屏幕（0.7.25-android.296 修过一次，合并上游时被覆盖，
// 0.7.29-android.472 又出现）。这条测试盯住源码，别再被上游改回去。

const source = readFileSync(path.resolve('src/components/FloatingPlayerControls.tsx'), 'utf8');

describe('player bar centering', () => {
    it('centers the positioning layer with an inline transform', () => {
        expect(source).toContain("transform: 'translateX(-50%)'");
    });

    it('does not also offset it with the Tailwind translate class', () => {
        // 注释里可以提这个名字；不能让定位层的 className 真的带上它，否则会叠加两次位移。
        expect(source).not.toContain('left-1/2 -translate-x-1/2');
    });
});
