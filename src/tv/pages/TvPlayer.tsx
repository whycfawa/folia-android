// src/tv/pages/TvPlayer.tsx

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVisualizerBackgroundConfig } from '../../components/visualizer/useVisualizerBackgroundConfig';
import {
    getSongAlbumLabel,
    getSongArtistLabel,
} from '../../services/onlineMusic/songMetadata';
import { TvBackdrop } from '../components/TvBackdrop';
import { TvControlDock } from '../components/TvControlDock';
import { TvLyricStage } from '../components/TvLyricStage';
import { TvVisualizerStage } from '../components/TvVisualizerStage';
import { useTvAudioAnalyser } from '../hooks/useTvAudioAnalyser';
import type { TvPlayerModel } from '../model/tvTypes';
import { resolveTvVisualTheme } from '../model/tvVisualTheme';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

export const TvPlayer = ({
    player,
    controlsOpen,
    constrained,
    onOpenQueue,
    onOpenEffects,
    inert,
}: {
    player: TvPlayerModel;
    controlsOpen: boolean;
    constrained: boolean;
    onOpenQueue: () => void;
    onOpenEffects: () => void;
    inert: boolean;
}) => {
    const { t } = useTranslation();
    const song = player.currentSong;
    const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.backdrop);
    const artist = song ? getSongArtistLabel(song) : '';
    const album = song ? getSongAlbumLabel(song) : '';
    const statusLabel = player.status === 'loading'
        ? t('tv.player.loading')
        : player.status === 'error'
            ? t('tv.player.playbackFailed')
            : null;
    const theme = useMemo(() => resolveTvVisualTheme(constrained), [constrained]);
    const audio = useTvAudioAnalyser(player.audioRef, player.status);
    const sharedBackgroundConfig = useVisualizerBackgroundConfig();
    const urlBackgroundAvailable = sharedBackgroundConfig.url?.items?.some(item => (
        item.id === sharedBackgroundConfig.url?.selectedId
        && Boolean(item.url?.trim())
    )) ?? false;
    const backgroundMode = player.backgroundMode === 'url' && !urlBackgroundAvailable
        ? 'common'
        : player.backgroundMode;
    const backgroundConfig = useMemo(() => ({
        ...sharedBackgroundConfig,
        mode: backgroundMode,
        transparent: false,
    }), [backgroundMode, sharedBackgroundConfig]);

    return (
        <div
            id="tv-layer-player"
            data-tv-layer="player"
            data-tv-player-chrome={controlsOpen ? 'visible' : 'hidden'}
            className="tv-page tv-player-page"
            inert={inert || undefined}
        >
            <TvBackdrop
                config={backgroundConfig}
                theme={theme}
                coverUrl={coverUrl}
                seed={song?.id}
                audioPower={audio.audioPower}
                audioBands={audio.audioBands}
                paused={player.status !== 'playing'}
                staticMode={constrained}
            />
            {controlsOpen && (
                <header className="tv-player-header" data-tv-player-chrome-part="header">
                    <div className="tv-player-song">
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
            )}
            {song && player.lyrics && player.lyrics.lines.length > 0 && player.status !== 'error' ? (
                <TvVisualizerStage
                    key={song.id}
                    song={song}
                    lyrics={player.lyrics}
                    status={player.status}
                    visualizerMode={player.visualizerMode}
                    theme={theme}
                    audioPower={audio.audioPower}
                    audioBands={audio.audioBands}
                    constrained={constrained}
                    currentTime={player.currentTime}
                    isPlayerChromeHidden={!controlsOpen}
                />
            ) : (
                <TvLyricStage
                    song={song}
                    lyrics={player.lyrics}
                    status={player.status}
                    isLyricsLoading={player.isLyricsLoading}
                    currentTime={player.currentTime}
                />
            )}
            {controlsOpen && (
                <TvControlDock
                    player={player}
                    constrained={constrained}
                    onOpenQueue={onOpenQueue}
                    onOpenEffects={onOpenEffects}
                />
            )}
        </div>
    );
};

