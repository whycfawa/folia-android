// src/tv/pages/TvHome.tsx

import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import { TvHeader } from '../components/TvHeader';
import { TvHero } from '../components/TvHero';
import { TvHomeLibraryRows } from '../components/TvHomeLibrarySection';
import { TvMediaRow, TvRowStatus } from '../components/TvMediaRow';
import { TvSongCard } from '../components/TvSongCard';
import type { TvAccountModel } from '../hooks/useTvAccount';
import type { TvLibraryModel } from '../hooks/useTvLibrary';
import { useTvOnlineHome } from '../hooks/useTvOnlineHome';
import type { TvPlayerModel } from '../model/tvTypes';

export const TvHome = ({
    account,
    library,
    player,
    onActivateHero,
    onOpenAccount,
    onOpenSearch,
    onPlayTracks,
    onOpenCollection,
    inert,
}: {
    account: TvAccountModel;
    library: TvLibraryModel;
    player: TvPlayerModel;
    onActivateHero: () => void;
    onOpenAccount: () => void;
    onOpenSearch: () => void;
    onPlayTracks: (songs: SongResult[], startIndex: number) => void;
    onOpenCollection: (collection: ProviderCollection) => void;
    inert: boolean;
}) => {
    const { t } = useTranslation();
    const online = useTvOnlineHome(account);
    const isPlaying = player.status === 'playing';

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
                onOpenSearch={onOpenSearch}
            >
                <TvHero
                    song={player.currentSong}
                    isAuthenticated={account.isAuthenticated}
                    isPlaying={isPlaying}
                    onActivate={onActivateHero}
                    labels={{
                        chooseSong: t('tv.home.chooseSong'),
                        loginHint: t('tv.home.loginHint'),
                    }}
                />
            </TvHeader>
            <main className="tv-home-content" data-tv-focus-container="home-body">
                <TvMediaRow
                    title={t('tv.home.liked')}
                    focusGroup="home-liked"
                >
                    {!account.isAuthenticated ? (
                        <TvRowStatus focusKey="home-liked-status">
                            {t('tv.home.loginForLiked')}
                        </TvRowStatus>
                    ) : library.isLoadingLiked ? (
                        <TvRowStatus focusKey="home-liked-status">
                            {t('tv.home.loading')}
                        </TvRowStatus>
                    ) : library.likedError ? (
                        <TvRowStatus focusKey="home-liked-status">
                            {t('tv.home.likedError')}
                        </TvRowStatus>
                    ) : library.likedSongs.length === 0 ? (
                        <TvRowStatus focusKey="home-liked-status">
                            {t('tv.home.likedEmpty')}
                        </TvRowStatus>
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
                <TvHomeLibraryRows
                    account={account}
                    playlists={library.playlists}
                    online={online}
                    onPlayTracks={onPlayTracks}
                    onOpenCollection={onOpenCollection}
                />
                {library.recentLocalSongs.length > 0 && (
                    <TvMediaRow title={t('tv.home.recent')} focusGroup="home-recent">
                        {library.recentLocalSongs.map(song => (
                            <TvSongCard
                                key={song.id}
                                song={song}
                                focusKey={`home-recent-${song.id}`}
                                isCurrent={song.id === player.currentSong?.id}
                                onClick={() => playLocalSong(song)}
                            />
                        ))}
                    </TvMediaRow>
                )}
            </main>
        </div>
    );
};

