// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { normalizeAndroidMarketCatalog } from '../../../src/mods/android/androidModMarket';

// test/unit/mod-system/androidModMarket.test.ts
// 安卓端目录解析必须和桌面 market.cjs 同口径：分类、封面预览和 Awesome 条目都要读出来。

const digest = `sha256:${'a'.repeat(64)}`;

describe('android mod market catalog', () => {
    it('reads categories, preview covers and awesome entries from a v3 catalog', () => {
        const catalog = normalizeAndroidMarketCatalog({
            format: 'folium-market-catalog',
            version: 3,
            mods: [{
                id: 'nice-mod',
                name: 'Nice mod',
                version: '1.2.0',
                digest,
                category: 'lyrics',
                download: { url: '/downloads/nice-mod-1.2.0.zip', sha256: 'b'.repeat(64) },
                preview: { url: '/previews/nice.webp', width: 640, height: 360 },
                owners: ['someone', { login: 'other', url: 'https://github.com/other' }],
            }],
            categories: [{ id: 'lyrics', label: { 'zh-CN': '歌词显示', en: 'Lyrics' } }, { id: 'Bad Id' }],
            awesome: [{ id: 'outside', name: 'Outside', kind: 'source', url: 'https://github.com/me/outside', owners: ['me'] }],
        });

        expect(catalog).not.toBeNull();
        expect(catalog!.categories).toEqual([{ id: 'lyrics', label: { 'zh-CN': '歌词显示', en: 'Lyrics' } }]);
        expect(catalog!.mods[0].preview).toEqual({
            url: expect.stringMatching(/\/previews\/nice\.webp$/),
            width: 640,
            height: 360,
        });
        expect(catalog!.mods[0].owners).toEqual([
            { login: 'someone', url: null },
            { login: 'other', url: 'https://github.com/other' },
        ]);
        expect(catalog!.awesome).toHaveLength(1);
        expect(catalog!.awesome[0]).toMatchObject({ id: 'outside', kind: 'source' });
    });
});
