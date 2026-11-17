import { create } from 'zustand';

// src/components/perfCheck/perfCheckOverlayStore.ts
// 安卓没有第二个窗口：性能检测以全屏浮层跑在当前页面里，这里只管它是开是关。

type PerfCheckOverlayState = {
    open: boolean;
    setOpen: (open: boolean) => void;
};

export const usePerfCheckOverlayStore = create<PerfCheckOverlayState>(set => ({
    open: false,
    setOpen: open => set({ open }),
}));

export const openPerfCheckOverlay = (): void => usePerfCheckOverlayStore.getState().setOpen(true);
