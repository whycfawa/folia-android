// src/tv/hooks/useTvPlayer.ts

import { useEffect, useRef } from 'react';
import { getSongArtistLabel, getSongAlbumLabel } from '../../services/onlineMusic/songMetadata';
import type { TvPlayerModel } from '../model/tvTypes';
import { readTvNativePlaybackPlugin } from '../services/tvNativePlayback';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';
import { useTvAudioTransport } from './useTvAudioTransport';
import { useTvPlaybackQueue } from './useTvPlaybackQueue';

/**
 * Assembly point for TV playback: one audio deck, one queue, one lyric clock.
 * Browser builds use Web MediaSession; the Android shell owns the native session instead.
 */
export const useTvPlayer = (): TvPlayerModel => {
    const usesNativeMediaSession = readTvNativePlaybackPlugin() !== null;
    const nextRef = useRef<() => void>(() => undefined);
    const transport = useTvAudioTransport({
        onEnded: () => nextRef.current(),
        onError: () => undefined,
    });
    const playback = useTvPlaybackQueue(transport);
    nextRef.current = playback.next;

    useEffect(() => {
        // Android's foreground service owns the native MediaSession; registering both would show
        // two media cards and can make one hardware key press execute twice.
        if (usesNativeMediaSession) return undefined;
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined;
        const session = navigator.mediaSession;
        const song = playback.currentSong;
        const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.card);

        session.metadata = song
            ? new MediaMetadata({
                title: song.name,
                artist: getSongArtistLabel(song),
                album: getSongAlbumLabel(song),
                artwork: coverUrl ? [{ src: coverUrl, sizes: '512x512' }] : [],
            })
            : null;
        session.playbackState = playback.status === 'playing' ? 'playing' : 'paused';

        session.setActionHandler('play', playback.resumeCurrent);
        session.setActionHandler('pause', playback.pause);
        session.setActionHandler('previoustrack', playback.previous);
        session.setActionHandler('nexttrack', playback.next);
        session.setActionHandler('seekbackward', () => playback.seekBy(-10));
        session.setActionHandler('seekforward', () => playback.seekBy(10));
        return () => {
            session.setActionHandler('play', null);
            session.setActionHandler('pause', null);
            session.setActionHandler('previoustrack', null);
            session.setActionHandler('nexttrack', null);
            session.setActionHandler('seekbackward', null);
            session.setActionHandler('seekforward', null);
        };
    }, [
        playback.currentSong,
        playback.next,
        playback.pause,
        playback.previous,
        playback.resumeCurrent,
        playback.seekBy,
        playback.status,
        usesNativeMediaSession,
    ]);

    useEffect(() => {
        document.title = playback.currentSong ? `${playback.currentSong.name} · Music` : 'Music';
    }, [playback.currentSong]);

    const duration = transport.duration > 0
        ? transport.duration
        : (playback.currentSong?.durationMs ?? 0) / 1000;

    return {
        audioRef: transport.audioRef,
        currentSong: playback.currentSong,
        currentIndex: playback.currentIndex,
        queue: playback.queue,
        lyrics: playback.lyrics,
        status: playback.status,
        error: playback.error,
        currentTime: transport.currentTime,
        positionRevision: transport.positionRevision,
        duration,
        visualizerMode: playback.visualizerMode,
        backgroundMode: playback.backgroundMode,
        isLyricsLoading: playback.isLyricsLoading,
        playQueue: playback.playQueue,
        togglePlayback: playback.togglePlayback,
        resumeCurrent: playback.resumeCurrent,
        pause: playback.pause,
        next: playback.next,
        previous: playback.previous,
        skipPrevious: playback.skipPrevious,
        seekBy: playback.seekBy,
        setVisualizerMode: playback.setVisualizerMode,
        setBackgroundMode: playback.setBackgroundMode,
    };
};

