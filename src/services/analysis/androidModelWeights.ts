import { registerPlugin } from '@capacitor/core';
import { isCapacitorAndroid } from '../../platform/runtime';

// src/services/analysis/androidModelWeights.ts
// Android 上模型权重的读取入口：原生把 assets/models 里的打包文件经 127.0.0.1 暴露出来，
// 这里 fetch 整份字节再拆出 tensors 与 manifest，形状与 Electron 主进程返回的一致。

export type AndroidModelName = 'beat_this' | 'htdemucs' | 'htdemucs_gpu';

interface FoliaAnalysisModelsPlugin {
    present(): Promise<{ beat_this?: boolean; htdemucs?: boolean; htdemucs_gpu?: boolean }>;
    url(options: { model: string }): Promise<{ url?: string }>;
}

const FoliaAnalysisModels = registerPlugin<FoliaAnalysisModelsPlugin>('FoliaAnalysisModels');

/** 这个运行时有没有模型桥（不代表权重一定在，present 才是那个答案）。 */
export const hasAndroidModelBridge = (): boolean => isCapacitorAndroid();

export const readAndroidModelsPresent = async (): Promise<{
    beat_this: boolean;
    htdemucs: boolean;
    htdemucs_gpu: boolean;
} | null> => {
    if (!isCapacitorAndroid()) return null;
    try {
        const answer = await FoliaAnalysisModels.present();
        return {
            beat_this: answer?.beat_this === true,
            htdemucs: answer?.htdemucs === true,
            htdemucs_gpu: answer?.htdemucs_gpu === true,
        };
    } catch (error) {
        console.warn('[Analysis] could not check the Android model assets', error);
        return null;
    }
};

/** 与 electron/analysis/packedWeights.cjs 同一个封包：tensors + JSON + FOLIABTW + uint64 LE 偏移。 */
const unpackPackedWeights = (file: Uint8Array): { weights: Uint8Array<ArrayBuffer>; manifest: unknown } => {
    const trailer = 8 + 8;
    if (file.byteLength < trailer) throw new Error('model file is shorter than its trailer');
    const magic = new TextDecoder().decode(file.subarray(file.byteLength - trailer, file.byteLength - 8));
    if (magic !== 'FOLIABTW') throw new Error('not a packed model export (no FOLIABTW trailer)');
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const at = Number(view.getBigUint64(file.byteLength - 8, true));
    if (!(at > 0 && at < file.byteLength - trailer)) throw new Error('manifest offset is outside the file');
    const manifest = JSON.parse(new TextDecoder().decode(file.subarray(at, file.byteLength - trailer)));
    if ((manifest as { bytes?: unknown })?.bytes !== at) throw new Error('model manifest does not match its tensors');
    return {
        weights: file.subarray(0, at) as Uint8Array<ArrayBuffer>,
        manifest,
    };
};

/** 取一个模型的权重；没有插件、没有资源或读取失败时返回 null，调用方按“模型不可用”处理。 */
export const loadAndroidModelWeights = async (
    model: AndroidModelName,
): Promise<{ weights: Uint8Array<ArrayBuffer>; manifest: unknown } | null> => {
    if (!isCapacitorAndroid()) return null;
    try {
        const { url } = await FoliaAnalysisModels.url({ model });
        if (!url) return null;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`model server responded ${response.status}`);
        return unpackPackedWeights(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
        console.warn('[Analysis] could not read the Android model weights', error);
        return null;
    }
};
