// src/tv/input/focusDom.ts
// DOM helpers for the TV focus layer. Focusable controls opt in explicitly; nothing here relies on
// sequential Tab order or browser default button focus.

export type TvLayerId =
    | 'home'
    | 'player'
    | 'controls'
    | 'effects'
    | 'queue'
    | 'collection'
    | 'search'
    | 'login'
    | 'exit';

const FOCUSABLE_SELECTOR = '[data-tv-focusable="true"]:not(:disabled):not([aria-disabled="true"])';

export const getActiveTvFocusElement = (): HTMLElement | null => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.matches(FOCUSABLE_SELECTOR) ? active : null;
};

export const getTvFocusableElements = (layer: TvLayerId): HTMLElement[] => {
    const root = document.getElementById(`tv-layer-${layer}`);
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => (
        element.getClientRects().length > 0
    ));
};

export const focusTvElement = (element: HTMLElement | null): boolean => {
    if (!element) return false;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    return document.activeElement === element;
};

export const focusTvElementByKey = (layer: TvLayerId, focusKey: string): boolean => {
    const element = getTvFocusableElements(layer).find(candidate => candidate.dataset.tvFocusKey === focusKey);
    return focusTvElement(element ?? null);
};

export const clickFocusedTvElement = (): boolean => {
    const element = getActiveTvFocusElement();
    if (!element) return false;
    element.click();
    return true;
};
