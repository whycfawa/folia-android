import { useDesktopSettingsStore, type ModResolutionGuardLevel } from '../../stores/useDesktopSettingsStore';
import { IS_ANDROID_WEBVIEW } from '../../utils/platform';

// src/mods/runtime/modResolutionGuard.ts
// 宿主层的模组性能优化：同一个三挡开关同时控制画布分辨率和 DOM 特效降级，
// 只作用于模组挂载容器（[data-folium-owner]），不碰内置歌词动画，也不改帧率。

/** 三挡：轻度只压画布；均衡再关 will-change/text-shadow；强力再关 filter/shadow/blend。 */
export const MOD_RESOLUTION_GUARD_SCALES: Readonly<Record<ModResolutionGuardLevel, number>> = {
    light: 0.75,
    medium: 0.5,
    strong: 0.35,
};

const STYLE_ID = 'folia-mod-performance-guard';
const ATTR = 'data-folia-mod-perf';

type CanvasDimension = 'width' | 'height';

let installed = false;
let observer: MutationObserver | null = null;
let currentLevel: ModResolutionGuardLevel = 'medium';
let currentScale = MOD_RESOLUTION_GUARD_SCALES.medium;
let source: Partial<Record<CanvasDimension, PropertyDescriptor>> = {};
let scaled = new Set<HTMLCanvasElement>();

const EFFECT_CSS = `
[data-folia-mod-perf] {
  contain: layout style;
}
[data-folia-mod-perf="medium"] * {
  will-change: auto !important;
  text-shadow: none !important;
}
[data-folia-mod-perf="strong"] * {
  filter: none !important;
  -webkit-filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  mix-blend-mode: normal !important;
  will-change: auto !important;
  text-rendering: optimizeSpeed !important;
  font-kerning: none !important;
}
`;

const isModCanvas = (canvas: HTMLCanvasElement): boolean => {
    // 先沿普通 DOM 祖先走，再跨 ShadowRoot 的 host 继续；只看 getRootNode 会漏掉 host 里的 canvas。
    let node: Element | null = canvas;
    while (node) {
        if (node.hasAttribute('data-folium-owner')) return true;
        if (node.parentElement) {
            node = node.parentElement;
            continue;
        }
        const rootNode = node.getRootNode();
        node = rootNode instanceof ShadowRoot ? rootNode.host : null;
    }
    return false;
};

const rawSet = (canvas: HTMLCanvasElement, dimension: CanvasDimension, value: number) => {
    source[dimension]?.set?.call(canvas, Math.max(1, Math.round(value)));
};

const installDimension = (dimension: CanvasDimension) => {
    const proto = HTMLCanvasElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, dimension);
    if (!original?.get || !original.set) return;
    source[dimension] = original;
    Object.defineProperty(proto, dimension, {
        configurable: true,
        enumerable: original.enumerable,
        get: original.get,
        set(this: HTMLCanvasElement, value: number) {
            if (installed && Number.isFinite(value) && isModCanvas(this)) {
                scaled.add(this);
                original.set?.call(this, Math.max(1, Math.round(value * currentScale)));
                return;
            }
            original.set?.call(this, value);
        },
    });
};

const clampExistingCanvas = (canvas: HTMLCanvasElement) => {
    if (!canvas.isConnected || scaled.has(canvas) || !isModCanvas(canvas)) return;
    scaled.add(canvas);
    if (canvas.width > 0) rawSet(canvas, 'width', canvas.width * currentScale);
    if (canvas.height > 0) rawSet(canvas, 'height', canvas.height * currentScale);
};

const markRoots = (node: ParentNode) => {
    if (node instanceof Element && node.hasAttribute('data-folium-owner')) {
        node.setAttribute(ATTR, currentLevel);
    }
    node.querySelectorAll?.('[data-folium-owner]').forEach((root) => {
        root.setAttribute(ATTR, currentLevel);
    });
};

const visit = (node: Node) => {
    if (node instanceof HTMLCanvasElement) clampExistingCanvas(node);
    if (!(node instanceof Element) && !(node instanceof ShadowRoot) && !(node instanceof DocumentFragment)) return;
    markRoots(node);
    node.querySelectorAll('canvas').forEach(canvas => clampExistingCanvas(canvas as HTMLCanvasElement));
    node.querySelectorAll('*').forEach(element => {
        if (element.shadowRoot) visit(element.shadowRoot);
    });
};

const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = EFFECT_CSS;
    document.head.appendChild(style);
};

const removeStyle = () => {
    document.getElementById(STYLE_ID)?.remove();
    document.querySelectorAll('[' + ATTR + ']').forEach((root) => root.removeAttribute(ATTR));
};

const applyScale = (next: number) => {
    if (next === currentScale) return;
    const ratio = next / currentScale;
    currentScale = next;
    for (const canvas of scaled) {
        if (!canvas.isConnected) continue;
        const width = canvas.width;
        const height = canvas.height;
        if (width > 0) rawSet(canvas, 'width', width * ratio);
        if (height > 0) rawSet(canvas, 'height', height * ratio);
    }
};

const applyLevel = (level: ModResolutionGuardLevel) => {
    applyScale(MOD_RESOLUTION_GUARD_SCALES[level]);
    currentLevel = level;
    if (!installed) return;
    ensureStyle();
    markRoots(document.body);
};

const start = (level: ModResolutionGuardLevel) => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    currentLevel = level;
    currentScale = MOD_RESOLUTION_GUARD_SCALES[level];
    // 每次重新打开都重新扫描：关闭期间模组可能已经把画布改回全分辨率。
    scaled = new Set<HTMLCanvasElement>();
    ensureStyle();
    installDimension('width');
    installDimension('height');
    observer = new MutationObserver((records) => {
        for (const record of records) {
            record.addedNodes.forEach(visit);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    visit(document.body);
    markRoots(document.body);
};

const stop = () => {
    if (!installed) return;
    installed = false;
    observer?.disconnect();
    observer = null;
    removeStyle();
    const proto = HTMLCanvasElement.prototype;
    for (const dimension of ['width', 'height'] as const) {
        const original = source[dimension];
        if (original) Object.defineProperty(proto, dimension, original);
    }
    source = {};
    scaled = new Set<HTMLCanvasElement>();
};

/** 跟随设置开关与挡位；只改分辨率/DOM 特效，不改帧率。 */
export const getModResolutionGuardStats = (): {
    enabled: boolean;
    level: ModResolutionGuardLevel;
    scale: number;
    canvases: number;
} => ({
    enabled: installed,
    level: currentLevel,
    scale: currentScale,
    canvases: scaled.size,
});

export const installModResolutionGuard = (): void => {
    if (typeof window === 'undefined' || !IS_ANDROID_WEBVIEW) return;
    const sync = (enabled: boolean, level: ModResolutionGuardLevel) => {
        if (!enabled) {
            stop();
            return;
        }
        if (!installed) {
            start(level);
            return;
        }
        applyLevel(level);
    };
    const state = useDesktopSettingsStore.getState();
    sync(state.modResolutionGuardEnabled, state.modResolutionGuardLevel);
    useDesktopSettingsStore.subscribe((state) => {
        sync(state.modResolutionGuardEnabled, state.modResolutionGuardLevel);
    });
};
