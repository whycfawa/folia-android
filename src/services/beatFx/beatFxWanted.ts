// src/services/beatFx/beatFxWanted.ts
// 「屏上这份画面现在要不要拍点」的现场快照，给诊断报告用：模型没跑时先看是不是根本没被要求，
// 还是要求了却没跑起来（后者的原因在 beatThisGpu 的 lastError 和 beatFxSource 的 lastLookup）。

export type BeatFxWantedSnapshot = {
    at: number;
    /** 屏上的模式和背景是否声明了读拍点的效果，且那个效果开着。 */
    beats: boolean;
    /** 是否要 htdemucs 的鼓点（仿真鼓面那类效果）。 */
    drums: boolean;
    /** 是否要分离出的其他声部（雾笺的疏雨轻车）。 */
    vocals: boolean;
    /** 智能动感模式处在 cached：只读存盘，不跑模型。 */
    storedOnly: boolean;
    /** 当前这首歌的分析键；null 表示还没有歌或还没解析出音源。 */
    key: string | null;
};

let last: BeatFxWantedSnapshot | null = null;

export const noteBeatFxWanted = (snapshot: Omit<BeatFxWantedSnapshot, 'at'>): void => {
    last = { ...snapshot, at: Date.now() };
};

export const readBeatFxWanted = (): BeatFxWantedSnapshot | null => last;
