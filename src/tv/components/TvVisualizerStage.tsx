import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import VisualizerRenderer from '../../components/visualizer/VisualizerRenderer';
import { getSongAlbumLabel, getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type {
    AudioBands,
    LyricData,
    SongResult,
    Theme,
    VisualizerMode,
} from '../../types';
import { findTvActiveLineIndex } from '../model/tvLyricTimeline';
import type { TvPlaybackStatus } from '../model/tvTypes';
import { resolveTvSongCoverUrl } from '../services/tvPlaybackSource';
import '../styles/tv-visualizer.css';

// src/tv/components/TvVisualizerStage.tsx
// TV owns the lyric clock; the shared registry renderer owns every mode-specific animation.

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

export const TvVisualizerStage = memo(({
    song,
    lyrics,
    currentTime,
    status,
    visualizerMode,
    theme,
    audioPower,
    audioBands,
    constrained,
}: {
    song: SongResult;
    lyrics: LyricData;
    currentTime: MotionValue<number>;
    status: TvPlaybackStatus;
    visualizerMode: VisualizerMode;
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    constrained: boolean;
}) => {
    const currentLineIndex = useTvActiveLyricLine(lyrics, currentTime);
    const artist = getSongArtistLabel(song);
    const album = getSongAlbumLabel(song);
    const coverUrl = resolveTvSongCoverUrl(song);

    return (
        <section
            className={`tv-visualizer-stage${constrained ? ' is-constrained' : ''}`}
            data-tv-visualizer={visualizerMode}
        >
            <div className="tv-visualizer-stage__renderer">
                <VisualizerRenderer
                    key={`${song.id}:${visualizerMode}`}
                    mode={visualizerMode}
                    currentTime={currentTime}
                    currentLineIndex={currentLineIndex}
                    lines={lyrics.lines}
                    theme={theme}
                    subtitleTheme={theme}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    showText
                    reducedEffects
                    songTitle={song.name}
                    songArtist={artist}
                    songAlbum={album}
                    coverUrl={coverUrl}
                    seed={song.id}
                    background={{ transparent: true }}
                    lyricsFontScale={
                        visualizerMode === 'cappella'
                            ? (constrained ? 1.1 : 1.35)
                            : (constrained ? 0.9 : 1)
                    }
                    subtitleFontScale={0.92}
                    isPreviewMode
                    paused={status !== 'playing'}
                    hideTranslationSubtitle
                    showHarmonySubtitle={false}
                />
            </div>
        </section>
    );
});
