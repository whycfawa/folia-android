// src/tv/hooks/useTvRemote.ts
// One capture-phase key router for every TV surface. Capture matters: several desktop playback
// shortcuts already listen on window, and a remote key has to be consumed before those see it.

import { useEffect, useRef } from 'react';
import { isTextEntryTarget } from '../../utils/keyboardTargets';
import {
    isTvDirection,
    isTvSpaceKey,
    resolveTvRemoteAction,
    type TvRemoteAction,
} from '../input/tvKeys';
import { createTvRemotePressTracker } from '../input/tvRemotePress';

const DIRECTION_REPEAT_INTERVAL_MS = 95;

export type TvRemoteActionContext = {
    repeat: boolean;
};

type TvRemoteOptions = {
    onAction: (action: TvRemoteAction, context: TvRemoteActionContext) => boolean;
    onHandledKey?: (action: TvRemoteAction) => void;
};

export const useTvRemote = ({ onAction, onHandledKey }: TvRemoteOptions): void => {
    const actionRef = useRef(onAction);
    const handledRef = useRef(onHandledKey);
    const lastDirectionRef = useRef<{ action: TvRemoteAction; at: number } | null>(null);
    const pressTrackerRef = useRef(createTvRemotePressTracker());
    actionRef.current = onAction;
    handledRef.current = onHandledKey;

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const action = resolveTvRemoteAction(event);
            if (!action) return;
            const repeated = event.repeat || pressTrackerRef.current.press(action);
            if (isTextEntryTarget(event.target)) {
                const target = event.target instanceof HTMLElement ? event.target : null;
                const remoteInput = target?.closest('[data-tv-remote-input="true"]');
                if (!remoteInput) return;

                if (action === 'ok') {
                    if (isTvSpaceKey(event)) return;
                    if (repeated) {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        return;
                    }
                    // Let the input receive this same key event so its own submit handler can run.
                    target?.click();
                    return;
                }

                const canLeaveInput = action === 'up' || action === 'down' || action === 'back';
                if (!canLeaveInput) return;
            }

            if (!isTvDirection(action) && repeated) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }

            if (isTvDirection(action)) {
                const now = performance.now();
                const lastDirection = lastDirectionRef.current;
                if (
                    lastDirection?.action === action
                    && now - lastDirection.at < DIRECTION_REPEAT_INTERVAL_MS
                ) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return;
                }
                lastDirectionRef.current = { action, at: now };
            }

            const handled = actionRef.current(action, { repeat: repeated });
            if (!handled) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            handledRef.current?.(action);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            const action = resolveTvRemoteAction(event);
            if (action) pressTrackerRef.current.release(action);
        };
        const clearPressedActions = () => pressTrackerRef.current.clear();

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('keyup', handleKeyUp, true);
        window.addEventListener('blur', clearPressedActions);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('keyup', handleKeyUp, true);
            window.removeEventListener('blur', clearPressedActions);
        };
    }, []);
};
