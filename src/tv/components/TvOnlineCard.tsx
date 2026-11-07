import { memo } from 'react';
import { Disc3, ListMusic, Radio, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeCard } from '../../library/core/contracts/homeModel';
import { resolveTvCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

// src/tv/components/TvOnlineCard.tsx
// 电台与收藏专辑共用的一张 TV 卡片。沿用账户歌单卡的视觉结构，只增加语义修饰类，所有排版仍由现有
// tv-collection-card 样式承担。

export type TvOnlineCardKind = 'personal-fm' | 'daily' | 'playlist' | 'album';

export const TvOnlineCard = memo(({
    card,
    kind,
    focusKey,
    onActivate,
}: {
    card: LibraryHomeCard;
    kind: TvOnlineCardKind;
    focusKey: string;
    onActivate: (card: LibraryHomeCard) => void;
}) => {
    const { t } = useTranslation();
    const coverUrl = resolveTvCoverUrl(card.coverUrl, TV_COVER_SIZE.card);
    const trackCount = typeof card.trackCount === 'number'
        ? t('tv.common.trackCount', { count: card.trackCount })
        : '';
    const fallbackLabel = kind === 'album'
        ? t('home.albums')
        : kind === 'personal-fm' || kind === 'daily'
            ? t('home.radio')
            : t('home.playlists');
    const description = trackCount || card.description || fallbackLabel;
    const FallbackIcon = kind === 'personal-fm'
        ? Radio
        : kind === 'daily'
            ? Sparkles
            : kind === 'album'
                ? Disc3
                : ListMusic;

    return (
        <button
            type="button"
            className={`tv-collection-card tv-online-card is-${kind}`}
            data-tv-focusable="true"
            data-tv-focus-key={focusKey}
            data-tv-online-kind={kind}
            onClick={() => onActivate(card)}
        >
            <span className="tv-collection-cover">
                {coverUrl ? (
                    <img src={coverUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                    <FallbackIcon size={42} />
                )}
            </span>
            <span className="tv-media-copy">
                <strong>{card.name}</strong>
                <small>{description}</small>
            </span>
        </button>
    );
});
