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
// 首页在线曲库的纵向内容区，固定按电台、歌单、专辑排列，不再使用页签切换。

const radioCardKind = (card: LibraryHomeCard): TvOnlineCardKind => (
    isPersonalFmCard(card)
        ? 'personal-fm'
        : card.id === DAILY_RECOMMENDATIONS_CARD_ID
            ? 'daily'
            : 'playlist'
);

/** 电台、歌单、专辑三行同时挂载，按遥控器几何导航顺序纵向排列。 */
export const TvHomeLibraryRows = ({
    account,
    playlists,
    online,
    onPlayTracks,
    onOpenCollection,
}: {
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
        <>
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
        </>
    );
};
