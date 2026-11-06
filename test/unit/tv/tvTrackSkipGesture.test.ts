// test/unit/tv/tvTrackSkipGesture.test.ts

import { describe, expect, it } from 'vitest';
import {
    createTvTrackSkipGesture,
    TV_TRACK_SKIP_INTERVAL_MS,
} from '../../../src/tv/input/tvTrackSkipGesture';

describe('TV track skip gesture', () => {
    it('skips after two presses in the same direction inside the time window', () => {
        const gesture = createTvTrackSkipGesture(420);

        expect(gesture.press('left', 1_000)).toBe(false);
        expect(gesture.press('left', 1_200)).toBe(true);
        expect(gesture.press('left', 1_250)).toBe(false);
    });

    it('does not pair different directions or presses outside the time window', () => {
        const gesture = createTvTrackSkipGesture(420);

        expect(gesture.press('left', 1_000)).toBe(false);
        expect(gesture.press('right', 1_100)).toBe(false);
        expect(gesture.press('right', 1_600)).toBe(false);
    });

    it('recognizes a second press at the configured reveal deadline', () => {
        const gesture = createTvTrackSkipGesture();

        expect(gesture.press('right', 1_000)).toBe(false);
        expect(gesture.press('right', 1_000 + TV_TRACK_SKIP_INTERVAL_MS)).toBe(true);
    });

    it('can be cleared when focus moves to another control layer', () => {
        const gesture = createTvTrackSkipGesture();

        expect(gesture.press('right', 1_000)).toBe(false);
        gesture.clear();
        expect(gesture.press('right', 1_100)).toBe(false);
    });
});
