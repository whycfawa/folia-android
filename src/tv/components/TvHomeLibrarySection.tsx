import { useTranslation } from 'react-i18next';
import type { LibraryHomeCard } from '../../library/core/contracts/homeModel';
import {
    DAILY_RECOMMENDATIONS_CARD_ID,
    isPersonalFmCard,
    onlineCardCollection,
} from '../../library/core/model/homeCards';
import type { SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import type { TvAccountModel } from '../hooks/useTvAccount';
import type { TvOnlineHomeModel } from '../hooks/useTvOnlineHome';
import { TvMediaRow } from './TvMediaRow';
import { TvOnlineCard, type TvOnlineCardKind } from './TvOnlineCard';
import { TvPlaylistCard } from './TvPlaylistCard';

// src/tv/components/TvHomeLibrarySection.tsx
// 首页在线曲库的页签与卡片行：歌单、电台、专辑共用同一块可见区域，切换页签时不保留隐藏行。

export type TvHomeLibraryTab = 'playlists' | 'radio' | 'albums';

const LIBRARY_TABS: TvHomeLibraryTab[] = ['playlists', 'radio', 'albums'];

const radioCardKind = (card: LibraryHomeCard): TvOnlineCardKind => (
    isPersonalFmCard(card)
        ? 'personal-fm'
        : card.id === DAILY_RECOMMENDATIONS_CARD_ID
            ? 'daily'
            : 'playlist'
);

/** The persistent three-tab entry for the online library. */
export const TvHomeLibraryTabs = ({
    activeTab,
    onChange,
}: {
    activeTab: TvHomeLibraryTab;
    onChange: (tab: TvHomeLibraryTab) => void;
}) => {
    const { t } = useTranslation();

    return (
        <div
            className="tv-home-tabs"
            role="tablist"
            aria-label={t('tv.home.onlineLibrary')}
            data-tv-focus-group="home-library-tabs"
            data-tv-focus-axis="horizontal"
            data-tv-focus-entry="selected"
        >
            {LIBRARY_TABS.map(tab => (
                <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    aria-controls="tv-home-library-panel"
                    className={`tv-home-tab${activeTab === tab ? ' is-active' : ''}`}
                    data-tv-focusable="true"
                    data-tv-focus-key={`home-library-tab-${tab}`}
                    onClick={() => onChange(tab)}
                    onFocus={() => {
                        if (activeTab !== tab) onChange(tab);
                    }}
                >
                    {t(`tv.home.${tab}`)}
                </button>
            ))}
        </div>
    );
};

/**
 * The selected online-library row. Only the visible tab is mounted, so TV does not keep three
 * horizontal card rows (and their lazy images) alive below the fold.
 */
export const TvHomeLibraryRow = ({
    activeTab,
    account,
    playlists,
    online,
    onPlayTracks,
    onOpenCollection,
}: {
    activeTab: TvHomeLibraryTab;
    account: TvAccountModel;
    playlists: ProviderCollection[];
    online: TvOnlineHomeModel;
    onPlayTracks: (songs: SongResult[], startIndex: number) => void;
    onOpenCollection: (collection: ProviderCollection) => void;
}) => {
    const { t } = useTranslation();

    const openOnlineCollection = (card: LibraryHomeCard) => {
        onOpenCollection(onlineCardCollection(card) as unknown as ProviderCollection);
    };
    const activateRadioCard = async (card: LibraryHomeCard) => {
        if (isPersonalFmCard(card)) {
            const songs = await online.playPersonalFm();
            if (songs) onPlayTracks(songs, 0);
            return;
        }
        if (card.id === DAILY_RECOMMENDATIONS_CARD_ID) {
            const songs = await online.playDailyRecommendations();
            if (songs) onPlayTracks(songs, 0);
            return;
        }
        openOnlineCollection(card);
    };

    return (
        <div
            id="tv-home-library-panel"
            role="tabpanel"
            aria-label={t(`tv.home.${activeTab}`)}
        >
            {activeTab === 'playlists' && (
                <TvMediaRow
                    title={t('tv.home.playlists')}
                    subtitle={account.isAuthenticated ? account.providerLabel : undefined}
                    focusGroup="home-playlists"
                >
                    {!account.isAuthenticated ? (
                        <div className="tv-row-empty">{t('tv.home.loginForPlaylists')}</div>
                    ) : playlists.length === 0 ? (
                        <div className="tv-row-empty">{t('tv.home.playlistsEmpty')}</div>
                    ) : playlists.map(collection => (
                        <TvPlaylistCard
                            key={collection.id}
                            collection={collection}
                            focusKey={`home-playlist-${collection.id}`}
                            onClick={() => onOpenCollection(collection)}
                        />
                    ))}
                </TvMediaRow>
            )}

            {activeTab === 'radio' && (
                <TvMediaRow
                    title={t('tv.home.radio')}
                    subtitle={online.radioActionError
                        ? t('tv.home.radioPlaybackError')
                        : account.isAuthenticated ? account.providerLabel : undefined}
                    focusGroup="home-radio"
                >
                    {!account.isAuthenticated ? (
                        <div className="tv-row-empty">{t('tv.home.loginForRadio')}</div>
                    ) : !online.canUseRadio ? (
                        <div className="tv-row-empty">{t('tv.home.radioUnavailable')}</div>
                    ) : online.radioStatus === 'error' ? (
                        <div className="tv-row-empty">{t('tv.home.radioError')}</div>
                    ) : online.radioStatus === 'idle' || online.radioStatus === 'loading' ? (
                        <div className="tv-row-empty">{t('tv.home.loading')}</div>
                    ) : online.radioCards.length === 0 ? (
                        <div className="tv-row-empty">{t('tv.home.radioEmpty')}</div>
                    ) : online.radioCards.map(card => (
                        <TvOnlineCard
                            key={card.id}
                            card={card}
                            kind={radioCardKind(card)}
                            focusKey={`home-radio-${String(card.id)}`}
                            onClick={() => void activateRadioCard(card)}
                        />
                    ))}
                </TvMediaRow>
            )}

            {activeTab === 'albums' && (
                <TvMediaRow
                    title={t('tv.home.albums')}
                    subtitle={account.isAuthenticated ? account.providerLabel : undefined}
                    focusGroup="home-albums"
                >
                    {!account.isAuthenticated ? (
                        <div className="tv-row-empty">{t('tv.home.loginForAlbums')}</div>
                    ) : !online.canUseAlbums ? (
                        <div className="tv-row-empty">{t('tv.home.albumsUnavailable')}</div>
                    ) : online.albumsStatus === 'error' ? (
                        <div className="tv-row-empty">{t('tv.home.albumsError')}</div>
                    ) : online.albumsStatus === 'idle' || online.albumsStatus === 'loading' ? (
                        <div className="tv-row-empty">{t('tv.home.loading')}</div>
                    ) : online.albumCards.length === 0 ? (
                        <div className="tv-row-empty">{t('tv.home.albumsEmpty')}</div>
                    ) : online.albumCards.map(card => (
                        <TvOnlineCard
                            key={card.id}
                            card={card}
                            kind="album"
                            focusKey={`home-album-${String(card.id)}`}
                            onClick={() => openOnlineCollection(card)}
                        />
                    ))}
                </TvMediaRow>
            )}
        </div>
    );
};
