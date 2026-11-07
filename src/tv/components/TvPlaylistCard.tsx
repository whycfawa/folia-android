// src/tv/components/TvPlaylistCard.tsx

import { memo } from 'react';
import { ListMusic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderCollection } from '../../types/onlineMusic';
import { resolveTvCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

export const TvPlaylistCard = memo(({
    collection,
    focusKey,
    onActivate,
}: {
    collection: ProviderCollection;
    focusKey: string;
    onActivate: (collection: ProviderCollection) => void;
}) => {
    const { t } = useTranslation();
    const coverUrl = resolveTvCoverUrl(collection.coverUrl, TV_COVER_SIZE.card);

    return (
        <button
            type="button"
            className="tv-collection-card"
            data-tv-focusable="true"
            data-tv-focus-key={focusKey}
            onClick={() => onActivate(collection)}
        >
            <span className="tv-collection-cover">
                {coverUrl ? (
                    <img src={coverUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                    <ListMusic size={42} />
                )}
            </span>
            <span className="tv-media-copy">
                <strong>{collection.name}</strong>
                <small>
                    {typeof collection.trackCount === 'number'
                        ? t('tv.common.trackCount', { count: collection.trackCount })
                        : collection.description || t('tv.home.playlists')}
                </small>
            </span>
        </button>
    );
});

