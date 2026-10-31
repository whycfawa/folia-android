// src/utils/frameRateLimiter.ts
// Shared helpers and global RAF gate for optional visualizer frame throttling.

import { IS_ANDROID_WEBVIEW } from './platform';
import type { VisualizerFrameRate } from '../types';

type AnimationFrameCallback = FrameRequestCallback;
type RequestAnimationFrameFn = (callback: AnimationFrameCallback) => number;
type CancelAnimationFrameFn = (handle: number) => void;

type FrameRateLimitedRaf = {
    requestAnimationFrame: RequestAnimationFrameFn;
    cancelAnimationFrame: CancelAnimationFrameFn;
    setFrameRate: (frameRate: VisualizerFrameRate) => void;
    getFrameRate: () => VisualizerFrameRate;
};

type WindowWithVisualizerFrameRateLimiter = Window & {
    __foliaNativeRequestAnimationFrame?: RequestAnimationFrameFn;
    __foliaNativeCancelAnimationFrame?: CancelAnimationFrameFn;
};

export const VISUALIZER_FRAME_RATE_OPTIONS = [30, 60, 90, 120] as const satisfies VisualizerFrameRate[];
export const VISUALIZER_FRAME_RATE_STORAGE_KEY = 'visualizer_frame_rate';
const FRAME_INTERVAL_TOLERANCE_MS = 1;

export const isVisualizerFrameRate = (value: unknown): value is VisualizerFrameRate => (
    value === 'off'
    || value === 30
    || value === 120
    || value === 90
    || value === 60
);

export const parseVisualizerFrameRate = (value: string | null): VisualizerFrameRate => {
    if (value === 'off' || value === 'auto' || value === null) {
        return 'off';
    }

    const parsed = Number(value);
    return isVisualizerFrameRate(parsed) ? parsed : 'off';
};

// Decides whether a RAF tick should run under the configured FPS cap.
export const shouldProcessFrameAtRate = (
    timestampMs: number,
    lastProcessedTimestampMs: number,
    frameRate: VisualizerFrameRate,
) => {
    if (frameRate === 'off') {
        return true;
    }

    const intervalMs = 1000 / frameRate - FRAME_INTERVAL_TOLERANCE_MS;
    return lastProcessedTimestampMs === 0 || timestampMs - lastProcessedTimestampMs >= intervalMs;
};

const reportAnimationFrameCallbackError = (error: unknown) => {
    console.error('Error in requestAnimationFrame callback:', error);
    setTimeout(() => {
        throw error;
    }, 0);
};

// Creates a shared RAF queue so every callback scheduled for an allowed frame flushes together.
export const createFrameRateLimitedRaf = (
    nativeRequestAnimationFrame: RequestAnimationFrameFn,
    nativeCancelAnimationFrame: CancelAnimationFrameFn,
    initialFrameRate: VisualizerFrameRate = 60,
): FrameRateLimitedRaf => {
    let frameRate = initialFrameRate;
    let nextHandle = 1;
    let nativeFrameHandle: number | null = null;
    let lastProcessedTimestamp = 0;
    const callbacks = new Map<number, AnimationFrameCallback>();

    const scheduleNativeFrame = () => {
        if (nativeFrameHandle !== null || callbacks.size === 0) {
            return;
        }

        nativeFrameHandle = nativeRequestAnimationFrame(processNativeFrame);
    };

    const processNativeFrame = (timestamp: number) => {
        nativeFrameHandle = null;

        if (!shouldProcessFrameAtRate(timestamp, lastProcessedTimestamp, frameRate)) {
            scheduleNativeFrame();
            return;
        }

        lastProcessedTimestamp = timestamp;
        const frameHandles = Array.from(callbacks.keys());

        for (const handle of frameHandles) {
            // Match native RAF: an earlier callback may cancel a later one in the same frame.
            const callback = callbacks.get(handle);
            if (!callback) continue;
            callbacks.delete(handle);
            try {
                callback(timestamp);
            } catch (error) {
                reportAnimationFrameCallbackError(error);
            }
        }

        scheduleNativeFrame();
    };

    return {
        requestAnimationFrame: (callback) => {
            const handle = nextHandle;
            nextHandle += 1;
            callbacks.set(handle, callback);
            scheduleNativeFrame();
            return handle;
        },
        cancelAnimationFrame: (handle) => {
            callbacks.delete(handle);
            if (callbacks.size === 0 && nativeFrameHandle !== null) {
                nativeCancelAnimationFrame(nativeFrameHandle);
                nativeFrameHandle = null;
            }
        },
        setFrameRate: (nextFrameRate) => {
            frameRate = nextFrameRate;
            lastProcessedTimestamp = 0;

            if (nativeFrameHandle !== null) {
                nativeCancelAnimationFrame(nativeFrameHandle);
                nativeFrameHandle = null;
            }
            scheduleNativeFrame();
        },
        getFrameRate: () => frameRate,
    };
};

let installedLimiter: FrameRateLimitedRaf | null = null;

export const setGlobalVisualizerFrameRate = (frameRate: VisualizerFrameRate) => {
    if (typeof window === 'undefined') {
        return;
    }

    const clamped = clampVisualizerFrameRate(frameRate);
    if (clamped === 'off') {
        restoreGlobalVisualizerFrameRateLimiter();
        return;
    }

    if (!installedLimiter) {
        installGlobalVisualizerFrameRateLimiter(clamped);
        return;
    }

    installedLimiter.setFrameRate(clamped);
};

// Asks for the display's next frame, past the cap. For work that has to land in the same frame as
// something the cap does not hold back: a library that took `requestAnimationFrame` before the cap
// was switched on (framer-motion does, when its module loads) keeps running on every display frame.
export const requestUncappedAnimationFrame = (callback: AnimationFrameCallback): number => {
    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    return (frameWindow.__foliaNativeRequestAnimationFrame ?? window.requestAnimationFrame).call(window, callback);
};

// Cancels a frame asked for with `requestUncappedAnimationFrame`.
export const cancelUncappedAnimationFrame = (handle: number) => {
    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    (frameWindow.__foliaNativeCancelAnimationFrame ?? window.cancelAnimationFrame).call(window, handle);
};

export const restoreGlobalVisualizerFrameRateLimiter = () => {
    if (typeof window === 'undefined') {
        return;
    }

    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    if (frameWindow.__foliaNativeRequestAnimationFrame) {
        window.requestAnimationFrame = frameWindow.__foliaNativeRequestAnimationFrame;
    }
    if (frameWindow.__foliaNativeCancelAnimationFrame) {
        window.cancelAnimationFrame = frameWindow.__foliaNativeCancelAnimationFrame;
    }
    installedLimiter = null;
};

/**
 * 安卓上可视化器的帧率上限。
 *
 * 现场：播放页歌词卡住时 CPU/GPU 占用都不高，内存频率却一直顶格——这是显存/内存带宽打满、
 * 计算单元在等数据的典型特征。6.8MP 的表面在 120Hz 下全屏绘制，每秒要搬几十 GB，
 * 8 Gen 2 级的内存带宽扛不住。60fps 对歌词动画和跟手感都够用，带宽直接减半。
 */
export const ANDROID_MAX_VISUALIZER_FRAME_RATE = 60;

/** 把任意帧率设置钳到平台上限：安卓上「不限制」与 90/120 都按 60 处理。 */
export const clampVisualizerFrameRate = (frameRate: VisualizerFrameRate): VisualizerFrameRate => {
    if (!IS_ANDROID_WEBVIEW) return frameRate;
    if (frameRate === 'off') return ANDROID_MAX_VISUALIZER_FRAME_RATE;
    return Math.min(frameRate, ANDROID_MAX_VISUALIZER_FRAME_RATE) as VisualizerFrameRate;
};

export const installGlobalVisualizerFrameRateLimiter = (overrideFrameRate?: VisualizerFrameRate) => {
    if (typeof window === 'undefined') {
        return;
    }

    const initialFrameRate = overrideFrameRate
        ?? parseVisualizerFrameRate(window.localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY));
    // 安卓手机 WebView 上，用户**从未手动设置过**帧率时默认 30FPS：把可视化器/背景动画的 GPU
    // 绘制次数减半，明显降低发热与耗电；30fps 对音乐律动依然顺滑。这只是默认值 —— 设置里仍有
    // 30/60/90/120/不限制，用户一旦手动选过（storage 里有值）就永远以他的选择为准。
    const storedFrameRateRaw = window.localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY);
    // 安卓上从未设置过时默认 60（以前是 30：30fps 的歌词动画明显发涩，而 60 已经把带宽砍半）。
    const requestedFrameRate = initialFrameRate === 'off'
        && !overrideFrameRate
        && storedFrameRateRaw === null
        && IS_ANDROID_WEBVIEW
        ? ANDROID_MAX_VISUALIZER_FRAME_RATE
        : initialFrameRate;
    const effectiveFrameRate = clampVisualizerFrameRate(requestedFrameRate);
    if (effectiveFrameRate === 'off') {
        restoreGlobalVisualizerFrameRateLimiter();
        return;
    }

    if (installedLimiter) {
        installedLimiter.setFrameRate(effectiveFrameRate);
        return;
    }

    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    frameWindow.__foliaNativeRequestAnimationFrame ??= window.requestAnimationFrame;
    frameWindow.__foliaNativeCancelAnimationFrame ??= window.cancelAnimationFrame;
    const nativeRequestAnimationFrame: RequestAnimationFrameFn = (callback) => (
        frameWindow.__foliaNativeRequestAnimationFrame?.call(window, callback) ?? 0
    );
    const nativeCancelAnimationFrame: CancelAnimationFrameFn = (handle) => {
        frameWindow.__foliaNativeCancelAnimationFrame?.call(window, handle);
    };
    installedLimiter = createFrameRateLimitedRaf(nativeRequestAnimationFrame, nativeCancelAnimationFrame, effectiveFrameRate);

    window.requestAnimationFrame = installedLimiter.requestAnimationFrame;
    window.cancelAnimationFrame = installedLimiter.cancelAnimationFrame;
};
