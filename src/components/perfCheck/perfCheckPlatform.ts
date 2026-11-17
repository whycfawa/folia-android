import { IS_ANDROID_WEBVIEW } from '../../utils/platform';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import type { PerfCheckProcessMemory, PerfCheckSettings } from './perfCheckTypes';

// src/components/perfCheck/perfCheckPlatform.ts
// 性能检测在两种壳里的差异：进程内存只有 Electron 主进程拿得到；「应用建议」在桌面上交给主窗口，
// 在安卓上直接写回设置（没有第二个窗口可以交接）。安卓的显示刷新率由 runner 用最短帧间隔实测，
// 不依赖主进程那一份。

/** 进程内存（含 GPU 进程）与系统报的刷新率；安卓没有主进程，返回 null 让 runner 退回实测。 */
export const readPerfCheckMetrics = async (): Promise<PerfCheckProcessMemory | null> => {
    const fromElectron = await window.electron?.getPerfCheckMetrics?.().catch(() => null);
    return fromElectron ?? null;
};

/**
 * 把一组设置交给「用户真正在用的那份」：桌面上是主窗口（IPC），安卓上就是本进程的设置 store。
 * 返回是否真的写进去了。
 */
export const applyPerfCheckChoice = async (settings: PerfCheckSettings): Promise<boolean> => {
    if (window.electron?.applyPerfCheckChoice) {
        return Boolean(await window.electron.applyPerfCheckChoice(settings).catch(() => false));
    }
    if (!IS_ANDROID_WEBVIEW) return false;
    const store = useVisualizerSettingsStore.getState();
    store.handleSetVisualizerFrameRate(settings.frameRate);
    store.handleSetLyricRenderQuality({ scale: settings.scale, antialias: settings.antialias });
    return true;
};

/** 安卓上检测跑在当前页面里（全屏浮层），没有单独的窗口。 */
export const isEmbeddedPerfCheck = (): boolean => IS_ANDROID_WEBVIEW;
