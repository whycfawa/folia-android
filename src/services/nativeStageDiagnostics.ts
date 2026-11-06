export type NativeStageStats = {
    enabled: boolean;
    active: boolean;
    renderer: string;
    frames: number;
    surface: boolean;
    playing: boolean;
    vulkan: boolean;
    canvasMs: number;
    vulkanError: string;
    pipeline: boolean;
};

let current: NativeStageStats = { enabled: false, active: false, renderer: 'none', frames: 0, surface: false, playing: false, vulkan: false, canvasMs: 0, vulkanError: '', pipeline: false };

export const setNativeStageStats = (next: Partial<NativeStageStats>): void => {
    current = { ...current, ...next };
};

export const getNativeStageStatsSnapshot = (): NativeStageStats => current;
