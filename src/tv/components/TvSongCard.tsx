// src/tv/components/TvSongCard.tsx

import { memo } from 'react';
import { Music2 } from 'lucide-react';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

export const TvSongCard = memo(({
    song,
    focusKey,
    isCurrent = false,
    onActivate,
}: {
    song: SongResult;
    focusKey: string;
    isCurrent?: boolean;
    onActivate: (song: SongResult) => void;
}) => {
    const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.card);

    return (
        <button
            type="button"
            className={`tv-media-card${isCurrent ? ' is-current' : ''}`}
            data-tv-focusable="true"
            data-tv-focus-key={focusKey}
            onClick={() => onActivate(song)}
        >
            <span className="tv-media-cover">
                {coverUrl ? (
                    <img src={coverUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                    <span className="tv-cover-fallback"><Music2 size={38} /></span>
                )}
                {isCurrent && <span className="tv-playing-bars" aria-hidden="true"><i /><i /><i /></span>}
            </span>
            <span className="tv-media-copy">
                <strong>{song.name}</strong>
                <small>{getSongArtistLabel(song) || '—'}</small>
            </span>
        </button>
    );
});

