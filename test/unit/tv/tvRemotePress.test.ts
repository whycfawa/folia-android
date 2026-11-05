// test/unit/tv/tvRemotePress.test.ts

import { describe, expect, it } from 'vitest';
import { createTvRemotePressTracker } from '../../../src/tv/input/tvRemotePress';

describe('createTvRemotePressTracker', () => {
    it('marks a second key-down before key-up as a long press', () => {
        const tracker = createTvRemotePressTracker();

        expect(tracker.press('right')).toBe(false);
        expect(tracker.press('right')).toBe(true);

        tracker.release('right');
        expect(tracker.press('right')).toBe(false);
    });

    it('tracks actions independently and clears all held keys on blur', () => {
        const tracker = createTvRemotePressTracker();

        expect(tracker.press('left')).toBe(false);
        expect(tracker.press('right')).toBe(false);
        expect(tracker.press('left')).toBe(true);

        tracker.clear();
        expect(tracker.press('left')).toBe(false);
        expect(tracker.press('right')).toBe(false);
    });
});
