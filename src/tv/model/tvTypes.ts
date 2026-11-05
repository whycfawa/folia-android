// src/tv/model/tvTypes.ts

import type { MotionValue } from 'framer-motion';
import type { RefObject } from 'react';
import type { LyricData, SongResult } from '../../types';

export type TvPage = 'home' | 'player';

export type TvOverlay = 'controls' | 'queue' | 'collection' | 'login' | 'exit';

export type TvEffectsMode = 'flow' | 'calm';

export type TvPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type TvPlayerModel = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    currentIndex: number;
    queue: SongResult[];
    lyrics: LyricData | null;
    status: TvPlaybackStatus;
    error: string | null;
    currentTime: MotionValue<number>;
    positionRevision: number;
    duration: number;
    effectsMode: TvEffectsMode;
    isLyricsLoading: boolean;
    playQueue: (songs: SongResult[], startIndex?: number) => void;
    togglePlayback: () => void;
    resumeCurrent: () => void;
    pause: () => void;
    next: () => void;
    previous: () => void;
    seekBy: (deltaSeconds: number) => void;
    setEffectsMode: (mode: TvEffectsMode) => void;
    toggleEffectsMode: () => void;
};

