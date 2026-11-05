// src/tv/input/tvRemotePress.ts

import type { TvRemoteAction } from './tvKeys';

export type TvRemotePressTracker = {
    press: (action: TvRemoteAction) => boolean;
    release: (action: TvRemoteAction) => void;
    clear: () => void;
};

/**
 * Tracks presses until key-up because Android may emit a long-press as a second key-down with
 * `repeat=false` instead of a browser auto-repeat event.
 */
export const createTvRemotePressTracker = (): TvRemotePressTracker => {
    const held = new Set<TvRemoteAction>();
    return {
        press: action => {
            const repeated = held.has(action);
            held.add(action);
            return repeated;
        },
        release: action => {
            held.delete(action);
        },
        clear: () => {
            held.clear();
        },
    };
};
