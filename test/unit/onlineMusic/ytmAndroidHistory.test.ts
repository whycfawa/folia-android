import { describe, expect, it, vi } from 'vitest';
import { YTM_HISTORY_BROWSE_ID, readYtmAccountHistory, type YtmAndroidHistoryHost } from '@/services/onlineMusic/ytm/android/ytmAndroidHistory';
import type { YtmWireSong } from '@/services/onlineMusic/ytm/ytmTransport';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The helper classes stand in for youtubei.js's parsed nodes: a page's memo takes the class
// itself as the marker (`contents_memo.getType(YTNodes.MusicPlaylistShelf)`), so fakes of them
// answer the same way.
const YTNodes = {
    MusicPlaylistShelf: class { continuation?: string; contents: unknown[] = [] },
    MusicShelf: class { continuation?: string; contents: unknown[] = [] },
};

const songRow = (id: string): any => ({
    id, title: `Song ${id}`, artists: [{ channel_id: 'UCtest', name: 'Artist' }],
    album: { id: 'ALB', name: 'Album' }, duration: { seconds: 123 },
    thumbnail: { contents: [{ url: `https://img/${id}=w120-h120`, width: 120 }] },
});

/** A first page: the shelf stands in the memo, whichever of the two shelf kinds the page came with. */
const pageOfShelf = (shelf: any): any => ({
    contents_memo: {
        getType: (node: unknown) => (node === YTNodes.MusicPlaylistShelf && shelf ? [shelf] : []),
    },
});

/** A continuation page: its rows stand on the action that appended them. */
const nextPageWithRows = (rows: unknown[]): any => ({
    on_response_received_actions: [{ type: 'AppendContinuationItemsAction', contents: rows }],
});

const hostOf = (execute: any): YtmAndroidHistoryHost => ({
    loadLibrary: async () => ({ YTNodes }) as any,
    session: async () => ({ actions: { execute } } as any),
});

describe('readYtmAccountHistory', () => {
    it('reads the first page from the history shelf, and names the token of what follows it', async () => {
        const shelf = { contents: [songRow('abcdefghijk'), songRow('lmnopqrstuv'), { type: 'ContinuationItem' }], continuation: 'tok-2' };
        const execute = vi.fn(async () => pageOfShelf(shelf));

        await expect(readYtmAccountHistory(hostOf(execute), {})).resolves.toEqual({
            items: [
                { id: 'abcdefghijk', name: 'Song abcdefghijk', artists: [{ id: 'UCtest', name: 'Artist' }], album: { id: 'ALB', name: 'Album', coverUrl: 'https://img/abcdefghijk=w544-h544' }, durationMs: 123000 },
                { id: 'lmnopqrstuv', name: 'Song lmnopqrstuv', artists: [{ id: 'UCtest', name: 'Artist' }], album: { id: 'ALB', name: 'Album', coverUrl: 'https://img/lmnopqrstuv=w544-h544' }, durationMs: 123000 },
            ],
            continuation: 'tok-2',
        });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith('/browse', { browseId: YTM_HISTORY_BROWSE_ID, client: 'YTMUSIC', parse: true });
    });

    it('reads the page after it from its appended rows, and lets their token go on', async () => {
        const page = nextPageWithRows([songRow('abcdefghijk'), { type: 'ContinuationItem', endpoint: { payload: { token: 'tok-3' } } }]);
        const execute = vi.fn(async () => page);

        await expect(readYtmAccountHistory(hostOf(execute), { continuation: 'tok-2' })).resolves.toEqual({
            items: [expect.objectContaining<Partial<YtmWireSong>>({ id: 'abcdefghijk' })],
            continuation: 'tok-3',
        });
        expect(execute).toHaveBeenCalledWith('/browse', { continuation: 'tok-2', client: 'YTMUSIC', parse: true });
    });

    it('reads the token of a shelf without one at the end from the row that carries it', async () => {
        const shelf = { contents: [songRow('abcdefghijk'), { type: 'ContinuationItem', endpoint: { payload: { token: 'tok-2' } } }] };
        const execute = vi.fn(async () => pageOfShelf(shelf));

        await expect(readYtmAccountHistory(hostOf(execute), {})).resolves.toMatchObject({ continuation: 'tok-2' });
    });

    it('answers an empty first page as "no entries yet", with no token', async () => {
        const execute = vi.fn(async () => pageOfShelf({ contents: [] }));

        await expect(readYtmAccountHistory(hostOf(execute), {})).resolves.toEqual({ items: [] });
    });

    it('drops a row that reads as no song: what is not a history song does not reach the wire', async () => {
        const shelf = { contents: [songRow('abcdefghijk'), { id: 'ALB2345678', title: 'Album' }, { type: 'SomeOtherRow' }, { id: '!bad' }] };
        const execute = vi.fn(async () => pageOfShelf(shelf));

        const page = await readYtmAccountHistory(hostOf(execute), {});
        expect(page.items.map(song => song.id)).toEqual(['abcdefghijk']);
        expect(page.continuation).toBeUndefined();
    });

    it('says a continued page holding no rows is a changed page, not "the history ends there"', async () => {
        const execute = vi.fn(async () => ({}));

        await expect(readYtmAccountHistory(hostOf(execute), { continuation: 'tok-2' })).rejects.toThrow('The history page continued into nothing');
        expect(execute).toHaveBeenCalledOnce();
    });

    it('rejects an unrecognized first page rather than inventing empty history', async () => {
        const execute = vi.fn(async () => ({}));
        await expect(readYtmAccountHistory(hostOf(execute), {})).rejects.toThrow('no recognizable shelf');
    });

    it('reads the MusicShelfContinuation format returned by the music client', async () => {
        const execute = vi.fn(async () => ({ continuation_contents: {
            type: 'MusicShelfContinuation', contents: [songRow('abcdefghijk')], continuation: 'tok-3',
        } }));
        await expect(readYtmAccountHistory(hostOf(execute), { continuation: 'tok-2' })).resolves.toMatchObject({
            items: [expect.objectContaining({ id: 'abcdefghijk' })], continuation: 'tok-3',
        });
    });

    it('accepts an explicitly empty append as the end, but not a missing response', async () => {
        const execute = vi.fn(async () => nextPageWithRows([]));
        await expect(readYtmAccountHistory(hostOf(execute), { continuation: 'tok-2' })).resolves.toEqual({ items: [] });
    });

    it('refuses a page token that reads as none, before any page is asked for', async () => {
        const execute = vi.fn(async () => nextPageWithRows([songRow('abcdefghijk')]));
        const host = hostOf(execute);

        await expect(readYtmAccountHistory(host, { continuation: 'x'.repeat(8193) })).rejects.toThrow('Invalid history page token');
        await expect(readYtmAccountHistory(host, { continuation: '' })).rejects.toThrow('Invalid history page token');
        expect(execute).not.toHaveBeenCalled();
    });

    it('lets the error of a session without one signed in through, unsent into an empty page', async () => {
        const execute = vi.fn();
        const host: YtmAndroidHistoryHost = {
            loadLibrary: async () => ({ YTNodes }) as any,
            session: () => { throw new Error('auth-required'); },
        };

        await expect(readYtmAccountHistory(host, {})).rejects.toThrow('auth-required');
        expect(execute).not.toHaveBeenCalled();
    });
});
