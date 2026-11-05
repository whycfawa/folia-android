// src/tv/pages/TvHome.tsx

import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import { TvHeader } from '../components/TvHeader';
import { TvHero } from '../components/TvHero';
import { TvMediaRow } from '../components/TvMediaRow';
import { TvNowPlayingStrip } from '../components/TvNowPlayingStrip';
import { TvPlaylistCard } from '../components/TvPlaylistCard';
import { TvSongCard } from '../components/TvSongCard';
import type { TvAccountModel } from '../hooks/useTvAccount';
import type { TvLibraryModel } from '../hooks/useTvLibrary';
import type { TvPlayerModel } from '../model/tvTypes';

export const TvHome = ({
    account,
    library,
    player,
    onActivateHero,
    onOpenAccount,
    onOpenPlayer,
    onPlayTracks,
    onOpenCollection,
    inert,
}: {
    account: TvAccountModel;
    library: TvLibraryModel;
    player: TvPlayerModel;
    onActivateHero: () => void;
    onOpenAccount: () => void;
    onOpenPlayer: () => void;
    onPlayTracks: (songs: SongResult[], startIndex: number) => void;
    onOpenCollection: (collection: ProviderCollection) => void;
    inert: boolean;
}) => {
    const { t } = useTranslation();
    const isPlaying = player.status === 'playing';
    const localCount = t('tv.common.trackCount', { count: library.localSongs.length });
    const likedCount = t('tv.common.trackCount', { count: library.likedSongs.length });

    const playLocalSong = (song: SongResult) => {
        const index = library.localSongs.findIndex(candidate => candidate.id === song.id);
        onPlayTracks(library.localSongs, Math.max(0, index));
    };
    const playLikedSong = (song: SongResult) => {
        const index = library.likedSongs.findIndex(candidate => candidate.id === song.id);
        onPlayTracks(library.likedSongs, Math.max(0, index));
    };

    return (
        <div
            id="tv-layer-home"
            data-tv-layer="home"
            className="tv-page tv-home-page"
            inert={inert || undefined}
        >
            <TvHeader
                userName={account.activeAccount?.user?.nickname}
                providerLabel={account.providerLabel}
                isAuthenticated={account.isAuthenticated}
                onOpenAccount={onOpenAccount}
            />
            <TvNowPlayingStrip
                song={player.currentSong}
                isPlaying={isPlaying}
                onActivate={onOpenPlayer}
                onToggle={player.togglePlayback}
            />
            <main className="tv-home-content">
                <TvHero
                    song={player.currentSong}
                    isAuthenticated={account.isAuthenticated}
                    isPlaying={isPlaying}
                    onActivate={onActivateHero}
                    labels={{
                        continue: t('tv.home.continue'),
                        welcome: t('tv.home.welcome'),
                        openPlayer: t('tv.home.openPlayer'),
                        chooseSong: t('tv.home.chooseSong'),
                        loginTitle: t('tv.home.loginTitle'),
                        loginHint: t('tv.home.loginHint'),
                        loginAction: t('tv.home.login'),
                    }}
                />
                <TvMediaRow title={t('tv.home.recent')} subtitle={localCount} focusGroup="home-recent">
                    {library.isLoadingLocal ? (
                        <div className="tv-row-empty">{t('tv.home.loading')}</div>
                    ) : library.recentLocalSongs.length === 0 ? (
                        <div className="tv-row-empty">{t('tv.home.localEmpty')}</div>
                    ) : library.recentLocalSongs.map(song => (
                        <TvSongCard
                            key={song.id}
                            song={song}
                            focusKey={`home-recent-${song.id}`}
                            isCurrent={song.id === player.currentSong?.id}
                            onClick={() => playLocalSong(song)}
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
                    ) : library.playlists.length === 0 ? (
                        <div className="tv-row-empty">{t('tv.home.playlistsEmpty')}</div>
                    ) : library.playlists.map(collection => (
                        <TvPlaylistCard
                            key={collection.id}
                            collection={collection}
                            focusKey={`home-playlist-${collection.id}`}
                            onClick={() => onOpenCollection(collection)}
                        />
                    ))}
                </TvMediaRow>
                <TvMediaRow
                    title={t('tv.home.liked')}
                    subtitle={account.isAuthenticated ? likedCount : undefined}
                    focusGroup="home-liked"
                >
                    {!account.isAuthenticated ? (
                        <div className="tv-row-empty">{t('tv.home.loginForLiked')}</div>
                    ) : library.isLoadingLiked ? (
                        <div className="tv-row-empty">{t('tv.home.loading')}</div>
                    ) : library.likedError ? (
                        <div className="tv-row-empty">{t('tv.home.likedError')}</div>
                    ) : library.likedSongs.length === 0 ? (
                        <div className="tv-row-empty">{t('tv.home.likedEmpty')}</div>
                    ) : library.likedSongs.map(song => (
                        <TvSongCard
                            key={song.id}
                            song={song}
                            focusKey={`home-liked-${song.id}`}
                            isCurrent={song.id === player.currentSong?.id}
                            onClick={() => playLikedSong(song)}
                        />
                    ))}
                </TvMediaRow>
            </main>
        </div>
    );
};

