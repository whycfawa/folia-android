// src/tv/hooks/useTvControlsAutoHide.ts

import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_TV_CONTROLS_HIDE_MS = 7_500;

/** Hides the control deck after the listener stops pressing the remote. */
export const useTvControlsAutoHide = ({
    active,
    onHide,
    timeoutMs = DEFAULT_TV_CONTROLS_HIDE_MS,
}: {
    active: boolean;
    onHide: () => void;
    timeoutMs?: number;
}): () => void => {
    const timerRef = useRef<number | null>(null);
    const onHideRef = useRef(onHide);
    onHideRef.current = onHide;

    const clearTimer = useCallback(() => {
        if (timerRef.current === null) return;
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const touch = useCallback(() => {
        clearTimer();
        if (!active) return;
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            onHideRef.current();
        }, timeoutMs);
    }, [active, clearTimer, timeoutMs]);

    useEffect(() => {
        touch();
        return clearTimer;
    }, [clearTimer, touch]);

    return touch;
};

