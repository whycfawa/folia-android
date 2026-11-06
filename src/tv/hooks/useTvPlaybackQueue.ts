// src/tv/hooks/useTvPlaybackQueue.ts

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFromCache, saveToCache } from '../../services/db';
import { retireBlobUrl } from '../../services/playbackBlobUrls';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import type { LyricData, SongResult } from '../../types';
import type { VisualizerBackgroundMode, VisualizerMode } from '../../types';
import type { TvAudioTransport } from './useTvAudioTransport';
import { isLocalPlaybackSong } from '../../utils/appPlaybackGuards';
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    DEFAULT_VISUALIZER_MODE,
    isBuiltinVisualizerBackgroundMode,
    isBuiltinVisualizerMode,
} from '../../types/visualizerModes';
import type { TvPlaybackStatus } from '../model/tvTypes';
import {
    loadTvSongAudio,
    loadTvSongLyrics,
    TvPlaybackSourceError,
} from '../services/tvPlaybackSource';

const TV_VISUALIZER_MODE_STORAGE_KEY = 'folia_tv_visualizer_mode';
const TV_BACKGROUND_MODE_STORAGE_KEY = 'folia_tv_background_mode';

const readVisualizerMode = (): VisualizerMode => {
    if (typeof localStorage === 'undefined') return DEFAULT_VISUALIZER_MODE;
    const stored = localStorage.getItem(TV_VISUALIZER_MODE_STORAGE_KEY);
    return isBuiltinVisualizerMode(stored) ? stored : DEFAULT_VISUALIZER_MODE;
};

const readBackgroundMode = (): VisualizerBackgroundMode => {
    if (typeof localStorage === 'undefined') return DEFAULT_VISUALIZER_BACKGROUND_MODE;
    const stored = localStorage.getItem(TV_BACKGROUND_MODE_STORAGE_KEY);
    return isBuiltinVisualizerBackgroundMode(stored)
        ? stored
        : DEFAULT_VISUALIZER_BACKGROUND_MODE;
};

export type TvPlaybackQueueModel = {
    currentSong: SongResult | null;
    currentIndex: number;
    queue: SongResult[];
    lyrics: LyricData | null;
    status: TvPlaybackStatus;
    error: string | null;
    duration: number;
    isLyricsLoading: boolean;
    visualizerMode: VisualizerMode;
    backgroundMode: VisualizerBackgroundMode;
    playQueue: (songs: SongResult[], startIndex?: number) => void;
    togglePlayback: () => void;
    resumeCurrent: () => void;
    pause: () => void;
    next: () => void;
    previous: () => void;
    skipPrevious: () => void;
    seekBy: (deltaSeconds: number) => void;
    setVisualizerMode: (mode: VisualizerMode) => void;
    setBackgroundMode: (mode: VisualizerBackgroundMode) => void;
};

/**
 * TV's single-deck queue. Source resolution and lyric matching are shared with the phone app, but
 * TV keeps its own current/queue state instead of mounting App's large controller graph.
 */
export const useTvPlaybackQueue = (transport: TvAudioTransport): TvPlaybackQueueModel => {
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    const userId = useOnlineProviderAccountStore(state => {
        const providerId = state.activeProviderId;
        return state.accounts[providerId]?.user?.id ?? null;
    });
    const [queue, setQueue] = useState<SongResult[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [currentSong, setCurrentSong] = useState<SongResult | null>(null);
    const [lyrics, setLyrics] = useState<LyricData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const [visualizerMode, setVisualizerModeState] = useState<VisualizerMode>(readVisualizerMode);
    const [backgroundMode, setBackgroundModeState] = useState<VisualizerBackgroundMode>(
        readBackgroundMode,
    );
    const queueRef = useRef<SongResult[]>([]);
    const indexRef = useRef(-1);
    const currentSongRef = useRef<SongResult | null>(null);
    const requestIdRef = useRef(0);
    const restoredRef = useRef(false);
    const mountedRef = useRef(true);
    const { reset, pause, resume, seekBy: seekTransport, loadSource, hasSource, fail } = transport;

    const commitQueue = useCallback((songs: SongResult[], index: number) => {
        queueRef.current = songs;
        indexRef.current = index;
        setQueue(songs);
        setCurrentIndex(index);
    }, []);

    const playQueue = useCallback((songs: SongResult[], startIndex = 0) => {
        if (songs.length === 0) return;
        const boundedIndex = Math.max(0, Math.min(songs.length - 1, startIndex));
        const song = songs[boundedIndex];
        if (!song) return;

        const requestId = ++requestIdRef.current;
        const isCurrent = () => requestIdRef.current === requestId;
        commitQueue(songs, boundedIndex);
        currentSongRef.current = song;
        setCurrentSong(song);
        setLyrics(null);
        setError(null);
        setIsLyricsLoading(false);
        reset();
        void Promise.all([
            saveToCache('last_song', song),
            saveToCache('last_queue', songs),
        ]).catch(() => undefined);

        void (async () => {
            try {
                const resolved = await loadTvSongAudio(song, audioQuality, isCurrent);
                if (!isCurrent()) return;
                currentSongRef.current = resolved.song;
                setCurrentSong(resolved.song);
                retireBlobUrl(resolved.audioSrc);
                loadSource(resolved.audioSrc, true);

                await loadTvSongLyrics({
                    song: resolved.song,
                    localSong: resolved.localSong,
                    userId,
                    isCurrent,
                    onLyrics: nextLyrics => {
                        if (isCurrent()) setLyrics(nextLyrics);
                    },
                    onLoadingChange: loading => {
                        if (isCurrent()) setIsLyricsLoading(loading);
                    },
                });
            } catch (loadError) {
                if (!isCurrent() || (loadError instanceof DOMException && loadError.name === 'AbortError')) return;
                const reason = loadError instanceof TvPlaybackSourceError
                    ? loadError.reason
                    : loadError instanceof Error
                        ? loadError.message
                        : 'unknown';
                setError(reason);
                setIsLyricsLoading(false);
                fail();
            }
        })();
    }, [audioQuality, commitQueue, fail, loadSource, reset, userId]);

    const resumeCurrent = useCallback(() => {
        if (!currentSongRef.current) return;
        if (hasSource && queueRef.current.length > 0) {
            void resume();
            return;
        }
        playQueue(queueRef.current, indexRef.current);
    }, [hasSource, playQueue, resume]);

    const togglePlayback = useCallback(() => {
        if (transport.status === 'playing') {
            pause();
            return;
        }
        if (transport.status === 'paused' && hasSource) {
            void resume();
            return;
        }
        resumeCurrent();
    }, [hasSource, pause, resume, resumeCurrent, transport.status]);

    const next = useCallback(() => {
        const songs = queueRef.current;
        if (songs.length === 0) return;
        const nextIndex = (indexRef.current + 1) % songs.length;
        playQueue(songs, nextIndex);
    }, [playQueue]);

    const previous = useCallback(() => {
        const position = transport.currentTime.get();
        if (position > 3) {
            seekTransport(-position);
            return;
        }
        const songs = queueRef.current;
        if (songs.length === 0) return;
        const previousIndex = (indexRef.current - 1 + songs.length) % songs.length;
        playQueue(songs, previousIndex);
    }, [playQueue, seekTransport, transport.currentTime]);

    const skipPrevious = useCallback(() => {
        const songs = queueRef.current;
        if (songs.length === 0) return;
        const previousIndex = (indexRef.current - 1 + songs.length) % songs.length;
        playQueue(songs, previousIndex);
    }, [playQueue]);

    const seekBy = useCallback((deltaSeconds: number) => {
        seekTransport(deltaSeconds);
    }, [seekTransport]);

    const setVisualizerMode = useCallback((mode: VisualizerMode) => {
        if (!isBuiltinVisualizerMode(mode)) return;
        setVisualizerModeState(mode);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(TV_VISUALIZER_MODE_STORAGE_KEY, mode);
        }
    }, []);

    const setBackgroundMode = useCallback((mode: VisualizerBackgroundMode) => {
        if (!isBuiltinVisualizerBackgroundMode(mode)) return;
        setBackgroundModeState(mode);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(TV_BACKGROUND_MODE_STORAGE_KEY, mode);
        }
    }, []);

    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        void Promise.all([
            getFromCache<SongResult>('last_song'),
            getFromCache<SongResult[]>('last_queue'),
        ]).then(([lastSong, lastQueue]) => {
            if (
                !mountedRef.current
                || !lastSong
                || currentSongRef.current
                || queueRef.current.length > 0
            ) return;
            const restoredQueue = Array.isArray(lastQueue) && lastQueue.length > 0 ? lastQueue : [lastSong];
            const restoredIndex = Math.max(0, restoredQueue.findIndex(song => (
                isLocalPlaybackSong(song) && isLocalPlaybackSong(lastSong)
                    ? song.localRef?.songId === lastSong.localRef?.songId
                    : song.id === lastSong.id
            )));
            commitQueue(restoredQueue, restoredIndex);
            currentSongRef.current = lastSong;
            setCurrentSong(lastSong);
        }).catch(() => undefined);
    }, [commitQueue]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestIdRef.current += 1;
            pause();
        };
    }, [pause]);

    return {
        currentSong,
        currentIndex,
        queue,
        lyrics,
        status: transport.status,
        error,
        duration: transport.duration,
        isLyricsLoading,
        visualizerMode,
        backgroundMode,
        playQueue,
        togglePlayback,
        resumeCurrent,
        pause,
        next,
        previous,
        skipPrevious,
        seekBy,
        setVisualizerMode,
        setBackgroundMode,
    };
};

