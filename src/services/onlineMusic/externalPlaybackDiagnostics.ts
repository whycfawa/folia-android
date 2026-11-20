// src/services/onlineMusic/externalPlaybackDiagnostics.ts
// 外部播放路线（平台自己的播放器）当下所知道的现场，只给诊断报告读。单独一个模块是因为
// 报告要读它，而报告被 provider 一侧引用：从这里再依赖 store 会成环。

export type ExternalPlaybackSnapshot = {
    /** 当前路线是不是外部播放器。 */
    route: boolean;
    /** 这首歌是否已经显示出来了。 */
    announced: boolean;
    playing: boolean;
    starting: boolean;
    /** 播放器说在放，位置却不再前进：流卡在播放器里。 */
    stalled: boolean;
    /** 位置停滞了多久（毫秒），没停滞时为 null。 */
    stalledForMs: number | null;
    /** 这次播放已经为了「卡住」重开过几次。 */
    recoveries: number;
    /** 重开也救不回来，已停在卡住的位置。 */
    gaveUp: boolean;
    /** 播放器自己说这首放不了（Apple：内容受限）时给出的原因，否则 null。 */
    unplayable: string | null;
    seekPending: boolean;
    positionSec: number;
    durationSec: number | null;
};

let snapshot: ExternalPlaybackSnapshot | null = null;

export const noteExternalPlaybackSnapshot = (value: ExternalPlaybackSnapshot | null): void => {
    snapshot = value;
};

export const readExternalPlaybackSnapshot = (): ExternalPlaybackSnapshot | null => snapshot;

/** 最近一次判「这首歌结束了」的依据：报告里能看出是哪一条误判把歌跳了过去。 */
export type ExternalPlaybackEnd = {
    atMs: number;
    reason: string;
    positionSec: number;
    durationSec: number | null;
};

let lastEnd: ExternalPlaybackEnd | null = null;

export const noteExternalPlaybackEnd = (value: ExternalPlaybackEnd): void => {
    lastEnd = value;
};

export const readExternalPlaybackEnd = (): ExternalPlaybackEnd | null => lastEnd;
