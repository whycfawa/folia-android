import { Disc3, ListMusic, Radio, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeCard } from '../../library/core/contracts/homeModel';

// src/tv/components/TvOnlineCard.tsx
// 电台与收藏专辑共用的一张 TV 卡片。沿用账户歌单卡的视觉结构，只增加语义修饰类，所有排版仍由现有
// tv-collection-card 样式承担。

export type TvOnlineCardKind = 'personal-fm' | 'daily' | 'playlist' | 'album';

export const TvOnlineCard = ({
    card,
    kind,
    focusKey,
    onClick,
}: {
    card: LibraryHomeCard;
    kind: TvOnlineCardKind;
    focusKey: string;
    onClick: () => void;
}) => {
    const { t } = useTranslation();
    const trackCount = typeof card.trackCount === 'number'
        ? t('tv.common.trackCount', { count: card.trackCount })
        : '';
    const description = kind === 'album'
        ? card.description || trackCount || t('home.albums')
        : kind === 'personal-fm'
            ? t('tv.home.personalFmHint')
            : trackCount || card.description || t('home.radio');
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
            onClick={onClick}
        >
            <span className="tv-collection-cover">
                {card.coverUrl ? (
                    <img src={card.coverUrl} alt="" loading="lazy" decoding="async" />
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
};
