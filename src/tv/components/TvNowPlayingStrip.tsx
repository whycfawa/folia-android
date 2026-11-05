// src/tv/components/TvNowPlayingStrip.tsx

import { Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { resolveTvSongCoverUrl } from '../services/tvPlaybackSource';

export const TvNowPlayingStrip = ({
    song,
    isPlaying,
    onActivate,
    onToggle,
}: {
    song: SongResult | null;
    isPlaying: boolean;
    onActivate: () => void;
    onToggle: () => void;
}) => {
    const { t } = useTranslation();
    if (!song) return null;
    const coverUrl = resolveTvSongCoverUrl(song);

    return (
        <div
            className="tv-now-playing-strip"
            data-tv-focus-group="home-now-playing"
            data-tv-focus-axis="horizontal"
        >
            <button
                type="button"
                className="tv-now-playing-open"
                data-tv-focusable="true"
                data-tv-focus-key="home-now-playing"
                onClick={onActivate}
            >
                {coverUrl && <img src={coverUrl} alt="" loading="eager" decoding="async" />}
                <span>
                    <small>{t('tv.player.nowPlaying')}</small>
                    <strong>{song.name}</strong>
                    <em>{getSongArtistLabel(song) || '—'}</em>
                </span>
            </button>
            <button
                type="button"
                className="tv-now-playing-toggle"
                data-tv-focusable="true"
                data-tv-focus-key="home-now-toggle"
                onClick={onToggle}
                aria-label={isPlaying ? t('tv.player.pause') : t('tv.player.play')}
            >
                {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
        </div>
    );
};

