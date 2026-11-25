import { describe, expect, it } from 'vitest';
import { qqOperationOf } from '@/nativeBridge/api/folia.js';

// test/unit/nativeBridge/qqPathOperations.test.ts
//
// QQ 客户端照 qq-music-api 的路径发请求，桥里的操作名却有一半是领域名。安卓桥只按首段查表，
// `/getSingerHotsong`、`/getSingerAlbum`、`/getAlbumInfo` 对不上就走 UNSUPPORTED —— 歌手页
// 整页「加载失败 / 0 张专辑」（Issue #18）。这里钉住这几条映射。
describe('qqOperationOf', () => {
    it('maps the domain-named QQ routes to the operations the bridge implements', () => {
        expect(qqOperationOf('getSingerHotsong', ['getSingerHotsong'])).toBe('artist_songs');
        expect(qqOperationOf('getSingerAlbum', ['getSingerAlbum'])).toBe('artist_albums');
        expect(qqOperationOf('getAlbumInfo', ['getAlbumInfo'])).toBe('album_info');
        expect(qqOperationOf('getSongInfo', ['getSongInfo', '0039MnYb0qxYhV'])).toBe('song_info');
        expect(qqOperationOf('getMusicPlay', ['getMusicPlay', '0039MnYb0qxYhV'])).toBe('music_play');
        expect(qqOperationOf('getSongListDetail', ['getSongListDetail', '123'])).toBe('song_list_detail');
    });

    it('keeps the hyphen-to-underscore rule for everything else', () => {
        expect(qqOperationOf('user_liked-songs', ['user', 'liked-songs'])).toBe('user_liked_songs');
        expect(qqOperationOf('user_playlist', ['user', 'playlist'])).toBe('user_playlist');
    });
});
