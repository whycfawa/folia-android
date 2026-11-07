// src/tv/components/TvQueueOverlay.tsx

import { ListMusic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

export const TvQueueOverlay = ({
    queue,
    currentIndex,
    onPlay,
}: {
    queue: SongResult[];
    currentIndex: number;
    onPlay: (index: number) => void;
}) => {
    const { t } = useTranslation();

    return (
        <section id="tv-layer-queue" data-tv-layer="queue" className="tv-overlay tv-queue-overlay">
            <div
                className="tv-overlay-panel tv-queue-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tv-queue-title"
            >
                <header className="tv-overlay-header">
                    <div>
                        <span className="tv-overlay-icon"><ListMusic size={22} /></span>
                        <span>
                            <h2 id="tv-queue-title">{t('tv.player.queue')}</h2>
                        </span>
                    </div>
                </header>
                <div
                    className="tv-overlay-list"
                    data-tv-focus-group="queue-list"
                    data-tv-focus-axis="vertical"
                >
                    {queue.length === 0 && (
                        <div className="tv-overlay-empty">{t('tv.player.queueEmpty')}</div>
                    )}
                    {queue.map((song, index) => {
                        const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.row);
                        return (
                            <button
                                key={`${song.id}-${index}`}
                                type="button"
                                className={`tv-track-row${index === currentIndex ? ' is-current' : ''}`}
                                data-tv-focusable="true"
                                data-tv-focus-key={index === currentIndex
                                    ? 'queue-current'
                                    : `queue-${song.id}-${index}`}
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
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

