import { IS_ANDROID_WEBVIEW } from '../utils/platform';
import { VISUALIZER_FRAME_RATE_STORAGE_KEY, parseVisualizerFrameRate } from '../utils/frameRateLimiter';
import type { VisualizerFrameRate } from '../types';

// src/services/androidDisplayFrameRate.ts
// 把「动画帧率限制」这个设置同时交给系统：只靠 requestAnimationFrame 的上限，屏幕在没触摸输入时
// 会自己回落到 60Hz，页面上限是 120 也没有用。安卓 16 起可以按 View 申请刷新率，更早的系统只能
// 改窗口的 preferredRefreshRate；不限制时撤回申请，交回系统自适应。系统可以不理这个申请，所以
// 同一个文件也提供读回现场（当前刷新率、屏幕档位、申请值）给诊断报告，靠数据判断是谁降的。

type DisplayFrameRatePlugin = {
    setDisplayFrameRate?: (options: { fps: number }) => Promise<unknown>;
    getDisplayFrameRateInfo?: () => Promise<unknown>;
    sampleDisplayFrameRate?: (options: { durationMs: number }) => Promise<unknown>;
    getDisplayFrameRateJournal?: () => Promise<unknown>;
};

/** 诊断报告里的一行「系统此刻的刷新率现场」。字段缺失就是这台机器/这个内核答不出来。 */
export type DisplayFrameRateInfo = {
    refreshRate?: number;
    modeId?: number;
    modeRefreshRate?: number;
    modeWidth?: number;
    modeHeight?: number;
    supportedModes?: string[];
    preferredRefreshRate?: number;
    preferredMinRefreshRate?: number;
    preferredMaxRefreshRate?: number;
    requestedFrameRate?: number;
    screenOn?: boolean;
    /** 原生侧读不到时给出的原因（替代整段 unavailable）。 */
    error?: string;
};

export type DisplayFrameRateSample = {
    samples: number[];
    requestedFrameRate?: number;
};

const displayFrameRatePlugin = (): DisplayFrameRatePlugin | null => {
    const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, DisplayFrameRatePlugin> } }).Capacitor;
    return capacitor?.Plugins?.FoliaNative ?? null;
};

/** 最近一次申请的结果，给诊断报告：原生是否真的收下了、读回的请求值是多少。 */
export type DisplayFrameRateRequestResult = {
    fps: number;
    at: string;
    ok: boolean;
    /** View 层真实的读回请求值；负数表示 View 没有认下这个请求。 */
    viewReadback?: number;
    /** 窗口的 preferredRefreshRate，窗口路径实际设置的值。 */
    windowPreferred?: number;
    /** 安卓 15 起的窗口刷新率下限/上限（一加这类系统只认这一对）。 */
    windowMin?: number;
    windowMax?: number;
    /** 窗口指定的显示模式 id；屏幕的模式列表里 1 通常是 120Hz。 */
    windowModeId?: number;
    error?: string;
};

let lastRequest: DisplayFrameRateRequestResult | null = null;

export const readLastDisplayFrameRateRequest = (): DisplayFrameRateRequestResult | null => lastRequest;

/** 申请一个刷新率；'off' 表示撤回申请。非安卓或没有原生桥时什么都不做。 */
export const applyAndroidDisplayFrameRate = (frameRate: VisualizerFrameRate): void => {
    if (!IS_ANDROID_WEBVIEW) return;
    const plugin = displayFrameRatePlugin();
    if (!plugin?.setDisplayFrameRate) return;
    const fps = frameRate === 'off' ? 0 : frameRate;
    const at = new Date().toISOString();
    void Promise.resolve(plugin.setDisplayFrameRate({ fps }))
        .then((result) => {
            const answer = result as {
                viewReadback?: unknown;
                windowPreferred?: unknown;
                windowMin?: unknown;
                windowMax?: unknown;
                windowModeId?: unknown;
            } | null;
            lastRequest = {
                fps,
                at,
                ok: true,
                ...(typeof answer?.viewReadback === 'number' ? { viewReadback: answer.viewReadback } : {}),
                ...(typeof answer?.windowPreferred === 'number' ? { windowPreferred: answer.windowPreferred } : {}),
                ...(typeof answer?.windowMin === 'number' ? { windowMin: answer.windowMin } : {}),
                ...(typeof answer?.windowMax === 'number' ? { windowMax: answer.windowMax } : {}),
                ...(typeof answer?.windowModeId === 'number' ? { windowModeId: answer.windowModeId } : {}),
            };
        })
        .catch((error: unknown) => {
            lastRequest = { fps, at, ok: false, error: error instanceof Error ? error.message : String(error) };
            console.warn('[DisplayFrameRate] Native frame-rate request failed', error);
        });
};

/** 最近 5 分钟的系统刷新率序列；没有原生桥时返回 null。 */
export const readAndroidDisplayFrameRateJournal = async (): Promise<Array<{ ageMs: number; hz: number }> | null> => {
    if (!IS_ANDROID_WEBVIEW) return null;
    const plugin = displayFrameRatePlugin();
    if (!plugin?.getDisplayFrameRateJournal) return null;
    try {
        const result = await withTimeout(plugin.getDisplayFrameRateJournal() as Promise<{ samples?: Array<[number, number]>; error?: string }>, 1500, null);
        if (result?.error) {
            console.warn('[DisplayFrameRate] Display frame-rate journal unavailable:', result.error);
            return null;
        }
        const samples = result?.samples;
        if (!Array.isArray(samples)) return null;
        return samples
            .filter(sample => Array.isArray(sample) && typeof sample[0] === 'number' && typeof sample[1] === 'number')
            .map(sample => ({ ageMs: sample[0], hz: sample[1] }));
    } catch (error) {
        console.warn('[DisplayFrameRate] Display frame-rate journal failed', error);
        return null;
    }
};

/** 启动时按保存的档位申请一次；没设置过就是 'off'（不申请）。 */
export const installAndroidDisplayFrameRate = (): void => {
    if (typeof window === 'undefined') return;
    applyAndroidDisplayFrameRate(parseVisualizerFrameRate(window.localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY)));
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
};

/** 读一次系统刷新率现场；非安卓或没有原生桥时返回 null。 */
export const readAndroidDisplayFrameRateInfo = async (): Promise<DisplayFrameRateInfo | null> => {
    if (!IS_ANDROID_WEBVIEW) return null;
    const plugin = displayFrameRatePlugin();
    if (!plugin?.getDisplayFrameRateInfo) return null;
    try {
        return await withTimeout(plugin.getDisplayFrameRateInfo() as Promise<DisplayFrameRateInfo>, 1500, null);
    } catch (error) {
        console.warn('[DisplayFrameRate] Display frame-rate info failed', error);
        return null;
    }
};

/** 连续采样一段时间的系统刷新率（默认 2 秒，每 100ms 一个点）；抓不到时返回 null。 */
export const sampleAndroidDisplayFrameRate = async (durationMs = 2000): Promise<DisplayFrameRateSample | null> => {
    if (!IS_ANDROID_WEBVIEW) return null;
    const plugin = displayFrameRatePlugin();
    if (!plugin?.sampleDisplayFrameRate) return null;
    try {
        return await withTimeout(plugin.sampleDisplayFrameRate({ durationMs }) as Promise<DisplayFrameRateSample>, durationMs + 1500, null);
    } catch (error) {
        console.warn('[DisplayFrameRate] Display frame-rate sample failed', error);
        return null;
    }
};
