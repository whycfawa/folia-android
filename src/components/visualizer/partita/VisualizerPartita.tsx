import React, { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PARTITA_TUNING, Line } from '../../../types';
import { useElementSize } from '../../../hooks/useElementWidth';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { shouldPreheatLine, useVisualizerRuntime } from '../runtime';
import { type VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { buildGlowWordLayoutVariants, glowWordBodyVariants } from '../glowWordVariants';
import { getGlowWordLineContainerMotion, resolveGlowWordRenderProfile } from '../glowWordTiming';
import {
    EMPTY_PARTITA_LAYOUT,
    PARTITA_PREHEAT_WINDOW,
    type PartitaSequentialLayout,
    getOrBuildPartitaLayout,
    resolvePartitaTuning,
} from './partitaLayout';
import { PartitaChunk } from './PartitaChunk';

// This one is still word-driven, but unlike Classic it needs to pre-build a column/chunk structure first.
// The flow is basically: ask runtime for the active line, optionally preheat the upcoming line,
// split the active line into chunks, place those chunks into columns, then let the words animate inside that structure.
// The important bit is that the layout should feel stable while the words are moving through it.
//
// For a single lyric line, the state handling is:
// waiting -> layout is already there, but the words stay in a light "not entered yet" state.
// active -> this is where the stagger, highlight, and line energy actually happen.
// passed -> words fall back into a softer exit state, and the chunk keeps a little bit of structure for the afterimage.

type VisualizerPartitaProps = VisualizerSharedProps;

const VisualizerPartita: React.FC<VisualizerPartitaProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        audioPower,
        audioBands,
        showText = true,
        partitaTuning = DEFAULT_PARTITA_TUNING,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
        subtitleContentMode,
    } = props;
    const { t } = useTranslation();
    const resolvedPartitaTuning = useMemo(() => resolvePartitaTuning(partitaTuning), [partitaTuning]);
    const layoutCacheRef = useRef<Map<string, PartitaSequentialLayout>>(new Map());
    const stageContentRef = useRef<HTMLDivElement | null>(null);
    const stageSize = useElementSize(stageContentRef);
    const [isProjectionStage, setIsProjectionStage] = useState(false);

    useEffect(() => {
        setIsProjectionStage(Boolean(stageContentRef.current?.closest('.tv-visualizer-stage')));
    }, []);

    const windowHeight = isProjectionStage && stageSize.height > 0
        ? stageSize.height
        : (typeof window === 'undefined' ? 800 : window.innerHeight);
    const measuredWidth = isProjectionStage && stageSize.width > 0 ? stageSize.width : 0;
    const projectionFontPx = isProjectionStage
        ? Math.max(24, Math.min(46, measuredWidth * 0.056, windowHeight * 0.105))
        : null;

    const {
        activeLine,
        upcomingLine,
        recentCompletedLine,
        nextLines,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const activeLineRenderProfile = activeLine ? resolveGlowWordRenderProfile(activeLine) : null;
    const activeLineContainerMotion = getGlowWordLineContainerMotion(activeLineRenderProfile, props.reducedEffects);

    const sequentialLayout = useMemo(() => {
        if (!activeLine) {
            return EMPTY_PARTITA_LAYOUT;
        }

        return getOrBuildPartitaLayout(
            layoutCacheRef.current,
            activeLine,
            theme,
            windowHeight,
            resolvedPartitaTuning,
            measuredWidth,
        );
    }, [activeLine, measuredWidth, theme, windowHeight, resolvedPartitaTuning]);

    const nextLineRef = useRef<Line | null>(upcomingLine);
    useEffect(() => {
        nextLineRef.current = upcomingLine;
    }, [upcomingLine]);

    useMotionValueEvent(currentTime, 'change', (latest: number) => {
        const nextLine = nextLineRef.current;
        if (!nextLine) {
            return;
        }

        if (!shouldPreheatLine(nextLine, latest, PARTITA_PREHEAT_WINDOW)) {
            return;
        }

        getOrBuildPartitaLayout(
            layoutCacheRef.current,
            nextLine,
            theme,
            windowHeight,
            resolvedPartitaTuning,
            measuredWidth,
        );
    });

    const densityScale = sequentialLayout.totalGraphemes > 40 ? 0.8 : 1;
    const mainFontSize = projectionFontPx
        ? `${(projectionFontPx * densityScale).toFixed(2)}px`
        : `clamp(${(2.5 * densityScale * lyricsFontScale).toFixed(3)}rem, ${(5.5 * densityScale * lyricsFontScale).toFixed(3)}vw, ${(4.5 * densityScale * lyricsFontScale).toFixed(3)}rem)`;
    const emptyFontSize = `clamp(${(1.2 * lyricsFontScale).toFixed(3)}rem, ${(2.8 * lyricsFontScale).toFixed(3)}vw, ${(1.9 * lyricsFontScale).toFixed(3)}rem)`;
    const translationFontSize = `clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.8 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;

    const layoutVariants = buildGlowWordLayoutVariants(theme.animationIntensity);
    const bodyVariants = glowWordBodyVariants;

    const lyricContainerFloat = useMemo(() => {
        const configByIntensity = {
            calm: { distance: 10, duration: 8.5 },
            normal: { distance: 14, duration: 7 },
            chaotic: { distance: 18, duration: 5.8 },
        } as const;

        const { distance, duration } = configByIntensity[theme.animationIntensity];

        return {
            animate: {
                y: [0, -distance, 0, distance * 0.45, 0],
                scale: [1, 1.01, 1, 0.995, 1],
            },
            transition: {
                duration,
                repeat: Infinity,
                ease: 'easeInOut' as const,
            },
        };
    }, [theme.animationIntensity]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <motion.div
                ref={stageContentRef}
                className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none will-change-transform"
                animate={props.reducedEffects ? undefined : lyricContainerFloat.animate}
                transition={props.reducedEffects ? undefined : lyricContainerFloat.transition}
                style={{
                    '--tv-visualizer-primary-font-size': mainFontSize,
                } as React.CSSProperties}
            >
                <AnimatePresence mode="popLayout">
                    {showText && activeLine && activeLineRenderProfile && (
                        <motion.div
                            key={activeLine.startTime}
                            initial={activeLineContainerMotion.initial}
                            animate={activeLineContainerMotion.animate}
                            exit={activeLineContainerMotion.exit}
                            className="flex flex-row-reverse items-stretch justify-center w-full max-w-5xl"
                            style={{
                                perspective: `${sequentialLayout.lineConfig.perspective}px`,
                                gap: sequentialLayout.lineConfig.columnGap,
                                minHeight: '320px',
                            }}
                        >
                            {sequentialLayout.columns.map((column) => {
                                return (
                                    <div
                                        key={column.id}
                                        className="relative flex min-h-[24rem] min-w-[3.8rem] items-center justify-center px-3"
                                    >
                                        <div className="relative z-10 flex flex-col items-center justify-start">
                                            {column.words.map(({ chunkWords, displayWords, config, order, rowIndex }) => (
                                                <PartitaChunk
                                                    key={`${config.id}`}
                                                    chunkWords={chunkWords}
                                                    displayWords={displayWords}
                                                    config={config}
                                                    guideIndex={rowIndex}
                                                    currentTime={currentTime}
                                                    theme={theme}
                                                    layoutVariants={layoutVariants}
                                                    bodyVariants={bodyVariants}
                                                    reducedEffects={props.reducedEffects}
                                                    baseColor={theme.primaryColor}
                                                    renderProfile={activeLineRenderProfile}
                                                    isChorus={activeLine.isChorus}
                                                    showGuideLines={resolvedPartitaTuning.showGuideLines}
                                                    fontSize={mainFontSize}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </motion.div>
                    )}

                    {showText && !activeLine && (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-2xl opacity-50 absolute"
                            style={{
                                color: theme.secondaryColor,
                                fontSize: emptyFontSize,
                            }}
                        >
                            {t('ui.waitingForMusic')}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={subtitleTheme}
                translationFontSize={translationFontSize}
                upcomingFontSize={upcomingFontSize}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                subtitleFontScale={subtitleFontScale}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerPartita;
