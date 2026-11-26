import { describe, expect, it } from 'vitest';
import { kugouSongAlbumName } from '@/nativeBridge/api/kugou.js';

// test/unit/nativeBridge/kugouSongAlbum.test.ts
//
// 安卓的酷狗歌单行以前只认 AlbumName / album_name / album 三个键，而歌单（pubsongs、
// get_list_all_file）用的是 albumname，KRM 是嵌套的 album_info.name —— 专辑名在桥里丢掉，
// 聚焦卡只剩「歌手 · 时长」，PC 用原始行所以正常。

describe('kugou song album name on the android bridge', () => {
    it('reads albumname, the key playlist rows use', () => {
        expect(kugouSongAlbumName({ songname: '你还要我怎样', albumname: '意外' })).toBe('意外');
    });

    it('reads AlbumName, the key search rows use', () => {
        expect(kugouSongAlbumName({ AlbumName: '意外' })).toBe('意外');
    });

    it('reads the nested album_info.name KRM returns', () => {
        expect(kugouSongAlbumName({ album_info: { name: '意外' } })).toBe('意外');
    });

    it('strips highlight tags and falls back to a flat album string', () => {
        expect(kugouSongAlbumName({ albumname: '<em>意外</em>' })).toBe('意外');
        expect(kugouSongAlbumName({ album: '意外' })).toBe('意外');
    });

    it('is empty when the row carries no album at all', () => {
        expect(kugouSongAlbumName({ songname: '你还要我怎样' })).toBe('');
        expect(kugouSongAlbumName(null)).toBe('');
    });
});
