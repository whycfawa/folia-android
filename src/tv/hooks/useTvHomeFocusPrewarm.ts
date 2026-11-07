import { useEffect, useRef } from 'react';
import { useTvPerformanceProfile } from './useTvPerformanceProfile';

// src/tv/hooks/useTvHomeFocusPrewarm.ts

const PREWARM_CARD_LIMIT = 4;
const PREWARM_IDLE_TIMEOUT_MS = 900;

type IdleWindow = Window & {
    requestIdleCallback?: (
        callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
        options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
};

/**
 * Pays WebView's one-time first-card focus cost while the hero still owns focus.
 * The focus pass is synchronous and restores the original element before paint, so it cannot
 * visibly move focus or scroll the home page.
 */
export const useTvHomeFocusPrewarm = (ready: boolean, contentKey: string) => {
    const profile = useTvPerformanceProfile();
    const warmedKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!ready || profile.tier !== 'constrained') return undefined;

        const idleWindow = window as IdleWindow;
        let cancelled = false;
        let idleHandle: number | null = null;
        let timeoutHandle: number | null = null;
        let frame = 0;

        const run = () => {
            if (cancelled) return;
            const layer = document.getElementById('tv-layer-home');
            const origin = document.activeElement;
            if (
                !layer
                || layer.hasAttribute('inert')
                || !(origin instanceof HTMLElement)
                || origin.dataset.tvFocusKey !== 'home-hero'
            ) {
                return;
            }

            const firstRow = layer.querySelector<HTMLElement>(
                '.tv-row-scroll[data-tv-focus-group="home-liked"]',
            );
            const candidates = Array.from(
                firstRow?.querySelectorAll<HTMLElement>('[data-tv-focusable="true"]') ?? [],
            ).slice(0, PREWARM_CARD_LIMIT);
            const key = candidates
                .map(candidate => candidate.dataset.tvFocusKey ?? '')
                .join('|');
            if (!key || warmedKeyRef.current === key) return;

            try {
                for (const candidate of candidates) {
                    candidate.focus({ preventScroll: true });
                }
            } finally {
                origin.focus({ preventScroll: true });
            }
            warmedKeyRef.current = key;
        };

        frame = window.requestAnimationFrame(() => {
            frame = window.requestAnimationFrame(() => {
                if (cancelled) return;
                if (typeof idleWindow.requestIdleCallback === 'function') {
                    idleHandle = idleWindow.requestIdleCallback(run, {
                        timeout: PREWARM_IDLE_TIMEOUT_MS,
                    });
                } else {
                    timeoutHandle = window.setTimeout(run, 0);
                }
            });
        });

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
            if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
            if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
        };
    }, [contentKey, profile.tier, ready]);
};
