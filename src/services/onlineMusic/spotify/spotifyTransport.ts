import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';
import { isFoliaExtensionBridgeConfigured, requestFoliaExtension } from '../../foliaExtensionBridge';
import { IS_ANDROID_WEBVIEW } from '../../../utils/platform';

// src/services/onlineMusic/spotify/spotifyTransport.ts
// The IPC boundary to electron/spotify/spotifyApiBridge.cjs. The Spotify token stays in the main
// process; a query is named here and sent there, and its answer comes back as Spotify gave it.

export type SpotifyOperation =
    | 'login_start' | 'login_check' | 'login_cancel' | 'login_open' | 'login_status' | 'logout'
    | 'query' | 'radio' | 'lyrics' | 'audio' | 'audio_kept' | 'audio_keep' | 'audio_probe' | 'library' | 'playlist_edit' | 'playlist_create'
    | 'playback_mode' | 'soloist_state' | 'soloist_pick' | 'soloist_key' | 'soloist_restart' | 'soloist_open'
    | 'soloist_play' | 'soloist_pause' | 'soloist_resume' | 'soloist_seek' | 'soloist_volume' | 'soloist_status';
// The queries the main process sends for the renderer (`RENDERER_QUERIES` in the bridge).
export type SpotifyQuery =
    | 'home' | 'homeSection' | 'browsePage' | 'queryWhatsNewFeed' | 'libraryV3' | 'fetchLibraryTracks' | 'fetchPlaylist'
    | 'getAlbum' | 'queryArtistOverview' | 'queryArtistDiscographyAll' | 'searchTracks' | 'getTrack' | 'areEntitiesInLibrary';
export type SpotifyParams = Record<string, unknown>;
// `reason`: the desktop side's own word for why a sign-in failed, where it has one.
export type SpotifyBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: ProviderErrorCode; message: string; reason?: string } };

export interface SpotifyWireLoginStart { key: string; expiresInMs: number }
/** The playlist Spotify keeps of the songs like one song. */
export interface SpotifyWireRadio { uri: string }
/** The app's own URL for a track's audio, and the file Spotify chose for it ("OGG_VORBIS_320"). */
export interface SpotifyWireAudio { url: string; format: string }
/** The playlist that was made. */
export interface SpotifyWireMadePlaylist { uri: string }
export interface SpotifyWireLyrics { timed: boolean; lines: Array<{ startMs: number; words: string }> }

// 桌面走 Electron 主进程桥；Android 走内置原生桥（SpotifyAuth 负责登录与令牌，
// nativeBridge/api/spotify.js 负责查询与写入）。
export const getSpotifyTransportAvailability = () => (
    typeof window !== 'undefined'
    && (typeof window.electron?.spotifyRequest === 'function'
        || (IS_ANDROID_WEBVIEW && isFoliaExtensionBridgeConfigured('extension')))
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestSpotify<T = unknown>(operation: SpotifyOperation, params: SpotifyParams = {}): Promise<T> {
    if (!getSpotifyTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', 'Spotify requires the desktop app', 'spotify');
    }
    const named = operation === 'query' ? `${operation} ${String(params.name)}` : operation;
    const startedAt = Date.now();
    let result: SpotifyBridgeResult;
    if (typeof window.electron?.spotifyRequest === 'function') {
        try { result = await window.electron.spotifyRequest(operation, params); }
        catch {
            console.warn(`[Spotify] ${named} did not reach the desktop app`);
            throw new OnlineProviderError('network', 'Spotify desktop request failed', 'spotify');
        }
    } else {
        // Android：内置桥直连（错误以 Error 抛出，登录失效按 auth-required 归）。
        try {
            result = { ok: true, data: await requestFoliaExtension({ provider: 'spotify', operation, params }) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[Spotify] ${named} failed after ${Date.now() - startedAt}ms: ${message}`);
            const authRequired = /sign-in is required|sign-in required/i.test(message);
            const unsupported = /not available on Android|Unsupported Spotify/i.test(message);
            throw new OnlineProviderError(authRequired ? 'auth-required' : unsupported ? 'unsupported' : 'network', message, 'spotify');
        }
    }
    if (!result.ok) {
        console.warn(`[Spotify] ${named} failed after ${Date.now() - startedAt}ms: ${result.error.code} (${result.error.message ?? ''})`);
        // The reason goes with the error as its cause (spotifyLoginFailure.ts reads it there).
        throw new OnlineProviderError(result.error.code, result.error.message, 'spotify', result.error.reason);
    }
    return result.data as T;
}

// One of Spotify's named queries, answered with the `data` of its reply.
export const querySpotify = <T = unknown>(name: SpotifyQuery, variables: Record<string, unknown> = {}): Promise<T> => (
    requestSpotify<T>('query', { name, variables })
);
