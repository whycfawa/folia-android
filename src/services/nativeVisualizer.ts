// src/services/nativeVisualizer.ts
//
// 原生可视化器（试验）：把「整屏背景 + 频谱条」交给 Android 的 GL 线程画，页面只把音频参数推过去。
//
// 为什么这么做：播放页的可视化器在 WebView 的 6.8MP 合成面上做全屏 shader / 模糊，代价与屏幕像素数成正比；
// 挪到独立 Surface 后，这一层不再经过 Chromium 合成器。UI 与歌词仍由 WebView 渲染。
//
// 开关存在 localStorage；启用时页面把自己和可视化器那一层调透明，让原生层透出来。任何一步失败都只是
// 这次不生效（页面保持原样），不会抛到调用方。

import { audioPower, spectrum } from '../stores/motionSignals';

export const NATIVE_VISUALIZER_STORAGE_KEY = 'folia_native_visualizer';

type NativeVisualizerPlugin = {
    start?: () => Promise<unknown>;
    stop?: () => Promise<unknown>;
    push?: (options: { bands: number[]; power: number; primary: number; accent: number }) => Promise<unknown>;
};

const BAND_COUNT = 32;
/** JS 推参数的频率：20Hz 足够，避免每帧过桥。 */
const PUSH_INTERVAL_MS = 50;

let timer: number | null = null;
let running = false;

const getPlugin = (): NativeVisualizerPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Record<string, NativeVisualizerPlugin> };
    }).Capacitor;
    if (!capacitor) return null;
    const native = capacitor.isNativePlatform?.() === true || capacitor.getPlatform?.() === 'android';
    if (!native) return null;
    return capacitor.Plugins?.FoliaNativeVisualizer ?? null;
};

const readColor = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const hex = value.trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
    return 0xFF000000 | Number.parseInt(hex, 16);
};

const readThemeColors = (): { primary: number; accent: number } => {
    const root = typeof document === 'undefined' ? null : document.documentElement;
    const style = root ? getComputedStyle(root) : null;
    return {
        primary: readColor(style?.getPropertyValue('--text-accent').trim(), 0xFF74EFD0),
        accent: readColor(style?.getPropertyValue('--text-primary').trim(), 0xFFFFFFFF),
    };
};

const buildBands = (): number[] => {
    const data = spectrum.get();
    if (!data || data.length === 0) return new Array(BAND_COUNT).fill(0);
    const bands: number[] = [];
    for (let i = 0; i < BAND_COUNT; i++) {
        const start = Math.floor((data.length * i) / BAND_COUNT);
        const end = Math.max(start + 1, Math.floor((data.length * (i + 1)) / BAND_COUNT));
        let sum = 0;
        for (let index = start; index < end; index++) sum += data[index] ?? 0;
        bands.push(Math.round(sum / (end - start)));
    }
    return bands;
};

const pushOnce = (plugin: NativeVisualizerPlugin) => {
    const colors = readThemeColors();
    void plugin.push?.({
        bands: buildBands(),
        // audioPower 是 0..255 的响度曲线（见 usePlaybackVisualizerBridge）。
        power: Math.max(0, Math.min(255, Math.round(audioPower.get()))),
        primary: colors.primary,
        accent: colors.accent,
    })?.catch?.(() => undefined);
};

/** 打开原生渲染层；插件不存在（桌面 / 浏览器）时返回 false。 */
export const startNativeVisualizer = async (): Promise<boolean> => {
    const plugin = getPlugin();
    if (!plugin?.start) return false;
    if (running) return true;
    try {
        await plugin.start();
        running = true;
        document.documentElement.setAttribute('data-native-visualizer', 'on');
        timer = window.setInterval(() => pushOnce(plugin), PUSH_INTERVAL_MS);
        return true;
    } catch {
        return false;
    }
};

/** 关掉原生渲染层并撤掉页面的透明态。 */
export const stopNativeVisualizer = async (): Promise<void> => {
    if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
    }
    document.documentElement.removeAttribute('data-native-visualizer');
    if (!running) return;
    running = false;
    try {
        await getPlugin()?.stop?.();
    } catch {
        // 关不掉也只是多留一个看不见的 Surface；下次 start 会复用。
    }
};

export const isNativeVisualizerEnabled = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(NATIVE_VISUALIZER_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export const setNativeVisualizerEnabled = async (enabled: boolean): Promise<boolean> => {
    try {
        localStorage.setItem(NATIVE_VISUALIZER_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
        // 存不下来也只影响下一次启动。
    }
    if (!enabled) {
        await stopNativeVisualizer();
        return true;
    }
    return startNativeVisualizer();
};
