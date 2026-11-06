import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// The page-side guards behind "queued but never sounded": the storefront the player is moved to,
// the single nudge for a start that did not begin, and a failure that gives way to real sound.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../electron/appleMusic/companionRequests.cjs');

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

    it('asks a stopped player once more and never restarts a finished or playing one', async () => {
        const stopped = player({ playbackState: 4, isPlaying: false });
        const stoppedContext = { window: { MusicKit: { getInstance: () => stopped } }, console };
        await run(stoppedContext, 'playSong', { catalogId: '123' });
        (stoppedContext.window as { __foliaStart?: { startedAt: number } }).__foliaStart!.startedAt = Date.now() - 5000;
        await run(stoppedContext, 'playbackStatus');
        expect(stopped.play).toHaveBeenCalledTimes(2);

        const ended = player({ playbackState: 5, isPlaying: false });
        const endedContext = { window: { MusicKit: { getInstance: () => ended } }, console };
        await run(endedContext, 'playSong', { catalogId: '123' });
        (endedContext.window as { __foliaStart?: { startedAt: number } }).__foliaStart!.startedAt = Date.now() - 5000;
        await run(endedContext, 'playbackStatus');
        expect(ended.play).toHaveBeenCalledTimes(1);

        const sounding = player({ playbackState: 2, isPlaying: true });
        const soundingContext = { window: { MusicKit: { getInstance: () => sounding } }, console };
        await run(soundingContext, 'playSong', { catalogId: '123' });
        (soundingContext.window as { __foliaStart?: { startedAt: number } }).__foliaStart!.startedAt = Date.now() - 5000;
        await run(soundingContext, 'playbackStatus');
        expect(sounding.play).toHaveBeenCalledTimes(1);
    });

    it('lets a rejection give way to a track that is actually playing', async () => {
        const mk = player({ playbackState: 2, isPlaying: false });
        const context = { window: { MusicKit: { getInstance: () => mk } }, console };
        const playback = (context.window as { __foliaStart?: unknown });
        await run(context, 'playSong', { catalogId: '123' });
        (playback.__foliaStart as { failed: boolean }).failed = true;
        mk.isPlaying = true;
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
