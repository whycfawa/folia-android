// src/tv/hooks/useTvFocus.ts
// Keeps focus inside the visible TV layer and remembers the last item in each layer, so returning
// from the player lands back on the card the listener came from instead of the first row.

import { useCallback, useEffect, useRef } from 'react';
import type { TvDirection } from '../input/focusNavigation';
import { pickNextFocusRect, type TvFocusRect } from '../input/focusNavigation';
import {
    focusTvElement,
    focusTvElementByKey,
    getActiveTvFocusElement,
    getTvFocusableElements,
    type TvLayerId,
} from '../input/focusDom';

const toRect = (element: HTMLElement): TvFocusRect | null => {
    const key = element.dataset.tvFocusKey;
    if (!key) return null;
    const rect = element.getBoundingClientRect();
    return {
        id: key,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };
};

const isElementInLayer = (element: HTMLElement | null, layer: TvLayerId): boolean => (
    Boolean(element?.closest(`#tv-layer-${layer}`))
);

export const useTvFocus = (
    activeLayer: TvLayerId,
    contentKey: string,
    defaultFocusKey?: Partial<Record<TvLayerId, string>>,
    resetMemoryLayers: readonly TvLayerId[] = [],
) => {
    const memoryRef = useRef<Partial<Record<TvLayerId, string>>>({});
    const activeLayerRef = useRef(activeLayer);
    const focusDefaultRef = useRef(defaultFocusKey);
    const resetMemoryLayersRef = useRef(resetMemoryLayers);
    activeLayerRef.current = activeLayer;
    focusDefaultRef.current = defaultFocusKey;
    resetMemoryLayersRef.current = resetMemoryLayers;

    const focusPreferred = useCallback((layer: TvLayerId) => {
        if (!resetMemoryLayersRef.current.includes(layer)) {
            const remembered = memoryRef.current[layer];
            if (remembered && focusTvElementByKey(layer, remembered)) return;
        }

        const preferred = focusDefaultRef.current?.[layer];
        if (preferred && focusTvElementByKey(layer, preferred)) return;

        focusTvElement(getTvFocusableElements(layer)[0] ?? null);
    }, []);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            const current = getActiveTvFocusElement();
            if (isElementInLayer(current, activeLayer)) return;

            if (activeLayer === 'player') {
                current?.blur();
                return;
            }

            focusPreferred(activeLayer);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeLayer, contentKey, focusPreferred]);

    useEffect(() => {
        if (activeLayer === 'player') return undefined;
        const root = document.getElementById(`tv-layer-${activeLayer}`);
        if (!root) return undefined;

        let frame = 0;
        const observer = new MutationObserver(() => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                const layer = activeLayerRef.current;
                if (layer === 'player') return;
                const current = getActiveTvFocusElement();
                if (isElementInLayer(current, layer)) return;
                focusPreferred(layer);
            });
        });
        observer.observe(root, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            window.cancelAnimationFrame(frame);
        };
    }, [activeLayer, focusPreferred]);

    useEffect(() => {
        const rememberFocus = (event: FocusEvent) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            const key = target?.dataset.tvFocusKey;
            const layerRoot = target?.closest<HTMLElement>('[data-tv-layer]');
            const layer = layerRoot?.dataset.tvLayer as TvLayerId | undefined;
            if (!key || !layer) return;
            memoryRef.current[layer] = key;
        };

        window.addEventListener('focusin', rememberFocus);
        return () => window.removeEventListener('focusin', rememberFocus);
    }, []);

    const moveFocus = useCallback((direction: TvDirection): boolean => {
        const layer = activeLayerRef.current;
        const elements = getTvFocusableElements(layer);
        if (elements.length === 0) return false;

        const activeElement = getActiveTvFocusElement();
        const rects = elements.flatMap(element => {
            const rect = toRect(element);
            return rect ? [rect] : [];
        });
        const next = pickNextFocusRect(rects, activeElement?.dataset.tvFocusKey ?? null, direction);
        if (!next || next.id === activeElement?.dataset.tvFocusKey) return true;

        focusTvElementByKey(layer, next.id);
        return true;
    }, []);

    return {
        moveFocus,
        focusKey: focusTvElementByKey,
        focusLayer: focusPreferred,
    };
};
