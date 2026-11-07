// src/tv/components/TvCollectionOverlay.tsx

import { ListMusic, Loader2, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import { useTvCollectionTracks } from '../hooks/useTvCollectionTracks';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

export const TvCollectionOverlay = ({
    collection,
    onPlayTracks,
}: {
    collection: ProviderCollection;
    onPlayTracks: (tracks: SongResult[], startIndex: number) => void;
}) => {
    const { t } = useTranslation();
    const { tracks, isLoading, error, reload } = useTvCollectionTracks(collection);

    return (
        <section id="tv-layer-collection" data-tv-layer="collection" className="tv-overlay tv-collection-overlay">
            <div
                className="tv-overlay-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tv-collection-title"
            >
                <header className="tv-overlay-header">
                    <div>
                        <span className="tv-overlay-icon"><ListMusic size={22} /></span>
                        <span>
                            <h2 id="tv-collection-title">{collection.name}</h2>
                        </span>
                    </div>
                </header>

                <div className="tv-collection-body">
                    {isLoading ? (
                        <div className="tv-overlay-empty">
                            <Loader2 size={28} className="tv-spin" />
                            <span>{t('tv.collection.loading')}</span>
                        </div>
                    ) : error ? (
                        <div className="tv-overlay-empty">
                            <span>{t('tv.collection.error')}</span>
                            <button
                                type="button"
                                data-tv-focusable="true"
                                data-tv-focus-key="collection-retry"
                                onClick={reload}
                            >
                                <RefreshCw size={18} />
                                {t('tv.collection.retry')}
                            </button>
                        </div>
                    ) : tracks.length === 0 ? (
                        <div className="tv-overlay-empty">{t('tv.collection.empty')}</div>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="tv-play-all"
                                data-tv-focusable="true"
                                data-tv-focus-key="collection-play-all"
                                onClick={() => onPlayTracks(tracks, 0)}
                            >
                                <Play size={20} fill="currentColor" />
                                {t('tv.collection.playAll')}
                            </button>
                            <div
                                className="tv-overlay-list"
                                data-tv-focus-group="collection-list"
                                data-tv-focus-axis="vertical"
                            >
                                {tracks.map((song, index) => {
                                    const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.row);
                                    return (
                                        <button
                                            key={`${song.id}-${index}`}
                                            type="button"
                                            className="tv-track-row"
                                            data-tv-focusable="true"
                                            data-tv-focus-key={`collection-track-${song.id}-${index}`}
                                            onClick={() => onPlayTracks(tracks, index)}
                                        >
                                            <span className="tv-track-index">{index + 1}</span>
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
                        </>
                    )}
                </div>
            </div>
        </section>
    );
};

