// src/tv/components/TvLyricStage.tsx

import { motion, useMotionValueEvent, type MotionValue } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricData, SongResult } from '../../types';
import { buildWordGraphemeTimings } from '../../utils/lyrics/graphemeTiming';
import { findTvActiveLineIndex } from '../model/tvLyricTimeline';
import type { TvPlaybackStatus } from '../model/tvTypes';
import { TvLyricToken } from './TvLyricToken';

const useTvActiveLine = (lyrics: LyricData | null, currentTime: MotionValue<number>) => {
    const [activeIndex, setActiveIndex] = useState(-1);
    const activeIndexRef = useRef(-1);

    useMotionValueEvent(currentTime, 'change', time => {
        if (!lyrics) return;
        const nextIndex = findTvActiveLineIndex(lyrics.lines, time);
        if (nextIndex === activeIndexRef.current) return;
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
    });

    useEffect(() => {
        const nextIndex = lyrics ? findTvActiveLineIndex(lyrics.lines, currentTime.get()) : -1;
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
    }, [currentTime, lyrics]);

    return activeIndex;
};

const TvLineTokens = ({
    line,
    currentTime,
}: {
    line: NonNullable<LyricData['lines'][number]>;
    currentTime: MotionValue<number>;
}) => {
    const tokens = useMemo(() => {
        const wordTokens = line.words.flatMap((word, wordIndex) => (
            buildWordGraphemeTimings(word, wordIndex).map((timing, index) => ({
                ...timing,
                key: `${wordIndex}-${index}-${timing.char}`,
            }))
        ));
        if (wordTokens.length > 0 || !line.fullText) return wordTokens;

        const characters = Array.from(line.fullText);
        const span = Math.max(0.001, line.endTime - line.startTime);
        return characters.map((char, index) => ({
            char,
            key: `fallback-${index}-${char}`,
            startTime: line.startTime + (span * index) / characters.length,
            endTime: line.startTime + (span * (index + 1)) / characters.length,
        }));
    }, [line]);

    return (
        <span className="tv-lyric-tokens" aria-label={line.fullText}>
            {tokens.length > 0 ? tokens.map(token => (
                    <TvLyricToken
                        key={token.key}
                        char={token.char}
                        startTime={token.startTime}
                        endTime={token.endTime}
                        currentTime={currentTime}
                    />
                )) : line.fullText}
        </span>
    );
};

export const TvLyricStage = ({
    song,
    lyrics,
    status,
    isLyricsLoading,
    currentTime,
}: {
    song: SongResult | null;
    lyrics: LyricData | null;
    status: TvPlaybackStatus;
    isLyricsLoading: boolean;
    currentTime: MotionValue<number>;
}) => {
    const { t } = useTranslation();
    const activeIndex = useTvActiveLine(lyrics, currentTime);
    const activeLine = activeIndex >= 0 ? lyrics?.lines[activeIndex] ?? null : null;
    const emptyTitle = !song
        ? t('tv.player.noSong')
        : status === 'error'
            ? t('tv.player.playbackFailed')
            : isLyricsLoading
                ? t('tv.player.lyricsLoading')
                : t('tv.player.noLyrics');

    return (
        <section className={`tv-lyric-stage${activeLine?.isChorus ? ' is-chorus' : ''}`}>
            <div className="tv-lyric-focus">
                {activeLine ? (
                    <motion.div
                        key={activeLine.startTime}
                        className="tv-lyric-line"
                        initial={{ opacity: 0, y: 34, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.38, ease: [0.2, 0.75, 0.25, 1] }}
                    >
                        <TvLineTokens line={activeLine} currentTime={currentTime} />
                        {activeLine.translation && (
                            <p className="tv-lyric-translation">{activeLine.translation}</p>
                        )}
                    </motion.div>
                ) : (
                    <div className="tv-lyric-empty">
                        <span className="tv-lyric-empty-mark" aria-hidden="true">♪</span>
                        <strong>{emptyTitle}</strong>
                    </div>
                )}
            </div>
            {activeLine?.isChorus && <span className="tv-chorus-sweep" aria-hidden="true" />}
        </section>
    );
};

