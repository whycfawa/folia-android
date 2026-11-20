import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';
import { normalizeAppleMusicSong } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';
import { getOnlineMusicProvider } from '../../../src/services/onlineMusic/providerRegistry';

// A login session must not accept a late account response after cancellation.
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Apple Music provider login', () => {
    it('confirms only after the companion supplies a valid account identity', async () => {
        const request = vi.fn(async (operation: string) => operation === 'accountStatus'
            ? { ok: true, data: { id: 'a'.repeat(64), nickname: 'Example' } }
            : { ok: true, data: {} });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const key = await provider.auth!.startLogin!();
        await expect(provider.auth!.checkLogin!(key)).resolves.toEqual({ state: 'confirmed' });
        expect(request).toHaveBeenCalledWith('showWindow', {});
        // The sign-in window goes back into the background once the account is confirmed.
        expect(request).toHaveBeenCalledWith('hideWindow', {});
        expect(provider.capabilities.playback).toBe(false);
    });

    it('discards an account response that arrives after cancel', async () => {
        let resolve!: (value: unknown) => void;
        const pending = new Promise(done => { resolve = done; });
        const request = vi.fn((operation: string) => operation === 'accountStatus'
            ? pending : Promise.resolve({ ok: true, data: {} }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const key = await provider.auth!.startLogin!();
        const check = provider.auth!.checkLogin!(key);
        await provider.auth!.cancelLogin!(key);
        resolve({ ok: true, data: { id: 'a'.repeat(64), nickname: 'Example' } });
        await expect(check).resolves.toEqual({ state: 'expired' });
    });

    it('treats authentication failure as waiting but propagates unknown identity', async () => {
        const request = vi.fn(async (operation: string) => operation === 'accountStatus'
            ? { ok: false, error: 'auth-required' } : { ok: true, data: {} });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const key = await provider.auth!.startLogin!();
        await expect(provider.auth!.checkLogin!(key)).resolves.toEqual({ state: 'waiting' });
        request.mockImplementation(async (operation: string) => operation === 'accountStatus'
            ? { ok: false, error: 'identity-unavailable' } : { ok: true, data: {} });
        await expect(provider.auth!.checkLogin!(key)).rejects.toMatchObject({ code: 'unavailable', cause: 'identity-unavailable' });
    });
});

// Apple supplies TTML for a song it has timed lyrics for; the parsed lyric keeps the timing it had.
const wordLevelTtml = [
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">',
    '<body dur="00:04.000"><div begin="00:01.000" end="00:03.000">',
    '<p begin="00:01.000" end="00:03.000" itunes:key="L1"><span begin="00:01.000" end="00:01.500">Hello</span> <span begin="00:01.500" end="00:02.500">world</span></p>',
    '</div></body></tt>',
].join('');
const lineLevelTtml = wordLevelTtml.replace('itunes:timing="Word"', 'itunes:timing="Line"');

describe('Apple Music lyrics and external playback', () => {
    const song = normalizeAppleMusicSong({ id: '123', type: 'songs', attributes: { name: 'Example' } });

    it('keeps whether Apple gave word-level or line-level timing', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { ttml: wordLevelTtml } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const result = await provider.lyrics!.getLyrics(song);
        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(result.lyrics?.ttml?.timingMode).toBe('Word');

        request.mockImplementation(async () => ({ ok: true, data: { ttml: lineLevelTtml } }));
        const lineLevel = await provider.lyrics!.getLyrics(song);
        expect(lineLevel.lyrics?.isWordByWord).toBe(false);
        expect(lineLevel.lyrics?.ttml?.timingMode).toBe('Line');
    });

    it('reports no lyrics rather than an error when Apple has none for the song', async () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: false, error: 'lyrics-unavailable' })) } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        await expect(provider.lyrics!.getLyrics(song)).resolves.toEqual({ lyrics: null, isPureMusic: false });
    });

    it('steers the companion by the catalog id and follows its status', async () => {
        const request = vi.fn(async (operation: string, params?: Record<string, unknown>) => {
            if (operation === 'playbackStatus') {
                return { ok: true, data: {
                    itemId: 'i.library', catalogId: '123', isPlaying: true, state: 2, positionMs: 45000, durationMs: 180000,
                } };
            }
            return { ok: true, data: {} };
        });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const external = provider.externalPlayback!;
        await external.play(song, 12.25);
        expect(request).toHaveBeenCalledWith('playSong', expect.objectContaining({ catalogId: '123', startSec: 12.25, requestKey: expect.any(String) }));
        const status = await external.getStatus(song);
        expect(status).toMatchObject({ mediaId: '123', isPlaying: true, positionMs: 45000, durationMs: 180000, ended: false });
        expect(external.isStatusForSong(song, status)).toBe(true);
        expect(external.isStatusForSong({ ...song, sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'i.other' } }, status)).toBe(false);
    });

    it('marks the end the player reports and rejects a malformed status', async () => {
        const request = vi.fn(async (): Promise<unknown> => ({ ok: true, data: {
            itemId: '123', catalogId: '123', isPlaying: false, state: 5, positionMs: 180000, durationMs: 180000,
        } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toMatchObject({ ended: true });

        // stalled (9) is not the end; completed (10) is.
        request.mockImplementation(async () => ({ ok: true, data: {
            itemId: '123', catalogId: '123', isPlaying: false, state: 9, positionMs: 1000, durationMs: 180000,
        } }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toMatchObject({ ended: false });
        request.mockImplementation(async () => ({ ok: true, data: {
            itemId: '123', catalogId: '123', isPlaying: false, state: 10, positionMs: 180000, durationMs: 180000,
        } }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toMatchObject({ ended: true });

        request.mockImplementation(async () => ({ ok: true, data: { itemId: '123', isPlaying: true, positionMs: -1, durationMs: 10 } }));
        await expect(provider.externalPlayback!.getStatus(song)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('waits through a player with no track instead of calling the answer malformed', async () => {
        const request = vi.fn(async () => ({ ok: true, data: {
            itemId: '', catalogId: '', isPlaying: false, state: 0, positionMs: 0, durationMs: 0,
        } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toEqual({
            mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0, ended: false,
        });
    });


    it('retains the completed song identity after MusicKit clears its item and time', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        data = { itemId: '', catalogId: '', isPlaying: false, state: 3, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ ended: false });
        data.state = 10;
        await expect(external.getStatus(song)).resolves.toEqual({
            mediaId: '123', isPlaying: false, ended: true, positionMs: 180000, durationMs: 180000,
        });
        // A new attempt has not played: the previous song's completed state cannot skip it.
        await external.play(song, 0);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
    });

    // #1142: at a natural end MusicKit may clear its item and report stopped (4), not ended.
    it('takes a stop with no item right after the song was heard at its end as the end', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let data: Record<string, unknown> = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, repeatMode: 0, positionMs: 178500, durationMs: 180000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        now += 500;
        data = { itemId: '', catalogId: '', isPlaying: false, state: 4, repeatMode: 0, positionMs: 0, durationMs: 0, queueLength: 3 };
        await expect(external.getStatus(song)).resolves.toEqual({
            mediaId: '123', isPlaying: false, ended: true, positionMs: 180000, durationMs: 180000,
        });
    });

    it('counts the time since the last answer when answers come slowly', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let data: Record<string, unknown> = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, repeatMode: 0, positionMs: 170000, durationMs: 180000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        now += 9000;
        data = { itemId: '', catalogId: '', isPlaying: false, state: 4, repeatMode: 0, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
    });

    // MusicKit keeps saying it plays while the element under it sits in waiting and its position
    // stops (Apple's Android WebView, mid-song on DRM, 2026-11-20). That stillness is not listening
    // time: counted as such it carries the song to its end, and the track is skipped with no reason.
    it('reads a stalled stream as stalled, and does not count its stillness as listening', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let data: Record<string, unknown> = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, repeatMode: 0, positionMs: 148300, durationMs: 200000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        const first = await external.getStatus(song);
        expect(first).toMatchObject({ mediaId: '123', isPlaying: true, ended: false });
        expect(first.stalled).toBeUndefined();
        // Six seconds of answers that do not move: the stream is stuck, and said so.
        for (let answer = 0; answer < 13; answer += 1) {
            now += 500;
            await external.getStatus(song);
        }
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', isPlaying: true, ended: false, stalled: true });

        // The player then gives up and clears its item a minute later. None of that minute was
        // listened to: the song never reached its end, and must not be skipped as if it had.
        now += 60000;
        data = { itemId: '', catalogId: '', isPlaying: false, state: 4, repeatMode: 0, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
    });

    it('sees the end through MusicKit going back to 0 before it clears the item', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let data: Record<string, unknown> = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, repeatMode: 0, positionMs: 179000, durationMs: 180000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        now += 500;
        data = { ...data, isPlaying: false, state: 3, positionMs: 0 };
        await external.getStatus(song);
        now += 500;
        data = { itemId: '', catalogId: '', isPlaying: false, state: 4, repeatMode: 0, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
    });

    it('does not count a sleep-long gap between answers as listening', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let data: Record<string, unknown> = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, repeatMode: 0, positionMs: 60000, durationMs: 180000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        now += 3_600_000;
        data = { itemId: '', catalogId: '', isPlaying: false, state: 4, repeatMode: 0, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
    });

    it('keeps a stop with no item a pause: mid-song, after a player that stayed empty, or while repeating one track', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let data: Record<string, unknown> = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, repeatMode: 0, positionMs: 100000, durationMs: 180000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        now += 500;
        data = { itemId: '', catalogId: '', isPlaying: false, state: 4, repeatMode: 0, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
        // Minutes of an empty player do not carry the song on to its end.
        now += 120000;
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });

        // The single repeat going round passes through the same answer: that is not the end.
        data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, repeatMode: 1, positionMs: 179500, durationMs: 180000 };
        await external.getStatus(song);
        now += 500;
        data = { itemId: '', catalogId: '', isPlaying: false, state: 4, repeatMode: 1, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
    });

    it('does not adopt another song completion or a late sample from an earlier attempt', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        let resolve!: (value: unknown) => void;
        let wait = false;
        const request = vi.fn(async (operation: string): Promise<unknown> => {
            if (operation === 'playbackStatus' && wait) return new Promise(done => { resolve = done; });
            return { ok: true, data };
        });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        data = { ...data, itemId: '456', catalogId: '456' };
        await external.getStatus(song);
        data = { itemId: '', catalogId: '', isPlaying: false, state: 10, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ ended: false });
        wait = true;
        const late = external.getStatus(song);
        await external.play(song, 0);
        resolve({ ok: true, data: { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 } });
        await late;
        wait = false;
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
    });


    it('adopts only the approved successor as completion of the old song', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: true, data })) } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        const next = normalizeAppleMusicSong({ id: '456', type: 'songs', attributes: { name: 'Next' } });
        await external.prepareNext!(song, [next]);
        data = { ...data, itemId: '456', catalogId: '456', positionMs: 100 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
        await external.prepareNext!(song, []);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '456', ended: false });
    });


    // 2026-11-20（安卓 .474 报告）：一首放不动的歌，MusicKit 自己走到预备队列的下一首。原先这种
    // 移动被当成「上一首播完了」，于是这首歌被静默跳过。只有听到结尾附近才算它自己的结束。
    it('does not take the player leaving an unplayed song for that song end', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 148300, durationMs: 200000 };
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: true, data })) } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        const next = normalizeAppleMusicSong({ id: '456', type: 'songs', attributes: { name: 'Next' } });
        await external.prepareNext!(song, [next]);
        // 51 秒之前就换了歌：这首歌没有播到它的结尾。
        data = { ...data, itemId: '456', catalogId: '456', isPlaying: true, positionMs: 1200 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '456', ended: false, movedOn: true });
    });

    // 2026-11-20（安卓 .475 报告）：有些歌页面自己就拒绝——MusicKit 抛 MKError mk-007
    // CONTENT_RESTRICTED，媒体元素拿到了 metadata 却始终没有声音。原先这只能在页面日志里看到，
    // Folia 只能把它当「接受起播但一直没开始」反复重开；现在页面把这条答复交回来，如实说一次。
    it('reports a song the page refuses as unplayable instead of asking again', async () => {
        const data: Record<string, unknown> = {
            itemId: '', catalogId: '', isPlaying: false, state: 4, positionMs: 0, durationMs: 0,
            playError: { at: Date.now(), ageMs: 1200, mkCode: 'mk-007', reason: 'CONTENT_RESTRICTED' },
        };
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: true, data })) } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await expect(external.getStatus(song)).resolves.toMatchObject({ unplayable: 'content-restricted' });
    });

    // 真的出过声的歌不能被上一首留下的拒绝记到头上：拒绝只算一整首都没放出来的那一次。
    it('does not call a song refused once it was heard playing', async () => {
        let data: Record<string, unknown> = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 3000, durationMs: 200000 };
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: true, data })) } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        data = { ...data, isPlaying: false, playError: { at: Date.now(), ageMs: 900, mkCode: 'mk-007', reason: 'CONTENT_RESTRICTED' } };
        const status = await external.getStatus(song);
        expect(status.unplayable).toBeUndefined();
        expect(status.ended).toBe(false);
    });

    // 页面一条错也没给、只是起播后一直没有音频：也报上去，界面按「未返回音频」处理。
    it('reports a start that delivered no media data as unplayable', async () => {
        const data: Record<string, unknown> = {
            itemId: '', catalogId: '', isPlaying: false, state: 4, positionMs: 0, durationMs: 0,
            playError: { at: Date.now(), ageMs: 12000, mkCode: '', reason: 'NO_AUDIO_START' },
        };
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: true, data })) } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await expect(external.getStatus(song)).resolves.toMatchObject({ unplayable: 'no-audio' });
    });

    it('keeps an already prepared handoff when an edit arrives after native advancement', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        let stale = false;
        const request = vi.fn(async (operation: string): Promise<unknown> => operation === 'prepareNext' && stale
            ? { ok: false, error: 'stale-request' } : { ok: true, data });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        const next = normalizeAppleMusicSong({ id: '456', type: 'songs', attributes: { name: 'Next' } });
        const inserted = normalizeAppleMusicSong({ id: '789', type: 'songs', attributes: { name: 'Inserted' } });
        await external.play(song, 0);
        await external.getStatus(song);
        await external.prepareNext!(song, [next]);
        data = { ...data, itemId: '456', catalogId: '456', positionMs: 100, isPlaying: false };
        stale = true;
        await external.prepareNext!(song, [inserted, next]);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
        await external.prepareNext!(song, []);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
    });

    // A window rebuild: the companion still plays the song a window that is gone started.
    it('takes over a song another window started: prepares its successors and adopts their native advance', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        const request = vi.fn(async (_operation: string, _params?: Record<string, unknown>) => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        const next = normalizeAppleMusicSong({ id: '456', type: 'songs', attributes: { name: 'Next' } });
        // Without a play of this window's there is nothing to prepare successors for.
        await external.prepareNext!(song, [next]);
        expect(request).not.toHaveBeenCalledWith('prepareNext', expect.anything());

        external.adopt!(song);
        await external.getStatus(song);
        await external.prepareNext!(song, [next]);
        expect(request).toHaveBeenCalledWith('prepareNext', { catalogId: '123', nextIds: ['456'] });
        expect(request).not.toHaveBeenCalledWith('playSong', expect.anything());
        data = { ...data, itemId: '456', catalogId: '456', positionMs: 100 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
        expect(external.isPrepared!(next)).toBe(true);
    });

    it('takes over a song whose end MusicKit already cleared, and a live station without a song attempt', async () => {
        let data = { itemId: '', catalogId: '', isPlaying: false, state: 10, positionMs: 0, durationMs: 0 };
        const request = vi.fn(async (_operation: string, _params?: Record<string, unknown>) => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        external.adopt!(song);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });

        const station = { ...song, sourceRef: { kind: 'online' as const, providerId: 'appleMusic', mediaId: 'ra.123', providerData: { resourceType: 'stations', isLive: true } } };
        external.adopt!(station);
        data = { itemId: 'ra.123', catalogId: 'ra.123', isPlaying: true, state: 2, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(station)).resolves.toMatchObject({ mediaId: 'ra.123', isPlaying: true });
        await external.prepareNext!(station, [song]);
        // A live broadcast has no timeline: a seek is not sent, as after the station was started here.
        await external.seek(30);
        expect(request).not.toHaveBeenCalledWith('prepareNext', expect.anything());
        expect(request).not.toHaveBeenCalledWith('seek', expect.anything());
    });

    it('is the provider the registry holds', () => {
        const registered = getOnlineMusicProvider('appleMusic');
        expect(registered?.capabilities.externalPlayback).toBe(true);
        expect(registered?.capabilities.playback).toBe(false);
        expect(registered?.externalPlayback).toBeDefined();
    });
});
