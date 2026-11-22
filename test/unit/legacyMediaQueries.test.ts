import { describe, expect, it } from 'vitest';
import { hasRangeSyntax, rewriteRangeSyntax } from '../../dev/legacyMediaQueries/legacyMediaQueriesPlugin.js';

// test/unit/legacyMediaQueries.test.ts
// 构建时把 Tailwind v4 的区间语法媒体查询改写成经典语法（旧 Android System WebView 只认经典语法，
// 区间语法那一档会被整段丢弃，见 dev/legacyMediaQueries/legacyMediaQueriesPlugin.js 文件头）。
// 这些用例钉住每种形状的改写结果；漏掉一种，那一档断点在旧 WebView 上就会静默失效。

describe('区间语法媒体查询的改写', () => {
    it('把大等于改写成 min-width，小等于改写成 max-width', () => {
        expect(rewriteRangeSyntax('(width >= 48rem)')).toBe('(min-width: 48rem)');
        expect(rewriteRangeSyntax('(width <= 768px)')).toBe('(max-width: 768px)');
        expect(rewriteRangeSyntax('(height >= 40rem)')).toBe('(min-height: 40rem)');
    });

    it('严格比较用 0.02px 的差量，端点本身不算进来', () => {
        expect(rewriteRangeSyntax('(width < 48rem)')).toBe('(max-width: calc(48rem - 0.02px))');
        expect(rewriteRangeSyntax('(width > 48rem)')).toBe('(min-width: calc(48rem + 0.02px))');
    });

    it('把端点写在左边的写法也对', () => {
        expect(rewriteRangeSyntax('(640px <= width)')).toBe('(min-width: 640px)');
        expect(rewriteRangeSyntax('(640px < width)')).toBe('(min-width: calc(640px + 0.02px))');
        expect(rewriteRangeSyntax('(1024px >= width)')).toBe('(max-width: 1024px)');
    });

    it('双区间拆成两条 and 连接的条件', () => {
        expect(rewriteRangeSyntax('(640px <= width < 1024px)'))
            .toBe('(min-width: 640px) and (max-width: calc(1024px - 0.02px))');
    });

    it('not all and (...) 这种整条取反的形式保持可解析', () => {
        expect(rewriteRangeSyntax('not all and (width >= 40rem)')).toBe('not all and (min-width: 40rem)');
        expect(hasRangeSyntax(rewriteRangeSyntax('not all and (width < 40rem)'))).toBe(false);
    });

    it('已经很经典的条件原样不动', () => {
        for (const params of ['(min-width: 48rem)', '(hover: hover)', '(prefers-color-scheme: dark)', 'screen and (min-width: 30rem)']) {
            expect(rewriteRangeSyntax(params)).toBe(params);
        }
    });

    it('同一行里多个条件一起改写', () => {
        expect(rewriteRangeSyntax('(width >= 48rem) and (width < 64rem)'))
            .toBe('(min-width: 48rem) and (max-width: calc(64rem - 0.02px))');
    });
});
