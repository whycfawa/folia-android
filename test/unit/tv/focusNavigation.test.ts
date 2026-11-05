// test/unit/tv/focusNavigation.test.ts

import { describe, expect, it } from 'vitest';
import { pickNextFocusRect, type TvFocusRect } from '../../../src/tv/input/focusNavigation';

const rect = (id: string, left: number, top: number, width = 100, height = 80): TvFocusRect => ({
    id,
    left,
    top,
    right: left + width,
    bottom: top + height,
});

const groupedRect = (
    id: string,
    left: number,
    top: number,
    group: string,
    groupAxis: 'horizontal' | 'vertical',
): TvFocusRect => ({
    ...rect(id, left, top),
    group,
    groupAxis,
});

const scopedRect = (
    id: string,
    left: number,
    top: number,
    container: string,
): TvFocusRect => ({
    ...rect(id, left, top),
    container,
});

describe('pickNextFocusRect', () => {
    const grid = [
        rect('top-left', 0, 0),
        rect('top-right', 300, 0),
        rect('bottom-left', 0, 200),
        rect('bottom-right', 300, 200),
    ];

    it('moves through a geometric grid', () => {
        expect(pickNextFocusRect(grid, 'top-left', 'right')?.id).toBe('top-right');
        expect(pickNextFocusRect(grid, 'top-left', 'down')?.id).toBe('bottom-left');
        expect(pickNextFocusRect(grid, 'bottom-right', 'left')?.id).toBe('bottom-left');
        expect(pickNextFocusRect(grid, 'bottom-right', 'up')?.id).toBe('top-right');
    });

    it('prefers a row aligned with the current focus', () => {
        const rows = [
            rect('current', 0, 0),
            rect('aligned', 260, 5),
            rect('diagonal', 180, 180),
        ];
        expect(pickNextFocusRect(rows, 'current', 'right')?.id).toBe('aligned');
    });

    it('moves from header controls into the nearest full-width section', () => {
        const page = [
            rect('account', 716, 27, 196, 52),
            rect('hero', 48, 99, 864, 250),
            rect('far-card', 708, 900, 200, 274),
        ];

        expect(pickNextFocusRect(page, 'account', 'down')?.id).toBe('hero');
        expect(pickNextFocusRect(page, 'hero', 'up')?.id).toBe('account');
    });

    it('keeps vertical focus inside the scrolling home body before leaving to the header', () => {
        const scrolledPage = [
            rect('account', 716, 27, 196, 52),
            scopedRect('hero', 48, -376, 'home-body'),
            scopedRect('first-row', 48, 244, 'home-body'),
        ];
        const topPage = [
            rect('account', 716, 27, 196, 52),
            scopedRect('hero', 48, 99, 'home-body'),
            scopedRect('first-row', 48, 405, 'home-body'),
        ];

        expect(pickNextFocusRect(scrolledPage, 'first-row', 'up')?.id).toBe('hero');
        expect(pickNextFocusRect(topPage, 'first-row', 'up')?.id).toBe('hero');
        expect(pickNextFocusRect(topPage, 'hero', 'up')?.id).toBe('account');
    });

    it('stays put at an edge and picks the first item without current focus', () => {
        expect(pickNextFocusRect(grid, 'top-left', 'left')?.id).toBe('top-left');
        expect(pickNextFocusRect(grid, null, 'down')?.id).toBe('top-left');
    });

    it('breaks exact ties deterministically', () => {
        const ties = [
            rect('current', 0, 0),
            rect('b', 300, 0),
            rect('a', 300, 0),
        ];
        expect(pickNextFocusRect(ties, 'current', 'right')?.id).toBe('a');
    });

    it('keeps horizontal media-row focus inside the row', () => {
        const rows = [
            groupedRect('hero', 0, 0, 'hero', 'horizontal'),
            groupedRect('row-a-1', 0, 200, 'row-a', 'horizontal'),
            groupedRect('row-a-2', 260, 200, 'row-a', 'horizontal'),
            groupedRect('row-b-1', 0, 400, 'row-b', 'horizontal'),
            groupedRect('account', 900, 0, 'account', 'horizontal'),
        ];

        expect(pickNextFocusRect(rows, 'row-a-2', 'right')?.id).toBe('row-a-2');
        expect(pickNextFocusRect(rows, 'row-a-2', 'down')?.id).toBe('row-b-1');
    });

    it('moves through a wrapped grid when its group has no axis lock', () => {
        const grid = [
            { ...rect('lyrics-1', 0, 0), group: 'effects-lyrics' },
            { ...rect('lyrics-2', 120, 0), group: 'effects-lyrics' },
            { ...rect('lyrics-3', 240, 0), group: 'effects-lyrics' },
            { ...rect('lyrics-4', 0, 100), group: 'effects-lyrics' },
            { ...rect('lyrics-5', 120, 100), group: 'effects-lyrics' },
            { ...rect('background-1', 0, 220), group: 'effects-backgrounds' },
        ];

        expect(pickNextFocusRect(grid, 'lyrics-2', 'down')?.id).toBe('lyrics-5');
        expect(pickNextFocusRect(grid, 'lyrics-5', 'down')?.id).toBe('background-1');
        expect(pickNextFocusRect(grid, 'lyrics-2', 'right')?.id).toBe('lyrics-3');
    });

    it('keeps vertical movement inside the list and allows lateral exit', () => {
        const list = [
            groupedRect('close', 900, 0, 'close', 'horizontal'),
            groupedRect('track-1', 0, 100, 'tracks', 'vertical'),
            groupedRect('track-2', 0, 200, 'tracks', 'vertical'),
        ];

        expect(pickNextFocusRect(list, 'track-2', 'down')?.id).toBe('track-2');
        expect(pickNextFocusRect(list, 'track-2', 'up')?.id).toBe('track-1');
        expect(pickNextFocusRect(list, 'track-2', 'right')?.id).toBe('close');
    });

    it('keeps a single horizontal group locked and lets a vertical boundary fall through', () => {
        const items = [
            groupedRect('only-card', 0, 200, 'single-row', 'horizontal'),
            groupedRect('account', 900, 0, 'account', 'horizontal'),
            groupedRect('only-provider', 0, 400, 'single-provider', 'vertical'),
            groupedRect('detail-action', 300, 500, 'detail', 'horizontal'),
        ];

        expect(pickNextFocusRect(items, 'only-card', 'right')?.id).toBe('only-card');
        expect(pickNextFocusRect(items, 'only-provider', 'right')?.id).toBe('detail-action');
        expect(pickNextFocusRect(items, 'only-provider', 'down')?.id).toBe('detail-action');
    });

    it('enters a tab group on its selected item without blocking later lateral moves', () => {
        const tabs = [
            { ...groupedRect('tab-playlists', 48, 91, 'tabs', 'horizontal'), groupEntry: 'selected' as const },
            { ...groupedRect('tab-radio', 160, 91, 'tabs', 'horizontal'), groupEntry: 'selected' as const, selected: true },
            { ...groupedRect('tab-albums', 272, 91, 'tabs', 'horizontal'), groupEntry: 'selected' as const },
            rect('hero', 48, 156, 864, 250),
        ];

        expect(pickNextFocusRect(tabs, 'hero', 'up')?.id).toBe('tab-radio');
        expect(pickNextFocusRect(tabs, 'tab-radio', 'right')?.id).toBe('tab-albums');
    });

    it('exits a vertical list at its boundary into adjacent chrome', () => {
        const list = [
            groupedRect('play-all', 0, 0, 'play-all', 'horizontal'),
            groupedRect('track-1', 0, 100, 'tracks', 'vertical'),
            groupedRect('track-2', 0, 200, 'tracks', 'vertical'),
            groupedRect('footer-action', 0, 320, 'footer', 'horizontal'),
        ];

        expect(pickNextFocusRect(list, 'track-1', 'up')?.id).toBe('play-all');
        expect(pickNextFocusRect(list, 'track-2', 'down')?.id).toBe('footer-action');
    });
});

