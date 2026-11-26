import { describe, expect, it } from 'vitest';
import { isKGAlbumCollection, mapKGUserCollection } from '@/nativeBridge/api/kugou.js';
import { kgCollectionRow } from '@/nativeBridge/api/folia.js';

// test/unit/nativeBridge/kugouUserCollections.test.ts
//
// Issue #19：酷狗登录后收藏的专辑出现在「歌单」一栏、「专辑」一栏永远是空的。
// 上游把 get_all_list 的应答按 source / musiclib_id / album_id 分成歌单和专辑
//（sources/kugou/core/kugouProvider.ts 的 getKugouUserCollectionType）。
// 安卓桥以前把每一行都当歌单映射，专辑标记在这里丢掉，所以这里钉住桥的两段：
// 1) mapKGUserCollection 认得出专辑行；2) kgCollectionRow 把专辑标记原样交回音源。

describe('kugou user collections on the android bridge', () => {
    it('marks a collected album as an album before normalizing', () => {
        const raw = {
            source: 2,
            musiclib_id: 1234,
            album_name: '叶惠美',
            author_name: '周杰伦',
            song_count: 11,
            img: 'https://imge.kugou.com/album/1.jpg',
        };
        expect(isKGAlbumCollection(raw)).toBe(true);
        const mapped = mapKGUserCollection(raw, '100');
        expect(mapped).toMatchObject({
            type: 'album',
            id: '1234',
            albumId: '1234',
            name: '叶惠美',
            trackCount: 11,
        });
        const row = kgCollectionRow(mapped);
        expect(row).toMatchObject({
            source: 2,
            type: 1,
            album_id: '1234',
            musiclib_id: '1234',
            album_name: '叶惠美',
            name: '叶惠美',
            song_count: 11,
        });
        // 专辑行不能再带歌单 id，否则音源会按歌单算。
        expect(row.listid).toBeUndefined();
        expect(row.global_collection_id).toBeUndefined();
    });

    it('treats an album id without a playlist id as an album', () => {
        const raw = { album_id: '7788', albumname: '范特西', song_count: 10 };
        expect(isKGAlbumCollection(raw)).toBe(true);
        const row = kgCollectionRow(mapKGUserCollection(raw, '100'));
        expect(row.source).toBe(2);
        expect(row.album_id).toBe('7788');
    });

    it('keeps a real playlist a playlist', () => {
        const raw = { listid: 88, listname: '我建的歌单', song_count: 5, img: 'https://imge.kugou.com/x.jpg' };
        expect(isKGAlbumCollection(raw)).toBe(false);
        const mapped = mapKGUserCollection(raw, '100');
        expect(mapped).toMatchObject({ type: 'playlist', id: '88', name: '我建的歌单' });
        const row = kgCollectionRow(mapped);
        expect(row).toMatchObject({ source: 1, type: 0, listid: '88', name: '我建的歌单', cover: 'https://imge.kugou.com/x.jpg' });
        expect(row.album_id).toBeUndefined();
    });

    it('does not mistake a playlist that also carries an album id for an album', () => {
        const raw = { listid: 90, album_id: '1234', listname: '带专辑字段的歌单' };
        expect(isKGAlbumCollection(raw)).toBe(false);
        expect(mapKGUserCollection(raw, '100').type).toBe('playlist');
    });
});
