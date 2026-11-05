// src/tv/model/tvLyricTimeline.ts

import type { Line } from '../../types';

/** Last line whose start time has been reached. A binary search keeps 30fps updates cheap. */
export const findTvActiveLineIndex = (lines: readonly Line[], time: number): number => {
    let low = 0;
    let high = lines.length - 1;
    let match = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (lines[middle]!.startTime <= time) {
            match = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return match;
};

