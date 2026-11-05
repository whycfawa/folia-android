// src/tv/components/TvPlaylistCard.tsx

import { ListMusic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderCollection } from '../../types/onlineMusic';

export const TvPlaylistCard = ({
    collection,
    focusKey,
    onClick,
}: {
    collection: ProviderCollection;
    focusKey: string;
    onClick: () => void;
}) => {
    const { t } = useTranslation();

    return (
        <button
            type="button"
            className="tv-collection-card"
            data-tv-focusable="true"
            data-tv-focus-key={focusKey}
            onClick={onClick}
        >
            <span className="tv-collection-cover">
                {collection.coverUrl ? (
                    <img src={collection.coverUrl} alt="" loading="lazy" decoding="async" />
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
};

