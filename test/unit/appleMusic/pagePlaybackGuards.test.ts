import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// The page-side guards behind "queued but never sounded": the storefront the player is moved to,
// the single nudge for a start that did not begin, and a failure that gives way to real sound.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../sources/appleMusic/main/companionRequests.cjs');

const run = (context: Record<string, unknown>, operation: string, params = {}) => runInNewContext(
    requestExpression(validateRequest({ id: 'test', operation, params })),
    context,
);

const player = (overrides: Record<string, unknown> = {}) => ({
    api: { music: vi.fn() },
    storefrontId: 'cn',
    playbackState: 2,
    isPlaying: true,
    setQueue: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    ...overrides,
});

describe('Apple Music Android playback guards', () => {
    it('moves the page player to the account storefront the host handed in', async () => {
        const mk = player({ playbackState: 0, isPlaying: false });
        const context = {
            window: { MusicKit: { getInstance: () => mk }, __foliaAccountStorefront: 'us', __foliaCompanionHost: 'android' },
            console,
        };
        expect(await run(context, 'playSong', { catalogId: '123' })).toMatchObject({ ok: true });
        expect(mk.storefrontId).toBe('us');
    });

    it('lets the queue start itself on Android and keeps the desktop order', async () => {
        const androidMk = player({ playbackState: 0, isPlaying: false });
        const androidContext = {
            window: { MusicKit: { getInstance: () => androidMk }, __foliaCompanionHost: 'android', __foliaAccountStorefront: 'us' },
            console,
        };
        await run(androidContext, 'playSong', { catalogId: '123' });
        expect(androidMk.setQueue).toHaveBeenCalledWith({ song: '123', startPlaying: true });
        expect(androidMk.storefrontId).toBe('us');

        const desktopMk = player();
        await run({ window: { MusicKit: { getInstance: () => desktopMk } }, console }, 'playSong', { catalogId: '123' });
        expect(desktopMk.setQueue).toHaveBeenCalledWith({ song: '123', startPlaying: false, startTime: 0 });
    });

    it('leaves a desktop page alone: no region lookup and no in-place switch', async () => {
        const music = vi.fn(async () => ({ status: 200, data: { data: [{ id: 'us' }] } }));
        const mk = player({ api: { music } });
        const context = { window: { MusicKit: { getInstance: () => mk } }, console };
        expect(await run(context, 'playSong', { catalogId: '123' })).toMatchObject({ ok: true });
        expect(music).not.toHaveBeenCalled();
        expect(mk.storefrontId).toBe('cn');
    });

    // 上游 0.8.0 起页面脚本不再自己「再喊一次播放」：停止、播完、正在响都只喊一次，失败交给宿主重试。
    it('never starts the player again on its own: stopped, finished or playing', async () => {
        for (const state of [4, 5, 2]) {
            const mk = player({ playbackState: state, isPlaying: state === 2 });
            const context = { window: { MusicKit: { getInstance: () => mk } }, console };
            await run(context, 'playSong', { catalogId: '123' });
            (context.window as { __foliaStart?: { startedAt: number } }).__foliaStart!.startedAt = Date.now() - 5000;
            await run(context, 'playbackStatus');
            expect(mk.play).toHaveBeenCalledTimes(1);
        }
    });

    // 判失败要留退路：真响了（位置在往前走）就把可恢复的失败收回，别把正在放的歌报成失败。
    it('lets a recoverable rejection give way to a track that is actually sounding', async () => {
        const mk = player({ playbackState: 2, isPlaying: true, currentPlaybackTime: 1 }) as ReturnType<typeof player> & { currentPlaybackTime: number };
        const context = { window: { MusicKit: { getInstance: () => mk } }, console };
        const playback = (context.window as { __foliaStart?: unknown });
        await run(context, 'playSong', { catalogId: '123' });
        Object.assign(playback.__foliaStart as Record<string, unknown>, { failed: true, recoverable: true, heardAt: 0 });
        mk.currentPlaybackTime = 2;
        expect(await run(context, 'playbackStatus')).toMatchObject({ ok: true, data: { isPlaying: true } });
    });

    it('answers diagnostics without MusicKit instead of failing the whole report', async () => {
        const context = {
            window: { isSecureContext: true },
            document: { querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible' },
            navigator: { requestMediaKeySystemAccess: vi.fn(async () => { throw new Error('no cdm'); }) },
            location: { origin: 'https://music.apple.com', pathname: '/us/browse' },
            console,
        };
        const result = await run(context, 'diagnostics') as { ok: boolean; data: Record<string, unknown> };
        expect(result.ok).toBe(true);
        expect(result.data.player).toBeNull();
        expect(result.data).toMatchObject({ page: { url: 'https://music.apple.com/us' } });
    });
});
