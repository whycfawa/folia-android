import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions } from '../../../../types/appPlayback';
import { installExternalPlayback, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { onlineFailureOf, type OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { onlineFailureToast } from '../source/onlineFailureToast';
import type { PlaybackFailureSkipOptions } from '../start/usePlaybackQueueController';

// src/components/app/playback/bridges/useExternalPlaybackBridge.ts
// The React side of the external playback route: mounts its guard and shim, moves the queue on
// when the provider's player reports the end of a track, and tells the listener what it could not
// do. Transport controls live with the other routes' (usePlaybackTransportController).

type UseExternalPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
    /**
     * 播放中途的失败（和媒体元素报错同一条路）：它负责把这一次失败说成和「未返回音频」同一个提示框，
     * 并按情况决定停在这里还是倒数跳过。
     */
    skipAfterPlaybackFailure: (shown?: OnlineFailure, options?: PlaybackFailureSkipOptions) => void;
};

export function useExternalPlaybackBridge({ handleNextTrack, skipAfterPlaybackFailure }: UseExternalPlaybackBridgeParams) {
    // Read here rather than passed in: the callback and i18n are the newest at the moment of an event.
    const { t } = useTranslation();
    const latestRef = useRef({ handleNextTrack, skipAfterPlaybackFailure, t });
    useEffect(() => {
        latestRef.current = { handleNextTrack, skipAfterPlaybackFailure, t };
    });

    useEffect(() => {
        installExternalPlayback();
        return subscribeExternalPlayback(event => {
            if (event.type === 'ended') {
                // As <audio>'s ended handler does: nothing after this when the queue is over.
                void latestRef.current.handleNextTrack({ allowStopOnMissing: true, playedToEnd: true, shouldNavigateToPlayer: false });
                return;
            }
            if (event.type === 'foreign-track') {
                setStatusMessage({ type: 'info', text: latestRef.current.t('status.externalPlayerMovedOn') });
                return;
            }
            if (event.type === 'stalled') {
                // Said at once, not on a timer: the toast about a stream that stopped moving is what
                // tells the listener the silence is not their pause, and whether it is being retried.
                setStatusMessage(event.paused
                    ? { type: 'error', text: latestRef.current.t('status.externalPlaybackStalled'), durationMs: 6000 }
                    : { type: 'info', text: latestRef.current.t('status.externalPlaybackStalledRetrying') });
                return;
            }
            if (event.type === 'unplayable') {
                // 平台自己的播放器明确拒绝这首歌（版权/内容受限）：不是卡住，重开也没用。走和「未返回
                // 音频」同一条路，说成同一个提示框，跳过与否则由那一套（含「无法播放时自动跳过」）决定。
                // The refused song comes with the event: its start may still be landing, so the store's
                // current song can be the one before it.
                const song = event.song ?? usePlaybackStore.getState().currentSong;
                const providerId = song?.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined;
                latestRef.current.skipAfterPlaybackFailure(
                    onlineFailureOf({ operation: 'audio', providerId }, {
                        detail: { case: event.reason === 'no-audio' ? 'no-audio' : 'content-restricted' },
                    }),
                    { failedSongKey: song ? getPlaybackSongKey(song) : undefined },
                );
                return;
            }
            if (event.type === 'failure') {
                const song = usePlaybackStore.getState().currentSong;
                const providerId = song?.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined;
                setStatusMessage(onlineFailureToast(
                    onlineFailureOf({ operation: 'audio', providerId }, { error: event.error }),
                    latestRef.current.t,
                ));
            }
        });
    }, []);
}
