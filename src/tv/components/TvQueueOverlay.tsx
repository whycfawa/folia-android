// src/tv/components/TvQueueOverlay.tsx

import { ListMusic, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { resolveTvSongCoverUrl } from '../services/tvPlaybackSource';

export const TvQueueOverlay = ({
    queue,
    currentIndex,
    onPlay,
    onClose,
}: {
    queue: SongResult[];
    currentIndex: number;
    onPlay: (index: number) => void;
    onClose: () => void;
}) => {
    const { t } = useTranslation();

    return (
        <section id="tv-layer-queue" data-tv-layer="queue" className="tv-overlay tv-queue-overlay">
            <div className="tv-overlay-panel">
                <header className="tv-overlay-header">
                    <div>
                        <span className="tv-overlay-icon"><ListMusic size={22} /></span>
                        <span>
                            <h2>{t('tv.player.queue')}</h2>
                            <small>{t('tv.player.queueCount', { count: queue.length })}</small>
                        </span>
                    </div>
                    <button
                        type="button"
                        data-tv-focusable="true"
                        data-tv-focus-key="queue-close"
                        onClick={onClose}
                        aria-label={t('tv.common.close')}
                    >
                        <X size={22} />
                    </button>
                </header>
                <div className="tv-overlay-list">
                    {queue.length === 0 && (
                        <div className="tv-overlay-empty">{t('tv.player.queueEmpty')}</div>
                    )}
                    {queue.map((song, index) => {
                        const coverUrl = resolveTvSongCoverUrl(song);
                        return (
                            <button
                                key={`${song.id}-${index}`}
                                type="button"
                                className={`tv-track-row${index === currentIndex ? ' is-current' : ''}`}
                                data-tv-focusable="true"
                                data-tv-focus-key={index === currentIndex ? 'queue-current' : `queue-${index}`}
                                onClick={() => onPlay(index)}
                            >
                                <span className="tv-track-index">
                                    {index === currentIndex ? <ListMusic size={18} /> : index + 1}
                                </span>
                                {coverUrl
                                    ? <img src={coverUrl} alt="" loading="lazy" decoding="async" />
                                    : <span className="tv-track-cover-fallback" />}
                                <span className="tv-track-copy">
                                    <strong>{song.name}</strong>
                                    <small>{getSongArtistLabel(song) || '—'}</small>
                                </span>
                                {index === currentIndex && <em>{t('tv.player.nowPlaying')}</em>}
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

