// src/tv/services/tvNativePlayback.ts

import { getSongAlbumLabel, getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import type { TvPlaybackStatus } from '../model/tvTypes';
import { resolveTvSongCoverUrl } from './tvPlaybackSource';

export type TvNativePlaybackAction = 'play' | 'pause' | 'next' | 'previous' | 'stop';

export type TvNativePlaybackPayload = {
    title: string;
    artist: string;
    album: string;
    coverUrl: string;
    songKey: string;
    playing: boolean;
    position: number;
    duration: number;
    launchTarget: 'tv';
    requestNotificationPermission: false;
};

export type TvNativePlaybackPlugin = {
    updatePlaybackState: (payload: TvNativePlaybackPayload) => Promise<unknown>;
    clearPlaybackState: () => Promise<unknown>;
    moveTaskToBack?: () => Promise<unknown>;
    exitApp?: () => Promise<unknown>;
    addListener: (
        eventName: string,
        listener: (event: { action?: string }) => void,
    ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
    recordRuntimeDiagnostic?: (payload: {
        source: string;
        thread: string;
        type: string;
        message: string;
        stack: string;
    }) => Promise<unknown>;
};

type NativeTvPluginHost = {
    getPlatform?: () => string;
    Plugins?: { FoliaNative?: TvNativePlaybackPlugin };
};

const BRIDGE_RETRY_DELAY_MS = 150;
const BRIDGE_RETRY_COUNT = 8;

const wait = (milliseconds: number): Promise<void> => (
    new Promise(resolve => window.setTimeout(resolve, milliseconds))
);

export const readTvNativePlaybackPlugin = (): TvNativePlaybackPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as { Capacitor?: NativeTvPluginHost }).Capacitor;
    if (!capacitor || capacitor.getPlatform?.() !== 'android') return null;
    const plugin = capacitor.Plugins?.FoliaNative;
    if (
        !plugin
        || typeof plugin.updatePlaybackState !== 'function'
        || typeof plugin.clearPlaybackState !== 'function'
        || typeof plugin.addListener !== 'function'
    ) {
        return null;
    }
    return plugin;
};

let pluginRequest: Promise<TvNativePlaybackPlugin | null> | null = null;

/** Resolves the Capacitor bridge after the WebView has injected it. */
export const loadTvNativePlaybackPlugin = (): Promise<TvNativePlaybackPlugin | null> => {
    if (pluginRequest) return pluginRequest;
    if (typeof window === 'undefined') return Promise.resolve(null);

    pluginRequest = (async () => {
        for (let attempt = 0; attempt < BRIDGE_RETRY_COUNT; attempt += 1) {
            const plugin = readTvNativePlaybackPlugin();
            if (plugin) return plugin;

            const capacitor = (window as unknown as { Capacitor?: NativeTvPluginHost }).Capacitor;
            if (capacitor?.getPlatform && capacitor.getPlatform() !== 'android') return null;
            await wait(BRIDGE_RETRY_DELAY_MS);
        }
        return null;
    })();
    return pluginRequest;
};

export const buildTvNativePlaybackPayload = ({
    song,
    status,
    positionSeconds,
    durationSeconds,
}: {
    song: SongResult | null;
    status: TvPlaybackStatus;
    positionSeconds: number;
    durationSeconds: number;
}): TvNativePlaybackPayload | null => {
    if (!song) return null;
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    const position = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
    return {
        title: song.name || 'Folia',
        artist: getSongArtistLabel(song),
        album: getSongAlbumLabel(song),
        coverUrl: resolveTvSongCoverUrl(song) ?? '',
        songKey: getPlaybackSongKey(song),
        playing: status === 'playing',
        position: Math.round(position * 1000),
        duration: Math.round(duration * 1000),
        launchTarget: 'tv',
        requestNotificationPermission: false,
    };
};

/** Identical snapshots must not restart the foreground service. */
export const buildTvNativePlaybackIdentity = (payload: TvNativePlaybackPayload): string => (
    JSON.stringify([
        payload.title,
        payload.artist,
        payload.album,
        payload.coverUrl,
        payload.songKey,
        payload.playing,
        payload.position,
        payload.duration,
    ])
);

export const resolveTvNativeMediaAction = (
    action: string | undefined,
): TvNativePlaybackAction | null => {
    if (
        action === 'play'
        || action === 'pause'
        || action === 'next'
        || action === 'previous'
        || action === 'stop'
    ) {
        return action;
    }
    return null;
};
