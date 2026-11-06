export type NativeStageStats = {
    enabled: boolean;
    active: boolean;
    renderer: string;
    frames: number;
    surface: boolean;
    playing: boolean;
};

let current: NativeStageStats = { enabled: false, active: false, renderer: 'none', frames: 0, surface: false, playing: false };

export const setNativeStageStats = (next: Partial<NativeStageStats>): void => {
    current = { ...current, ...next };
};

export const getNativeStageStatsSnapshot = (): NativeStageStats => current;
