import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { TvVisualizerStage } from '../../src/tv/components/TvVisualizerStage';
import { findTvActiveLineIndex } from '../../src/tv/model/tvLyricTimeline';
import { resolveTvVisualTheme } from '../../src/tv/model/tvVisualTheme';
import type { Line, LyricData, SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/tvLyrics.probe.tsx

const FullClassicRenderer = React.lazy(() => import('../../src/components/visualizer/classic/Visualizer'));
const TV_THEME = resolveTvVisualTheme(false);
const INITIAL_CLOCK_SECONDS = 1;
const LINE_DURATION_SECONDS = 4;
const TV_STAGE_WIDTH = 1280;
const TV_STAGE_HEIGHT = 720;
const WORD_OFFSETS = [[0, 0.6], [0.7, 1.6], [1.8, 2.7], [2.8, 3.9]] as const;

/** Builds deterministic word timing for one bilingual lyric line. */
const buildLine = (
    id: string,
    startTime: number,
    texts: readonly [string, string, string, string],
    translation: string,
): Line => ({
    id,
    startTime,
    endTime: startTime + LINE_DURATION_SECONDS,
    fullText: texts.join(''),
    translation,
    wordSegments: [...texts],
    words: texts.map((text, index) => ({
        text,
        startTime: startTime + WORD_OFFSETS[index]![0],
        endTime: startTime + WORD_OFFSETS[index]![1],
    })),
});

const LYRICS: LyricData = {
    title: 'TV Lyrics Probe',
    artist: 'Folia',
    isWordByWord: true,
    lines: [
        buildLine('line-1', 0, ['星光', 'falling', '落在', 'night'], 'Starlight falling into the night'),
        buildLine('line-2', 4, ['我们', 'rise', '迎着', 'light'], 'We rise to meet the light'),
        buildLine('line-3', 8, ['直到', 'every', '心跳', 'glows'], 'Until every heartbeat glows'),
    ],
};

const SONG: SongResult = {
    id: 'tv-lyrics-probe',
    name: 'TV Lyrics Probe',
    artists: [{ id: 'probe-artist', name: 'Folia' }],
    album: { id: 'probe-album', name: 'Component Probe' },
    durationMs: LYRICS.lines.at(-1)!.endTime * 1000,
    sourceRef: { kind: 'stage', mediaId: 'tv-lyrics-probe' },
};

const LAST_LINE_END = LYRICS.lines.at(-1)!.endTime;
const formatClock = (value: number) => value.toFixed(3) + 's';
const buttonStyle: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,.2)',
    borderRadius: 8,
    background: 'rgba(255,255,255,.08)',
    color: '#f7f5ff',
    cursor: 'pointer',
    font: 'inherit',
    padding: '8px 12px',
};

const TvLyricsProbe: React.FC<{ mode?: 'classic' | 'partita' }> = ({ mode = 'classic' }) => {
    const currentTime = useMotionValue(INITIAL_CLOCK_SECONDS);
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const audioBands = useMemo(() => ({ bass, lowMid, mid, vocal, treble }), [bass, lowMid, mid, vocal, treble]);

    const initialLineIndex = Math.max(0, findTvActiveLineIndex(LYRICS.lines, INITIAL_CLOCK_SECONDS));
    const [lineIndex, setLineIndex] = useState(initialLineIndex);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showReference, setShowReference] = useState(false);
    const lineIndexRef = useRef(initialLineIndex);
    const clockOutputRef = useRef<HTMLOutputElement | null>(null);

    // Continuous clock changes bypass React; only line crossings update discrete state.
    useEffect(() => {
        const syncClockOutput = (value: number) => {
            if (!clockOutputRef.current) return;
            clockOutputRef.current.textContent = formatClock(value);
            clockOutputRef.current.dataset.probeClockValue = String(value);
        };
        syncClockOutput(currentTime.get());
        return currentTime.on('change', syncClockOutput);
    }, [currentTime]);

    useEffect(() => {
        if (!isPlaying) return undefined;
        let frameId = 0;
        let previousTimestamp = performance.now();

        const advanceClock = (timestamp: number) => {
            const elapsedSeconds = Math.max(0, timestamp - previousTimestamp) / 1000;
            previousTimestamp = timestamp;
            const nextTime = Math.min(LAST_LINE_END, currentTime.get() + elapsedSeconds);
            currentTime.set(nextTime);

            const nextLineIndex = Math.max(0, findTvActiveLineIndex(LYRICS.lines, nextTime));
            if (nextLineIndex !== lineIndexRef.current) {
                lineIndexRef.current = nextLineIndex;
                setLineIndex(nextLineIndex);
            }
            if (nextTime >= LAST_LINE_END) {
                setIsPlaying(false);
                return;
            }
            frameId = requestAnimationFrame(advanceClock);
        };

        frameId = requestAnimationFrame(advanceClock);
        return () => cancelAnimationFrame(frameId);
    }, [currentTime, isPlaying]);

    const moveToLine = useCallback((requestedIndex: number) => {
        const nextIndex = Math.min(LYRICS.lines.length - 1, Math.max(0, requestedIndex));
        currentTime.set(LYRICS.lines[nextIndex]!.startTime);
        if (lineIndexRef.current !== nextIndex) {
            lineIndexRef.current = nextIndex;
            setLineIndex(nextIndex);
        }
    }, [currentTime]);

    const seekCurrentLineMiddle = () => {
        const currentLine = LYRICS.lines[lineIndexRef.current] ?? LYRICS.lines[0]!;
        currentTime.set((currentLine.startTime + currentLine.endTime) / 2);
    };

    const togglePlayback = () => {
        if (!isPlaying && currentTime.get() >= LAST_LINE_END) moveToLine(0);
        setIsPlaying(value => !value);
    };

    return (
        <main
            translate="no"
            data-probe-tv-lyrics
            data-probe-paused={String(!isPlaying)}
            data-probe-current-line={lineIndex}
            style={{ background: '#11111a', color: TV_THEME.primaryColor, minHeight: '100vh', padding: 16 }}
        >
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <button type="button" data-probe-action="toggle-play" style={buttonStyle} onClick={togglePlayback}>
                    {isPlaying ? 'Pause lyrics clock' : 'Play lyrics clock'}
                </button>
                <button type="button" data-probe-action="seek-line-mid" style={buttonStyle} onClick={seekCurrentLineMiddle}>
                    Seek current line middle
                </button>
                <button type="button" data-probe-action="next-line" style={buttonStyle} onClick={() => moveToLine(lineIndexRef.current + 1)}>
                    Next line
                </button>
                <button type="button" data-probe-action="previous-line" style={buttonStyle} onClick={() => moveToLine(lineIndexRef.current - 1)}>
                    Previous line
                </button>
                <button
                    type="button"
                    aria-pressed={showReference}
                    data-probe-action="toggle-reference"
                    style={buttonStyle}
                    onClick={() => setShowReference(value => !value)}
                >
                    {showReference ? 'Hide full reference' : 'Show full reference'}
                </button>
                <output ref={clockOutputRef} aria-label="Lyrics MotionValue clock" data-probe-clock>
                    {formatClock(INITIAL_CLOCK_SECONDS)}
                </output>
                <span data-probe-line-name>{LYRICS.lines[lineIndex]?.fullText}</span>
            </div>

            <section
                data-probe-path="tv"
                data-probe-theme={TV_THEME.name}
                data-probe-time-source="shared-motion-value"
                style={{
                    background: TV_THEME.backgroundColor,
                    display: 'grid',
                    height: TV_STAGE_HEIGHT,
                    overflow: 'hidden',
                    width: TV_STAGE_WIDTH,
                }}
            >
                <TvVisualizerStage
                    song={SONG}
                    lyrics={LYRICS}
                    currentTime={currentTime}
                    status={isPlaying ? 'playing' : 'paused'}
                    visualizerMode={mode}
                    theme={TV_THEME}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    constrained={false}
                />
            </section>

            {showReference && (
                <section
                    data-probe-path="reference"
                    data-probe-theme={TV_THEME.name}
                    data-probe-time-source="shared-motion-value"
                    style={{
                        background: TV_THEME.backgroundColor,
                        display: 'grid',
                        height: TV_STAGE_HEIGHT,
                        marginTop: 16,
                        overflow: 'hidden',
                        width: TV_STAGE_WIDTH,
                    }}
                >
                    <div className="tv-visualizer-stage" data-probe-reference-projection>
                        <div className="tv-visualizer-stage__renderer">
                            <Suspense fallback={<span data-probe-reference-loading>Loading full reference...</span>}>
                                <FullClassicRenderer
                                    currentTime={currentTime}
                                    currentLineIndex={lineIndex}
                                    lines={LYRICS.lines}
                                    theme={TV_THEME}
                                    subtitleTheme={TV_THEME}
                                    audioPower={audioPower}
                                    audioBands={audioBands}
                                    showText
                                    reducedEffects={false}
                                    songTitle={SONG.name}
                                    songArtist="Folia"
                                    songAlbum={SONG.album.name}
                                    coverUrl={null}
                                    seed={SONG.id}
                                    background={{ transparent: true }}
                                    lyricsFontScale={1}
                                    subtitleFontScale={0.92}
                                    isPreviewMode
                                    paused={!isPlaying}
                                    hideTranslationSubtitle
                                    showHarmonySubtitle={false}
                                />
                            </Suspense>
                        </div>
                    </div>
                </section>
            )}
        </main>
    );
};

const definition: ProbeDefinition = {
    id: 'tvLyrics',
    title: 'TV Lyrics · Classic reduced effects',
    description: '1280x720 TV Classic path with paused seek controls and an optional full-effect reference stage.',
    Component: TvLyricsProbe,
};

export default definition;
