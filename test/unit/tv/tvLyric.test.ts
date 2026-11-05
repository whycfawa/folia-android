// test/unit/tv/tvLyric.test.ts

import { describe, expect, it } from 'vitest';
import type { Line } from '../../../src/types';
import {
    clampTvFill,
    formatTvTime,
    resolveTvLyricTokenOpacity,
    resolveTvWordFill,
} from '../../../src/tv/model/tvLyricFill';
import { findTvActiveLineIndex } from '../../../src/tv/model/tvLyricTimeline';

const line = (startTime: number): Line => ({
    words: [],
    startTime,
    endTime: startTime + 2,
    fullText: String(startTime),
});

describe('TV lyric fill', () => {
    it('clamps progress and handles a zero-length word', () => {
        expect(clampTvFill(-1)).toBe(0);
        expect(clampTvFill(2)).toBe(1);
        expect(resolveTvWordFill(1, 0, 2)).toBe(0.5);
        expect(resolveTvWordFill(1, 1, 1)).toBe(1);
        expect(resolveTvWordFill(Number.NaN, 0, 2)).toBe(0);
    });

    it('keeps the per-character lyric fill intact without a scale animation', () => {
        expect(resolveTvLyricTokenOpacity(-1, 0, 2)).toBe(0.08);
        expect(resolveTvLyricTokenOpacity(0, 0, 2)).toBeCloseTo(0.2);
        expect(resolveTvLyricTokenOpacity(1, 0, 2)).toBeCloseTo(0.6);
        expect(resolveTvLyricTokenOpacity(2, 0, 2)).toBe(1);
    });

    it('formats a TV clock without negative time', () => {
        expect(formatTvTime(0)).toBe('0:00');
        expect(formatTvTime(65.9)).toBe('1:05');
        expect(formatTvTime(-3)).toBe('0:00');
    });
});

describe('findTvActiveLineIndex', () => {
    const lines = [line(0), line(4), line(8), line(12)];

    it('finds the last line whose start has been reached', () => {
        expect(findTvActiveLineIndex(lines, -1)).toBe(-1);
        expect(findTvActiveLineIndex(lines, 0)).toBe(0);
        expect(findTvActiveLineIndex(lines, 7.9)).toBe(1);
        expect(findTvActiveLineIndex(lines, 12)).toBe(3);
        expect(findTvActiveLineIndex(lines, 99)).toBe(3);
    });
});

