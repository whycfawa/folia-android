// src/tv/hooks/useTvRemote.ts
// One capture-phase key router for every TV surface. Capture matters: several desktop playback
// shortcuts already listen on window, and a remote key has to be consumed before those see it.

import { useEffect, useRef } from 'react';
import { isTextEntryTarget } from '../../utils/keyboardTargets';
import { isTvDirection, resolveTvRemoteAction, type TvRemoteAction } from '../input/tvKeys';

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
    actionRef.current = onAction;
    handledRef.current = onHandledKey;

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (isTextEntryTarget(event.target)) return;

            const action = resolveTvRemoteAction(event);
            if (!action) return;

            if (!isTvDirection(action) && event.repeat) {
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

            const handled = actionRef.current(action, { repeat: event.repeat });
            if (!handled) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            handledRef.current?.(action);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []);
};
