// src/tv/components/TvControlDock.tsx

import { motion, useMotionValueEvent, useTransform } from 'framer-motion';
import {
    ListMusic,
    Pause,
    Play,
    SkipBack,
    SkipForward,
    Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef } from 'react';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { formatTvTime } from '../model/tvLyricFill';
import type { TvPlayerModel } from '../model/tvTypes';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

export const TvControlDock = ({
    player,
    constrained,
    onOpenQueue,
    onOpenEffects,
}: {
    player: TvPlayerModel;
    constrained: boolean;
    onOpenQueue: () => void;
    onOpenEffects: () => void;
}) => {
    const { t } = useTranslation();
    const song = player.currentSong;
    const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.row);
    const positionLabelRef = useRef<HTMLSpanElement>(null);
    const remainingLabelRef = useRef<HTMLSpanElement>(null);
    const lastClockBucketRef = useRef(Number.NaN);
    const clockStepSeconds = constrained ? 10 : 1;
    const progress = useTransform(player.currentTime, time => (
        player.duration > 0 ? Math.max(0, Math.min(1, time / player.duration)) : 0
    ));
    const writeClock = useCallback((time: number) => {
        const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
        const bucket = Math.floor(safeTime / clockStepSeconds);
        if (bucket === lastClockBucketRef.current) return;
        lastClockBucketRef.current = bucket;
        if (positionLabelRef.current) {
            positionLabelRef.current.textContent = formatTvTime(safeTime);
        }
        if (remainingLabelRef.current) {
            remainingLabelRef.current.textContent = `-${formatTvTime(Math.max(0, player.duration - safeTime))}`;
        }
    }, [clockStepSeconds, player.duration]);

    useMotionValueEvent(player.currentTime, 'change', writeClock);
    useEffect(() => {
        lastClockBucketRef.current = Number.NaN;
        writeClock(player.currentTime.get());
    }, [player.currentTime, writeClock]);

    return (
        <section id="tv-layer-controls" data-tv-layer="controls" className="tv-control-dock">
            <div className="tv-control-progress">
                <span ref={positionLabelRef}>{formatTvTime(player.currentTime.get())}</span>
                <div className="tv-control-track">
                    <motion.i style={{ scaleX: progress }} />
                </div>
                <span ref={remainingLabelRef}>
                    -{formatTvTime(Math.max(0, player.duration - player.currentTime.get()))}
                </span>
            </div>
            <div className="tv-control-main">
                <div className="tv-control-song">
                    {coverUrl && <img src={coverUrl} alt="" loading="eager" decoding="async" />}
                    <span>
                        <strong>{song?.name || t('tv.player.noSong')}</strong>
                        <small>{song ? getSongArtistLabel(song) : t('tv.home.chooseSong')}</small>
                    </span>
                </div>
                <div
                    className="tv-control-buttons"
                    data-tv-focus-group="controls-actions"
                    data-tv-focus-axis="horizontal"
                >
                    <span className="tv-control-transport">
                        <button
                            type="button"
                            data-tv-focusable="true"
                            data-tv-focus-key="controls-prev"
                            onClick={player.previous}
                            aria-label={t('tv.player.previous')}
                        >
                            <SkipBack size={24} fill="currentColor" />
                        </button>
                        <button
                            type="button"
                            className="is-primary"
                            data-tv-focusable="true"
                            data-tv-focus-key="controls-play"
                            onClick={player.togglePlayback}
                            aria-label={player.status === 'playing' ? t('tv.player.pause') : t('tv.player.play')}
                        >
                            {player.status === 'playing'
                                ? <Pause size={28} fill="currentColor" />
                                : <Play size={28} fill="currentColor" />}
                        </button>
                        <button
                            type="button"
                            data-tv-focusable="true"
                            data-tv-focus-key="controls-next"
                            onClick={player.next}
                            aria-label={t('tv.player.next')}
                        >
                            <SkipForward size={24} fill="currentColor" />
                        </button>
                    </span>
                    <span className="tv-control-utilities">
                        <button
                            type="button"
                            className="is-utility"
                            data-tv-focusable="true"
                            data-tv-focus-key="controls-queue"
                            onClick={onOpenQueue}
                            aria-label={t('tv.player.queue')}
                        >
                            <ListMusic size={21} />
                        </button>
                        <button
                            type="button"
                            className="is-utility"
                            data-tv-focusable="true"
                            data-tv-focus-key="controls-effects"
                            onClick={onOpenEffects}
                            aria-label={t('tv.effects.open')}
                        >
                            <Sparkles size={21} />
                        </button>
                    </span>
                </div>
            </div>
        </section>
    );
};

