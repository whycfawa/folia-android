import { useCallback } from 'react';
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
import { TvMediaRow, TvRowStatus } from './TvMediaRow';
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

    const openOnlineCollection = useCallback((card: LibraryHomeCard) => {
        onOpenCollection(onlineCardCollection(card) as unknown as ProviderCollection);
    }, [onOpenCollection]);
    const activateRadioCard = useCallback(async (card: LibraryHomeCard) => {
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
    }, [online.playDailyRecommendations, online.playPersonalFm, onPlayTracks, openOnlineCollection]);
    const activateRadioCardForTv = useCallback((card: LibraryHomeCard) => {
        void activateRadioCard(card);
    }, [activateRadioCard]);

    return (
        <>
            <TvMediaRow
                title={t('tv.home.radio')}
                focusGroup="home-radio"
            >
                {!account.isAuthenticated ? (
                    <TvRowStatus focusKey="home-radio-status">
                        {t('tv.home.loginForRadio')}
                    </TvRowStatus>
                ) : !online.canUseRadio ? (
                    <TvRowStatus focusKey="home-radio-status">
                        {t('tv.home.radioUnavailable')}
                    </TvRowStatus>
                ) : online.radioStatus === 'error' ? (
                    <TvRowStatus focusKey="home-radio-status">
                        {t('tv.home.radioError')}
                    </TvRowStatus>
                ) : online.radioStatus === 'idle' || online.radioStatus === 'loading' ? (
                    <TvRowStatus focusKey="home-radio-status">
                        {t('tv.home.loading')}
                    </TvRowStatus>
                ) : online.radioCards.length === 0 ? (
                    <TvRowStatus focusKey="home-radio-status">
                        {t('tv.home.radioEmpty')}
                    </TvRowStatus>
                ) : online.radioCards.map(card => (
                    <TvOnlineCard
                        key={card.id}
                        card={card}
                        kind={radioCardKind(card)}
                        focusKey={`home-radio-${String(card.id)}`}
                        onActivate={activateRadioCardForTv}
                    />
                ))}
            </TvMediaRow>

            <TvMediaRow
                title={t('tv.home.playlists')}
                focusGroup="home-playlists"
            >
                {!account.isAuthenticated ? (
                    <TvRowStatus focusKey="home-playlists-status">
                        {t('tv.home.loginForPlaylists')}
                    </TvRowStatus>
                ) : playlists.length === 0 ? (
                    <TvRowStatus focusKey="home-playlists-status">
                        {t('tv.home.playlistsEmpty')}
                    </TvRowStatus>
                ) : playlists.map(collection => (
                    <TvPlaylistCard
                        key={collection.id}
                        collection={collection}
                        focusKey={`home-playlist-${collection.id}`}
                        onActivate={onOpenCollection}
                    />
                ))}
            </TvMediaRow>

            <TvMediaRow
                title={t('tv.home.albums')}
                focusGroup="home-albums"
            >
                {!account.isAuthenticated ? (
                    <TvRowStatus focusKey="home-albums-status">
                        {t('tv.home.loginForAlbums')}
                    </TvRowStatus>
                ) : !online.canUseAlbums ? (
                    <TvRowStatus focusKey="home-albums-status">
                        {t('tv.home.albumsUnavailable')}
                    </TvRowStatus>
                ) : online.albumsStatus === 'error' ? (
                    <TvRowStatus focusKey="home-albums-status">
                        {t('tv.home.albumsError')}
                    </TvRowStatus>
                ) : online.albumsStatus === 'idle' || online.albumsStatus === 'loading' ? (
                    <TvRowStatus focusKey="home-albums-status">
                        {t('tv.home.loading')}
                    </TvRowStatus>
                ) : online.albumCards.length === 0 ? (
                    <TvRowStatus focusKey="home-albums-status">
                        {t('tv.home.albumsEmpty')}
                    </TvRowStatus>
                ) : online.albumCards.map(card => (
                    <TvOnlineCard
                        key={card.id}
                        card={card}
                        kind="album"
                        focusKey={`home-album-${String(card.id)}`}
                        onActivate={openOnlineCollection}
                    />
                ))}
            </TvMediaRow>
        </>
    );
};
