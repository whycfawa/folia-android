import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions } from '../../../../types/appPlayback';
import { installExternalPlayback, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { onlineFailureToast } from '../source/onlineFailureToast';

// src/components/app/playback/bridges/useExternalPlaybackBridge.ts
// The React side of the external playback route: mounts its guard and shim, moves the queue on
// when the provider's player reports the end of a track, and tells the listener what it could not
// do. Transport controls live with the other routes' (usePlaybackTransportController).

type UseExternalPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
};

/**
 * 连续被平台播放器拒绝的曲数。一首被拒就带着原因跳到下一首；连着几首都被拒，说明不是某一首的
 * 运气问题（地区、账号或整批版权限制），此时停下并说明，免得把整个队列当空气一首首跳过。
 */
const MAX_CONSECUTIVE_REFUSALS = 3;
/** 上一次拒绝之后这么久还没有新的拒绝，就不再算「连续」。 */
const REFUSAL_CHAIN_MS = 120_000;
let refusedInARow = 0;
let lastRefusalAt = 0;

export function useExternalPlaybackBridge({ handleNextTrack }: UseExternalPlaybackBridgeParams) {
    // Read here rather than passed in: the callback and i18n are the newest at the moment of an event.
    const { t } = useTranslation();
    const latestRef = useRef({ handleNextTrack, t });
    useEffect(() => {
        latestRef.current = { handleNextTrack, t };
    });

    useEffect(() => {
        installExternalPlayback();
        return subscribeExternalPlayback(event => {
            if (event.type === 'ended') {
                // As <audio>'s ended handler does: nothing after this when the queue is over.
                // 一首真的放完了：连续被拒的计数从零开始。
                refusedInARow = 0;
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
                // 平台自己的播放器明确拒绝这首歌：不是卡住，重开也没用。说清原因，再决定跳还是停。
                const now = Date.now();
                refusedInARow = now - lastRefusalAt < REFUSAL_CHAIN_MS ? refusedInARow + 1 : 1;
                lastRefusalAt = now;
                if (refusedInARow >= MAX_CONSECUTIVE_REFUSALS) {
                    setStatusMessage({
                        type: 'error',
                        text: latestRef.current.t('status.externalPlaybackRefusedQueue'),
                        durationMs: 8000,
                    });
                    return;
                }
                setStatusMessage({
                    type: 'error',
                    text: latestRef.current.t('status.externalPlaybackRefused'),
                    durationMs: 8000,
                });
                void latestRef.current.handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
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
