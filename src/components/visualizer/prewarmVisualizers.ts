import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { VISUALIZER_REGISTRY, getVisualizerRegistryEntry, type VisualizerRegistryEntry } from './registry';

// src/components/visualizer/prewarmVisualizers.ts
// 让启动慢的歌词样式提前准备（entry 的 `prewarm`，definition.ts；比如雾笺在后台先编着色器），分两档：
// - 保存的样式：应用一启动就调（首屏加载遮罩还在），它马上要挂上；
// - 声明了 `prewarmWhenIdle` 的其他样式：首屏出来后再等一会儿，页面空闲时调，第一次切过去时就不用现准备。
// 都在主窗口里，各调一次。

/** 首屏出来后先等这么久再找空闲：启动时的加载、首屏的布局和图片解码先做完。 */
const IDLE_DELAY_MS = 2500;
/** 一直不空闲时最多再等这么久，到点照样调。 */
const IDLE_TIMEOUT_MS = 10_000;

const run = (entry: VisualizerRegistryEntry) => {
    try {
        entry.prewarm?.();
    } catch (error) {
        console.warn(`[Visualizer] prewarm of ${entry.mode} failed`, error);
    }
};

/** 保存的那个样式：主窗口启动时调一次（bootstrap.tsx）。 */
export const prewarmSavedVisualizer = (): void => {
    const { visualizerMode } = useVisualizerSettingsStore.getState();
    const entry = getVisualizerRegistryEntry(visualizerMode);
    // 存着的模式没注册时注册表退回默认样式：那不是保存的样式，不替它准备
    if (entry.mode !== visualizerMode) return;
    run(entry);
};

let idleScheduled = false;

/** 其他声明了 `prewarmWhenIdle` 的样式：首屏挂好时调（bootstrap.tsx），过一会儿等页面空闲再准备；再调（StrictMode 下 effect 跑两遍）不再排。 */
export const prewarmVisualizersWhenIdle = (): void => {
    if (idleScheduled) return;
    idleScheduled = true;
    setTimeout(() => {
        const start = () => {
            const saved = useVisualizerSettingsStore.getState().visualizerMode;
            // 保存的样式启动时已经准备过
            for (const entry of VISUALIZER_REGISTRY) if (entry.prewarmWhenIdle && entry.mode !== saved) run(entry);
        };
        if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
        else start();
    }, IDLE_DELAY_MS);
};

// 每个模式的实际组件模块。React.lazy 在切换时才 import()，而模块求值（three.js / pixi 整块）是同步的：
// 现场一次切换实测 1.5s 主线程阻塞（LoAF @import.then@VisualizerMachi）。这里在首屏稳定后按 400ms 间隔
// 逐个预热，把这段求值挪到空闲时间，切换时只剩场景构建。
const lazyVisualizerModules = import.meta.glob('./*/Visualizer*.tsx');

/** 预热起点：等首屏、启动时的图片解码和首帧动画都过去。 */
const WARM_START_DELAY_MS = 4000;
/** 相邻两块之间留出的间隔：求值本身不可中断，靠间隔把突发拆开。 */
const WARM_SPACING_MS = 400;

let chunksWarmStarted = false;

/** 8 核以下不预热：低端机上把 three.js 拉进内存换来的切换收益，不如省下的主线程时间。 */
const canWarmChunks = (): boolean => (
    typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 4) >= 6
);

/**
 * 把所有 lazy 模式的代码块在空闲时预热一遍（只求值模块，不挂载实例）。
 * 与 `prewarmVisualizersWhenIdle` 分开导出：那个跑的是各模式声明的 `prewarm`，这个是补上没声明的模式。
 */
export const warmVisualizerChunksWhenIdle = (): void => {
    if (chunksWarmStarted || !canWarmChunks()) return;
    const loaders = Object.values(lazyVisualizerModules);
    if (loaders.length === 0) return;
    chunksWarmStarted = true;

    let index = 0;
    const step = () => {
        const loader = loaders[index];
        index += 1;
        if (!loader) return;
        void loader().catch((error: unknown) => {
            // 预热失败不影响使用：真正切换时 React.lazy 会再试一次。
            console.warn('[Visualizer] chunk warm-up failed', error);
        });
        if (index < loaders.length) globalThis.setTimeout(step, WARM_SPACING_MS);
    };
    globalThis.setTimeout(step, WARM_START_DELAY_MS);
};
