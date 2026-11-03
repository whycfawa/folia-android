import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import { IS_ANDROID_WEBVIEW } from '../../utils/platform';

// src/mods/runtime/modResolutionGuard.ts
// 宿主层的模组画面分辨率保护：只压模组挂载容器（[data-folium-owner]）里的 canvas，
// 不碰内置歌词动画，也不改帧率。开关关闭时把 canvas 的 width/height setter 原样还回去。

/** 0.5 = 25% 像素量；只压模组 canvas，不改布局，也不改帧率。 */
export const MOD_CANVAS_RESOLUTION_SCALE = 0.5;

type CanvasDimension = 'width' | 'height';

type PatchedDescriptor = {
    dimension: CanvasDimension;
    descriptor: PropertyDescriptor;
};

let installed = false;
let observer: MutationObserver | null = null;
let patched: PatchedDescriptor[] = [];
let scaled = new WeakSet<HTMLCanvasElement>();
let clampedCanvases = 0;

const isModCanvas = (canvas: HTMLCanvasElement): boolean => {
    let node: Node | null = canvas;
    while (node) {
        if (node instanceof Element && node.hasAttribute('data-folium-owner')) return true;
        const rootNode = node.getRootNode();
        if (rootNode instanceof ShadowRoot) {
            node = rootNode.host;
        } else {
            break;
        }
    }
    return false;
};

const clamp = (value: number): number => Math.max(1, Math.round(value * MOD_CANVAS_RESOLUTION_SCALE));

const installDimension = (dimension: CanvasDimension) => {
    const proto = HTMLCanvasElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, dimension);
    if (!original?.get || !original.set) return;
    const descriptor: PropertyDescriptor = {
        configurable: true,
        enumerable: original.enumerable,
        get: original.get,
        set(this: HTMLCanvasElement, value: number) {
            if (installed && Number.isFinite(value) && isModCanvas(this)) {
                if (!scaled.has(this)) {
                    scaled.add(this);
                    clampedCanvases += 1;
                }
                original.set?.call(this, clamp(value));
                return;
            }
            original.set?.call(this, value);
        },
    };
    Object.defineProperty(proto, dimension, descriptor);
    patched.push({ dimension, descriptor: original });
};

const clampExistingCanvas = (canvas: HTMLCanvasElement) => {
    if (!canvas.isConnected || scaled.has(canvas) || !isModCanvas(canvas)) return;
    // 走被替换过的 setter：只压一次，之后模组自己重设尺寸时 setter 会继续压。
    if (canvas.width > 0) canvas.width = canvas.width;
    if (canvas.height > 0) canvas.height = canvas.height;
};

const visit = (node: Node) => {
    if (node instanceof HTMLCanvasElement) clampExistingCanvas(node);
    if (!(node instanceof Element) && !(node instanceof ShadowRoot) && !(node instanceof DocumentFragment)) return;
    node.querySelectorAll('canvas').forEach(canvas => clampExistingCanvas(canvas as HTMLCanvasElement));
    node.querySelectorAll('*').forEach(element => {
        if (element.shadowRoot) visit(element.shadowRoot);
    });
};

const start = () => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    // 每次重新打开都重新扫描：关闭期间模组可能已经把画布改回全分辨率。
    scaled = new WeakSet<HTMLCanvasElement>();
    clampedCanvases = 0;
    installDimension('width');
    installDimension('height');
    observer = new MutationObserver((records) => {
        for (const record of records) {
            record.addedNodes.forEach(visit);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    visit(document.body);
};

const stop = () => {
    if (!installed) return;
    installed = false;
    observer?.disconnect();
    observer = null;
    const proto = HTMLCanvasElement.prototype;
    for (const entry of patched.reverse()) {
        Object.defineProperty(proto, entry.dimension, entry.descriptor);
    }
    patched = [];
};

/** 跟随设置开关；只改分辨率，不改帧率。 */
export const getModResolutionGuardStats = (): { enabled: boolean; scale: number; canvases: number } => ({
    enabled: installed,
    scale: MOD_CANVAS_RESOLUTION_SCALE,
    canvases: clampedCanvases,
});

export const installModResolutionGuard = (): void => {
    if (typeof window === 'undefined' || !IS_ANDROID_WEBVIEW) return;
    const sync = (enabled: boolean) => {
        if (enabled) start();
        else stop();
    };
    sync(useDesktopSettingsStore.getState().modResolutionGuardEnabled);
    useDesktopSettingsStore.subscribe((state) => sync(state.modResolutionGuardEnabled));
};
