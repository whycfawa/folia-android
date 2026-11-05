// src/tv/components/TvHero.tsx

import { CalendarClock, Disc3, LogIn, Play } from 'lucide-react';
import { getSongAlbumLabel, getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { resolveTvSongCoverUrl } from '../services/tvPlaybackSource';

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
        continue: string;
        welcome: string;
        openPlayer: string;
        chooseSong: string;
        loginTitle: string;
        loginHint: string;
        loginAction: string;
    };
}) => {
    const coverUrl = resolveTvSongCoverUrl(song);

    return (
        <button
            type="button"
            className={`tv-hero${song ? ' has-song' : ''}`}
            data-tv-focusable="true"
            data-tv-focus-key="home-hero"
            onClick={onActivate}
        >
            <span className="tv-hero-copy">
                <span className="tv-hero-eyebrow">
                    {song ? <Play size={18} /> : <CalendarClock size={18} />}
                    {song ? labels.continue : isAuthenticated ? labels.welcome : labels.loginTitle}
                </span>
                <strong className="tv-hero-title">
                    {song ? song.name : isAuthenticated ? labels.chooseSong : labels.loginHint}
                </strong>
                {song && (
                    <span className="tv-hero-meta">
                        <span>{getSongArtistLabel(song) || '—'}</span>
                        {getSongAlbumLabel(song) && <span>{getSongAlbumLabel(song)}</span>}
                    </span>
                )}
                <span className="tv-hero-action">
                    {song || isAuthenticated
                        ? <Play size={18} fill="currentColor" />
                        : <LogIn size={18} />}
                    {song
                        ? (isPlaying ? labels.continue : labels.openPlayer)
                        : isAuthenticated ? labels.chooseSong : labels.loginAction}
                </span>
            </span>
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
                    <span className="tv-hero-art-fallback"><Disc3 size={84} /></span>
                )}
                <span className="tv-hero-orbit" aria-hidden="true" />
            </span>
        </button>
    );
};

