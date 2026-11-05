// src/tv/pages/TvPlayer.tsx

import { useTranslation } from 'react-i18next';
import {
    getSongAlbumLabel,
    getSongArtistLabel,
} from '../../services/onlineMusic/songMetadata';
import { TvBackdrop } from '../components/TvBackdrop';
import { TvControlDock } from '../components/TvControlDock';
import { TvLyricStage } from '../components/TvLyricStage';
import { TvVisualizerStage } from '../components/TvVisualizerStage';
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
    const statusLabel = player.status === 'loading'
        ? t('tv.player.loading')
        : player.status === 'error'
            ? t('tv.player.playbackFailed')
            : null;

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
                {statusLabel && (
                    <div className="tv-player-mode tv-player-status" aria-live="polite">
                        <em className={player.status === 'error' ? 'is-error' : undefined}>
                            {statusLabel}
                        </em>
                    </div>
                )}
            </header>
            {song && player.lyrics && player.lyrics.lines.length > 0 && player.status !== 'error' ? (
                <TvVisualizerStage
                    key={song.id}
                    song={song}
                    lyrics={player.lyrics}
                    status={player.status}
                    effectsMode={player.effectsMode}
                    constrained={constrained}
                    currentTime={player.currentTime}
                />
            ) : (
                <TvLyricStage
                    song={song}
                    lyrics={player.lyrics}
                    status={player.status}
                    effectsMode={player.effectsMode}
                    isLyricsLoading={player.isLyricsLoading}
                    currentTime={player.currentTime}
                />
            )}
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

