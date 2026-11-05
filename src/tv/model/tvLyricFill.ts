// src/tv/model/tvLyricFill.ts
// Small deterministic values shared by the lyric stage and its tests.

export const clampTvFill = (value: number): number => Math.max(0, Math.min(1, value));

export const resolveTvWordFill = (time: number, startTime: number, endTime: number): number => {
    if (!Number.isFinite(time) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
    if (time < startTime) return 0;
    if (endTime <= startTime) return 1;
    return clampTvFill((time - startTime) / (endTime - startTime));
};

export const resolveTvLyricTokenOpacity = (
    time: number,
    startTime: number,
    endTime: number,
): number => {
    if (time < startTime) return 0.08;
    return 0.2 + resolveTvWordFill(time, startTime, endTime) * 0.8;
};

export const formatTvTime = (seconds: number): string => {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};
