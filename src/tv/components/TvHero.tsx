// src/tv/components/TvHero.tsx

import { Disc3, LogIn, Play } from 'lucide-react';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

export const TvHero = ({
    song,
    isAuthenticated,
    isPlaying,
    onActivate,
    labels,
}: {
    song: SongResult | null;
    isAuthenticated: boolean;
    isPlaying: boolean;
    onActivate: () => void;
    labels: {
        chooseSong: string;
        loginHint: string;
    };
}) => {
    const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.card);
    const title = song?.name
        || (isAuthenticated ? labels.chooseSong : labels.loginHint);
    const artist = song ? getSongArtistLabel(song) : '';
    const actionIcon = song || isAuthenticated
        ? <Play size={11} fill="currentColor" />
        : <LogIn size={11} />;

    return (
        <button
            type="button"
            className={`tv-hero${song ? ' has-song' : ''}`}
            aria-label={[title, artist].filter(Boolean).join('，')}
            data-tv-focusable="true"
            data-tv-focus-key="home-hero"
            onClick={onActivate}
        >
            <span className="tv-hero-art">
                {coverUrl ? (
                    <img
                        src={coverUrl}
                        alt=""
                        loading="eager"
                        decoding="async"
                        fetchPriority="high"
                    />
                ) : (
                    <span className="tv-hero-art-fallback"><Disc3 size={34} /></span>
                )}
                <span className="tv-hero-art-state" aria-hidden="true">{actionIcon}</span>
            </span>
            <span className="tv-hero-copy">
                <strong className="tv-hero-title">{title}</strong>
                {artist && <span className="tv-hero-meta">{artist}</span>}
            </span>
            {song && isPlaying && (
                <span className="tv-hero-playing" aria-hidden="true"><i /><i /><i /></span>
            )}
        </button>
    );
};

