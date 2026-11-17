// src/components/perfCheck/openPerfCheck.ts
import { isEmbeddedPerfCheck } from './perfCheckPlatform';
import { openPerfCheckOverlay } from './perfCheckOverlayStore';

// Opens the performance check's window (electron/perfCheck.cjs), or its full-screen overlay on Android.
// Its own module so the settings page and the command palette can call it without loading the check.

/** Opens the check's window; false where there is none (the plain web build). */
export const openPerfCheck = (): boolean => {
    const open = window.electron?.openPerfCheck;
    if (open) {
        void open().catch((error: unknown) => console.warn('[PerfCheck] could not open the window', error));
        return true;
    }
    // 安卓壳：没有独立窗口，改用当前页面上的全屏浮层。
    if (isEmbeddedPerfCheck()) {
        openPerfCheckOverlay();
        return true;
    }
    return false;
};
