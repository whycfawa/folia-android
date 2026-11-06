// src/tv/input/tvTrackSkipGesture.ts

import type { TvRemoteAction } from './tvKeys';

export const TV_TRACK_SKIP_INTERVAL_MS = 420;

type TrackDirection = Extract<TvRemoteAction, 'left' | 'right'>;

export type TvTrackSkipGesture = {
    press: (direction: TrackDirection, now: number) => boolean;
    clear: () => void;
};

/** Recognizes two distinct presses in the same horizontal direction while ignoring held-key repeats. */
export const createTvTrackSkipGesture = (
    intervalMs = TV_TRACK_SKIP_INTERVAL_MS,
): TvTrackSkipGesture => {
    let previous: { direction: TrackDirection; at: number } | null = null;

    return {
        press: (direction, now) => {
            const isDoublePress = previous?.direction === direction
                && now - previous.at >= 0
                && now - previous.at <= intervalMs;
            previous = isDoublePress ? null : { direction, at: now };
            return isDoublePress;
        },
        clear: () => {
            previous = null;
        },
    };
};
