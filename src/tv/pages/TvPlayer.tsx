// src/tv/pages/TvPlayer.tsx

import { useTranslation } from 'react-i18next';
import {
    getSongAlbumLabel,
    getSongArtistLabel,
} from '../../services/onlineMusic/songMetadata';
import { TvBackdrop } from '../components/TvBackdrop';
import { TvControlDock } from '../components/TvControlDock';
import { TvLyricStage } from '../components/TvLyricStage';
import type { TvPlayerModel } from '../model/tvTypes';
import { resolveTvSongCoverUrl } from '../services/tvPlaybackSource';

export const TvPlayer = ({
    player,
    controlsOpen,
    constrained,
    onOpenQueue,
    onCloseControls,
    inert,
}: {
    player: TvPlayerModel;
    controlsOpen: boolean;
    constrained: boolean;
    onOpenQueue: () => void;
    onCloseControls: () => void;
    inert: boolean;
}) => {
    const { t } = useTranslation();
    const song = player.currentSong;
    const coverUrl = resolveTvSongCoverUrl(song);
    const artist = song ? getSongArtistLabel(song) : '';
    const album = song ? getSongAlbumLabel(song) : '';
    const modeLabel = player.effectsMode === 'flow' ? t('tv.player.flow') : t('tv.player.calm');

    return (
        <div
            id="tv-layer-player"
            data-tv-layer="player"
            className={`tv-page tv-player-page${controlsOpen ? ' has-controls' : ''}`}
            inert={inert || undefined}
        >
            <TvBackdrop
                coverUrl={coverUrl}
                calm={player.effectsMode === 'calm'}
            />
            <header className="tv-player-header">
                <div className="tv-player-song">
                    <span className="tv-player-brand">Folia TV</span>
                    <strong>{song?.name || t('tv.player.noSong')}</strong>
                    <small>{[artist, album].filter(Boolean).join(' · ') || t('tv.home.chooseSong')}</small>
                </div>
                <div className="tv-player-mode">
                    <span>{modeLabel}</span>
                    {player.status === 'loading' && <em>{t('tv.player.loading')}</em>}
                    {player.status === 'error' && <em className="is-error">{t('tv.player.playbackFailed')}</em>}
                </div>
            </header>
            <TvLyricStage
                song={song}
                lyrics={player.lyrics}
                status={player.status}
                effectsMode={player.effectsMode}
                isLyricsLoading={player.isLyricsLoading}
                currentTime={player.currentTime}
            />
            <footer className="tv-player-footer">
                <span>{t('tv.player.backHome')}</span>
                <span>{controlsOpen ? t('tv.player.controlHint') : t('tv.player.remoteHint')}</span>
            </footer>
            {controlsOpen && (
                <TvControlDock
                    player={player}
                    constrained={constrained}
                    onOpenQueue={onOpenQueue}
                    onClose={onCloseControls}
                />
            )}
        </div>
    );
};

