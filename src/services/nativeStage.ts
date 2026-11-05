import { registerPlugin } from '@capacitor/core';

// src/services/nativeStage.ts
// 方案二的实验桥：原生舞台 View 在 WebView 后面，JS 只推当前歌词/歌曲信息。

interface FoliaNativeStagePlugin {
    enable(): Promise<{ enabled?: boolean }>;
    update(options: {
        line: string;
        nextLine: string;
        title: string;
        artist: string;
        accent: string;
        playing: boolean;
    }): Promise<void>;
    updateAudio(options: { power: number; bass: number; mid: number; treble: number }): Promise<void>;
    updateProgress(options: { position: number; duration: number }): Promise<void>;
    addListener(eventName: string, listener: (event: { action?: string; value?: number }) => void): Promise<{ remove: () => Promise<void> | void }>;
    disable(): Promise<void>;
}

const FoliaNativeStage = registerPlugin<FoliaNativeStagePlugin>('FoliaNativeStage');

export const enableNativeStage = (): Promise<{ enabled?: boolean }> => FoliaNativeStage.enable();
export const updateNativeStage = (options: Parameters<FoliaNativeStagePlugin['update']>[0]) => FoliaNativeStage.update(options);
export const addNativeStageControlListener = async (listener: (action: string, value: number) => void): Promise<() => void> => {
    const handle = await FoliaNativeStage.addListener('control', event => listener(String(event?.action || ''), Number(event?.value || 0)));
    return () => { void handle.remove(); };
};
export const updateNativeStageProgress = (options: { position: number; duration: number }) => FoliaNativeStage.updateProgress(options);
export const updateNativeStageAudio = (options: { power: number; bass: number; mid: number; treble: number }) => FoliaNativeStage.updateAudio(options);
export const disableNativeStage = (): Promise<void> => FoliaNativeStage.disable();
