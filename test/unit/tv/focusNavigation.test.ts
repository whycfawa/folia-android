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
});

