import { registerPlugin } from '@capacitor/core';

// src/services/nativeStage.ts
// 方案二的实验桥：原生舞台 View 在 WebView 后面，JS 只推当前歌词/歌曲信息。

interface FoliaNativeStagePlugin {
    enable(): Promise<{ enabled?: boolean }>;
    update(options: {
        mode: string;
        line: string;
        nextLine: string;
        prevLine: string;
        lineTranslation: string;
        prevTranslation: string;
        nextTranslation: string;
        title: string;
        artist: string;
        accent: string;
        primary: string;
        secondary: string;
        background: string;
        daylight: boolean;
        playing: boolean;
        chorus: boolean;
    }): Promise<void>;
    updateAudio(options: { power: number; bass: number; mid: number; treble: number }): Promise<void>;
    updateProgress(options: { position: number; duration: number; lineProgress: number }): Promise<void>;
    updateWords(options: { words: string; position: number }): Promise<void>;
    stats(): Promise<{ active?: boolean; renderer?: string; frames?: number; surface?: boolean; playing?: boolean; vulkan?: boolean; canvasMs?: number; vulkanError?: string; pipeline?: boolean }>;
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
export const addNativeStageFallbackListener = async (listener: () => void): Promise<() => void> => {
    const handle = await FoliaNativeStage.addListener('fallback', () => listener());
    return () => { void handle.remove(); };
};
export const getNativeStageStats = () => FoliaNativeStage.stats();
export const updateNativeStageWords = (options: { words: string; position: number }) => FoliaNativeStage.updateWords(options);
export const updateNativeStageProgress = (options: { position: number; duration: number; lineProgress: number }) => FoliaNativeStage.updateProgress(options);
export const updateNativeStageAudio = (options: { power: number; bass: number; mid: number; treble: number }) => FoliaNativeStage.updateAudio(options);
export const disableNativeStage = (): Promise<void> => FoliaNativeStage.disable();
