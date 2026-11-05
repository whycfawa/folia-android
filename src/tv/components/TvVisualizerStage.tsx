import { motionValue, useMotionValueEvent, type MotionValue } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import VisualizerRenderer from '../../components/visualizer/VisualizerRenderer';
import { getSongAlbumLabel, getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { AudioBands, LyricData, SongResult, Theme } from '../../types';
import { findTvActiveLineIndex } from '../model/tvLyricTimeline';
import type { TvEffectsMode, TvPlaybackStatus } from '../model/tvTypes';
import { resolveTvSongCoverUrl } from '../services/tvPlaybackSource';
import '../styles/tv-visualizer.css';

// src/tv/components/TvVisualizerStage.tsx
// TV owns the timing and transport, while the shared Classic renderer owns the lyric motion itself.

const TV_AUDIO_POWER = motionValue(0);
const TV_BASS = motionValue(0);
const TV_LOW_MID = motionValue(0);
const TV_MID = motionValue(0);
const TV_VOCAL = motionValue(0);
const TV_TREBLE = motionValue(0);

// The TV deck has no Web Audio analyser. Stable zero-valued signals avoid a second media graph
// (which is unsafe for remote audio without CORS) while Classic's time-driven word motion stays intact.
const TV_AUDIO_BANDS: AudioBands = {
    bass: TV_BASS,
    lowMid: TV_LOW_MID,
    mid: TV_MID,
    vocal: TV_VOCAL,
    treble: TV_TREBLE,
};

const TV_DARK_THEME: Theme = {
    name: 'Folia TV Midnight',
    backgroundColor: '#07070c',
    primaryColor: '#f7f5ff',
    accentColor: '#a78bfa',
    secondaryColor: '#b8b0d0',
    fontStyle: 'sans',
    fontWeight: 650,
    animationIntensity: 'normal',
};

const TV_CALM_THEME: Theme = {
    ...TV_DARK_THEME,
    name: 'Folia TV Calm',
    animationIntensity: 'calm',
};

/**
 * Mirrors TV's already-resolved lyric clock into a discrete line index. The 30fps MotionValue only
 * reaches React when the line changes, never as a per-frame state update.
 */
const useTvActiveLyricLine = (
    lyrics: LyricData | null,
    currentTime: MotionValue<number>,
): number => {
    const [activeIndex, setActiveIndex] = useState(-1);
    const activeIndexRef = useRef(-1);

    useMotionValueEvent(currentTime, 'change', time => {
        const nextIndex = lyrics ? findTvActiveLineIndex(lyrics.lines, time) : -1;
        if (nextIndex === activeIndexRef.current) return;
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
    });

    useEffect(() => {
        const nextIndex = lyrics ? findTvActiveLineIndex(lyrics.lines, currentTime.get()) : -1;
        if (nextIndex === activeIndexRef.current) return;
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
    }, [currentTime, lyrics]);

    return activeIndex;
};

export const TvVisualizerStage = ({
    song,
    lyrics,
    currentTime,
    status,
    effectsMode,
    constrained,
}: {
    song: SongResult;
    lyrics: LyricData;
    currentTime: MotionValue<number>;
    status: TvPlaybackStatus;
    effectsMode: TvEffectsMode;
    constrained: boolean;
}) => {
    const currentLineIndex = useTvActiveLyricLine(lyrics, currentTime);
    const theme = effectsMode === 'calm' ? TV_CALM_THEME : TV_DARK_THEME;
    const classicTuning = useMemo(() => ({
        enableWordRotation: true,
        breathingFloatMultiplier: constrained ? 0.35 : 1,
        useLegacyLayout: false,
        wordSpacing: 0.7,
    }), [constrained]);
    const artist = getSongArtistLabel(song);
    const album = getSongAlbumLabel(song);
    const coverUrl = resolveTvSongCoverUrl(song);
    const activeLine = currentLineIndex >= 0 ? lyrics.lines[currentLineIndex] ?? null : null;
    const nextLine = lyrics.lines[currentLineIndex + 1] ?? null;
    const secondaryText = activeLine?.translation || nextLine?.fullText || '';

    return (
        <section
            className={`tv-visualizer-stage${constrained ? ' is-constrained' : ''}`}
            data-tv-visualizer="classic"
        >
            <div className="tv-visualizer-stage__renderer">
                <VisualizerRenderer
                    mode="classic"
                    currentTime={currentTime}
                    currentLineIndex={currentLineIndex}
                    lines={lyrics.lines}
                    theme={theme}
                    audioPower={TV_AUDIO_POWER}
                    audioBands={TV_AUDIO_BANDS}
                    showText
                    songTitle={song.name}
                    songArtist={artist}
                    songAlbum={album}
                    coverUrl={coverUrl}
                    seed={song.id}
                    background={{ transparent: true }}
                    isPreviewMode
                    paused={status !== 'playing'}
                    hideTranslationSubtitle
                    showHarmonySubtitle={false}
                    classicTuning={classicTuning}
                />
            </div>
            {secondaryText && (
                <p
                    className={`tv-visualizer-copy${activeLine?.translation ? ' is-translation' : ''}`}
                    aria-live="polite"
                >
                    {secondaryText}
                </p>
            )}
        </section>
    );
};
