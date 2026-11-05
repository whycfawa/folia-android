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
    const groupRoot = element.closest<HTMLElement>('[data-tv-focus-group]');
    const groupAxis = groupRoot?.dataset.tvFocusAxis;
    const groupEntry = groupRoot?.dataset.tvFocusEntry;
    const containerRoot = element.closest<HTMLElement>('[data-tv-focus-container]');
    return {
        id: key,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        group: groupRoot?.dataset.tvFocusGroup,
        groupAxis: groupAxis === 'horizontal' || groupAxis === 'vertical'
            ? groupAxis
            : undefined,
        groupEntry: groupEntry === 'selected' ? groupEntry : undefined,
        selected: element.getAttribute('aria-selected') === 'true',
        container: containerRoot?.dataset.tvFocusContainer,
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
    const entryFocusRef = useRef<{
        layer: TvLayerId;
        key: string | null;
        preferredKey?: string;
        source: 'memory' | 'default' | 'fallback';
    } | null>(null);
    const activeLayerRef = useRef(activeLayer);
    const focusDefaultRef = useRef(defaultFocusKey);
    const resetMemoryLayersRef = useRef(resetMemoryLayers);
    const activeDefaultFocusKey = defaultFocusKey?.[activeLayer];
    activeLayerRef.current = activeLayer;
    focusDefaultRef.current = defaultFocusKey;
    resetMemoryLayersRef.current = resetMemoryLayers;

    const focusPreferred = useCallback((layer: TvLayerId) => {
        if (!resetMemoryLayersRef.current.includes(layer)) {
            const remembered = memoryRef.current[layer];
            if (remembered && focusTvElementByKey(layer, remembered)) {
                entryFocusRef.current = {
                    layer,
                    key: remembered,
                    preferredKey: focusDefaultRef.current?.[layer],
                    source: 'memory',
                };
                return;
            }
        }

        const preferred = focusDefaultRef.current?.[layer];
        if (preferred && focusTvElementByKey(layer, preferred)) {
            entryFocusRef.current = {
                layer,
                key: preferred,
                preferredKey: preferred,
                source: 'default',
            };
            return;
        }

        const fallback = getTvFocusableElements(layer)[0] ?? null;
        focusTvElement(fallback);
        entryFocusRef.current = {
            layer,
            key: fallback?.dataset.tvFocusKey ?? null,
            preferredKey: preferred,
            source: 'fallback',
        };
    }, []);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            const current = getActiveTvFocusElement();
            const currentKey = current?.dataset.tvFocusKey ?? null;
            const preferredKey = focusDefaultRef.current?.[activeLayer];
            const entry = entryFocusRef.current;
            if (isElementInLayer(current, activeLayer)) {
                if (
                    entry?.layer === activeLayer
                    && currentKey === entry.key
                    && preferredKey
                    && preferredKey !== entry.preferredKey
                ) {
                    focusPreferred(activeLayer);
                }
                return;
            }

            if (activeLayer === 'player') {
                current?.blur();
                entryFocusRef.current = null;
                return;
            }

            focusPreferred(activeLayer);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeDefaultFocusKey, activeLayer, contentKey, focusPreferred]);

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
                const currentKey = current?.dataset.tvFocusKey ?? null;
                const preferredKey = focusDefaultRef.current?.[layer];
                const entry = entryFocusRef.current;
                if (isElementInLayer(current, layer)) {
                    if (
                        entry?.layer === layer
                        && currentKey === entry.key
                        && preferredKey
                        && (entry.source === 'fallback' || preferredKey !== entry.preferredKey)
                    ) {
                        focusPreferred(layer);
                    }
                    return;
                }
                focusPreferred(layer);
            });
        });
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-disabled', 'disabled', 'hidden', 'style'],
        });
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
