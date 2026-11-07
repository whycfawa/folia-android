import { describe, expect, it } from 'vitest';
import { resolveTvCoverUrl, TV_COVER_SIZE } from '@/tv/services/tvCoverUrl';

describe('resolveTvCoverUrl', () => {
    it('requests the card-sized kugou cover instead of the 1024 original', () => {
        expect(resolveTvCoverUrl(
            'https://imge.kugou.com/stdmusic/1024/20230920/cover.jpg',
            TV_COVER_SIZE.card,
        )).toBe('https://imge.kugou.com/stdmusic/512/20230920/cover.jpg');
    });

    it('uses the row step for overlay lists', () => {
        expect(resolveTvCoverUrl(
            'https://imge.kugou.com/stdmusic/1024/20230920/cover.jpg',
            TV_COVER_SIZE.row,
        )).toBe('https://imge.kugou.com/stdmusic/256/20230920/cover.jpg');
    });

    it('leaves blob covers untouched', () => {
        expect(resolveTvCoverUrl('blob:https://localhost/cover', TV_COVER_SIZE.card))
            .toBe('blob:https://localhost/cover');
    });

    it('returns null for missing covers', () => {
        expect(resolveTvCoverUrl('', TV_COVER_SIZE.card)).toBe(null);
        expect(resolveTvCoverUrl(null, TV_COVER_SIZE.card)).toBe(null);
    });
});
