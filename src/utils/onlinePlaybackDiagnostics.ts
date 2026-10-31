// src/utils/onlinePlaybackDiagnostics.ts
// 在线取流（getAudioSource）与媒体播放失败的留痕。
//
// 现场教训：用户只看到「暂时无法播放这首歌」（对应 playbackFailurePolicy 里 invalid-response /
// unknown 那一档），而诊断里**一条播放尝试都没有** —— 因为这条路径从来不留痕，报告无法判断是哪家
// provider、哪首歌、上游给了什么码。这里按「取流结果 + 分类 + 上游码 + 耗时」记一条，报告单列一段。
//
// 覆盖三档结果：
//   ok        —— 拿到可播放地址；
//   no-source —— provider 没抛错但没给地址（最容易被归成 invalid-response 的那种）；
//   error     —— provider 抛错（网络 / 权限 / 地区 / 会员…），带上错误码与分类 kind。

export type OnlinePlaybackStage = 'resolve' | 'media';
export type OnlinePlaybackOutcome = 'ok' | 'no-source' | 'error';

export type OnlinePlaybackRecord = {
    at: number;
    stage: OnlinePlaybackStage;
    outcome: OnlinePlaybackOutcome;
    providerId: string;
    /** 歌曲标题与歌手：只写进诊断，方便定位是哪一首，不含账号信息。 */
    songTitle: string;
    songArtist: string;
    mediaId: string;
    quality: string;
    kind: string;
    code: string;
    detail: string;
    elapsedMs: number;
};

const MAX_RECORDS = 24;
const MAX_AGE_MS = 30 * 60 * 1000;
const records: OnlinePlaybackRecord[] = [];

const text = (value: unknown, fallback = ''): string => {
    if (value === undefined || value === null) return fallback;
    const result = String(value).trim();
    return result || fallback;
};

/** 从各家 provider 的错误对象里挤出 code / kind / upstreamCode / 提示，压成一行短描述。 */
const describeError = (error: unknown): { kind: string; code: string; detail: string } => {
    if (!error || typeof error !== 'object') {
        return { kind: '', code: '', detail: text(error).slice(0, 160) };
    }
    const candidate = error as {
        code?: unknown;
        kind?: unknown;
        message?: unknown;
        upstreamCode?: unknown;
        details?: { upstreamCode?: unknown; stage?: unknown };
        cause?: unknown;
    };
    const kind = text(candidate.kind);
    const code = text(candidate.upstreamCode ?? candidate.details?.upstreamCode ?? candidate.code);
    const parts = [
        text(candidate.message),
        candidate.details?.stage ? `stage=${text(candidate.details.stage)}` : '',
    ].filter(Boolean);
    return { kind, code, detail: parts.join(' ').slice(0, 160) };
};

export const noteOnlinePlaybackOutcome = (input: {
    stage?: OnlinePlaybackStage;
    outcome: OnlinePlaybackOutcome;
    providerId: string;
    songTitle?: string;
    songArtist?: string;
    mediaId?: string | number;
    quality?: string;
    kind?: string;
    code?: string | number;
    detail?: string;
    elapsedMs?: number;
}): void => {
    const at = Date.now();
    while (records.length > 0 && at - records[0].at > MAX_AGE_MS) records.shift();
    records.push({
        at,
        stage: input.stage ?? 'resolve',
        outcome: input.outcome,
        providerId: text(input.providerId, 'unknown').slice(0, 24),
        songTitle: text(input.songTitle).slice(0, 80),
        songArtist: text(input.songArtist).slice(0, 80),
        mediaId: text(input.mediaId).slice(0, 80),
        quality: text(input.quality, '-').slice(0, 24),
        kind: text(input.kind).slice(0, 40),
        code: text(input.code).slice(0, 40),
        detail: text(input.detail).slice(0, 160),
        elapsedMs: Math.max(0, Math.round(Number(input.elapsedMs) || 0)),
    });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
};

/** provider 抛错时的一条便捷入口。 */
export const noteOnlinePlaybackError = (input: {
    stage?: OnlinePlaybackStage;
    providerId: string;
    songTitle?: string;
    songArtist?: string;
    mediaId?: string | number;
    quality?: string;
    elapsedMs?: number;
    error: unknown;
}): void => {
    const described = describeError(input.error);
    noteOnlinePlaybackOutcome({
        stage: input.stage ?? 'resolve',
        outcome: 'error',
        providerId: input.providerId,
        songTitle: input.songTitle,
        songArtist: input.songArtist,
        mediaId: input.mediaId,
        quality: input.quality,
        kind: described.kind,
        code: described.code,
        detail: described.detail,
        elapsedMs: input.elapsedMs,
    });
};

export const getOnlinePlaybackDiagnosticLines = (): string[] => {
    const at = Date.now();
    while (records.length > 0 && at - records[0].at > MAX_AGE_MS) records.shift();
    return records.map((record) => (
        `playback +${Math.max(0, at - record.at)}ms ago stage=${record.stage}`
        + ` outcome=${record.outcome} provider=${record.providerId}`
        + (record.songTitle ? ` song=${record.songTitle}${record.songArtist ? ' - ' + record.songArtist : ''}` : '')
        + ` mediaId=${record.mediaId || '(none)'} quality=${record.quality}`
        + (record.kind ? ` kind=${record.kind}` : '')
        + (record.code ? ` code=${record.code}` : '')
        + (record.elapsedMs ? ` elapsed=${record.elapsedMs}ms` : '')
        + (record.detail ? ` detail=${record.detail}` : '')
    ));
};

export const resetOnlinePlaybackDiagnostics = (): void => {
    records.length = 0;
};
