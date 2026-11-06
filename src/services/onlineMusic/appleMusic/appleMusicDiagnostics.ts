// src/services/onlineMusic/appleMusic/appleMusicDiagnostics.ts
// Apple Music 在 Android 上的播放现场：最近一次起播的结论，加上伴随 WebView 里那份页面的自述。
// 只写阶段名、布尔值、状态码、长度和计数；歌曲 id、账号、cookie 和地址都不进报告。

export type AppleMusicPlayAttempt = {
    at: number;
    stage: string;
    error: string;
    storefront: string;
    storefrontMatched: boolean | null;
    previewOnly: boolean | null;
    isPlaying: boolean | null;
};

type CompanionDiagnostics = {
    data?: unknown;
    companion?: unknown;
    error?: unknown;
};

let attempt: AppleMusicPlayAttempt | null = null;

// 失败原因里的 stage 是伙伴返回的固定阶段名（storefront / queue / play / seek）。
const STAGE_IN_MESSAGE = /\(stage: ([a-z-]+)\)/;

const asRecord = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);
const text = (value: unknown, fallback = 'n/a'): string => (typeof value === 'string' && value ? value : fallback);
const yesNo = (value: unknown): string => (typeof value === 'boolean' ? (value ? 'yes' : 'no') : 'n/a');
const count = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : 'n/a');

/** 起播被页面接受：记下它报告的地区与试听状态，后面失败时用来对照。 */
export const noteAppleMusicPlayStarted = (data: unknown): void => {
    const value = asRecord(data);
    attempt = {
        at: Date.now(),
        // "accepted" is not "sounding": the page answers the queue before its player starts.
        stage: value?.isPlaying === true ? 'playing' : 'accepted',
        error: '',
        storefront: text(value?.storefront, ''),
        storefrontMatched: typeof value?.storefrontMatched === 'boolean' ? value.storefrontMatched : null,
        previewOnly: typeof value?.previewOnly === 'boolean' ? value.previewOnly : null,
        isPlaying: typeof value?.isPlaying === 'boolean' ? value.isPlaying : null,
    };
};

/** 起播被拒绝：留下伙伴给的阶段名和错误码，报告里就能看出卡在哪一段。 */
export const noteAppleMusicPlayFailure = (error: unknown): void => {
    const value = asRecord(error);
    const message = typeof value?.message === 'string' ? value.message : '';
    attempt = {
        at: Date.now(),
        stage: STAGE_IN_MESSAGE.exec(message)?.[1] ?? 'unknown',
        error: text(value?.cause, 'unknown'),
        storefront: attempt?.storefront ?? '',
        storefrontMatched: attempt?.storefrontMatched ?? null,
        previewOnly: attempt?.previewOnly ?? null,
        isPlaying: attempt?.isPlaying ?? null,
    };
};

const readCompanionDiagnostics = async (): Promise<CompanionDiagnostics | null> => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: {
            getPlatform?: () => string;
            Plugins?: { FoliaAppleMusic?: { diagnostics?: () => Promise<CompanionDiagnostics> } };
        };
    }).Capacitor;
    if (capacitor?.getPlatform?.() !== 'android') return null;
    const plugin = capacitor?.Plugins?.FoliaAppleMusic;
    if (typeof plugin?.diagnostics !== 'function') return null;
    return await plugin.diagnostics();
};

const formatAttempt = (): string => {
    if (!attempt) return '  last play: (none)';
    return `  last play: at=${new Date(attempt.at).toISOString()}`
        + ` stage=${attempt.stage}`
        + ` error=${attempt.error || '(none)'}`
        + ` storefront=${attempt.storefront || 'n/a'}`
        + ` matched=${attempt.storefrontMatched === null ? 'n/a' : yesNo(attempt.storefrontMatched)}`
        + ` isPlaying=${attempt.isPlaying === null ? 'n/a' : yesNo(attempt.isPlaying)}`
        + ` previewOnly=${attempt.previewOnly === null ? 'n/a' : yesNo(attempt.previewOnly)}`;
};

/**
 * 设置 → 帮助 → 复制诊断数据里的一节。Android 的 Apple Music 只在隐藏 WebView 里出声，
 * 「能登录、能搜、能拿歌词，就是没声音」时唯一能说明原因的是那份页面自己的报告：
 * CDM 有没有被接受、页面在哪个地区、播放器停在哪一步、媒体元素报了什么错。
 */
export const readAppleMusicDiagnosticLines = async (): Promise<string[]> => {
    const lines = [formatAttempt()];
    let report: CompanionDiagnostics | null = null;
    try {
        report = await readCompanionDiagnostics();
    } catch (error) {
        lines.push('  companion: (request failed)');
        console.warn('[AppleMusic] diagnostics request failed', error);
        return lines;
    }
    if (!report) {
        lines.push('  companion: (no android apple music page)');
        return lines;
    }
    const page = asRecord(report.data) ?? {};
    const bridge = asRecord(report.companion) ?? {};
    // The plugin answers without starting a page just to be asked: say which answer this is.
    const failure = typeof (report as { error?: unknown }).error === 'string' ? (report as { error?: string }).error : '';
    lines.push(`  companion: ${failure ? `unavailable=${failure}` : 'probed'}`
        + ` bridge=${yesNo(bridge.bridgeInjected)} loading=${yesNo(bridge.loading)}`
        + ` pending=${count(bridge.pending)} queued=${count(bridge.queued)}`
        + ` moveDue=${yesNo(bridge.storefrontMoveDue)} played=${yesNo(bridge.playbackStarted)}`
        + ` page=${text(bridge.pageUrl, '(none)')}`);

    const drm = asRecord(page.drm);
    lines.push(`  drm: eme=${yesNo(drm?.eme)} mediaSource=${yesNo(drm?.mediaSource)}`
        + ` secure=${yesNo(drm?.secure)} widevine=${yesNo(drm?.widevine)}`
        + ` robustness=${text(drm?.robustness, '(none)')} error=${text(drm?.error, '(none)')}`);

    const player = asRecord(page.player);
    lines.push(`  player: authorized=${yesNo(player?.authorized)} previewOnly=${yesNo(player?.previewOnly)}`
        + ` storefront=${text(player?.storefront, '(none)')} country=${text(player?.country, '(none)')}`
        + ` state=${count(player?.state)} isPlaying=${yesNo(player?.isPlaying)}`
        + ` volume=${count(player?.volume)} queue=${count(player?.queueLength)}@${count(player?.queuePosition)}`
        + ` itemIdLen=${count(player?.itemIdLength)}`);
    lines.push(`  account storefront: ${text(page.accountStorefront, '(unknown)')}`);

    const start = asRecord(page.start);
    if (start) {
        lines.push(`  start: pending=${yesNo(start.pending)} failed=${yesNo(start.failed)}`
            + ` cancelled=${yesNo(start.cancelled)} nudged=${yesNo(start.nudged)}`
            + ` stage=${text(start.stage, '(none)')} error=${text(start.error, '(none)')}`
            + ` ageMs=${count(start.ageMs)}`);
    } else {
        lines.push('  start: (none)');
    }

    const audio = asRecord(page.audio);
    lines.push(`  audio: elements=${count(audio?.elements)} paused=${yesNo(audio?.paused)}`
        + ` readyState=${count(audio?.readyState)} networkState=${count(audio?.networkState)}`
        + ` t=${count(audio?.currentTime)} muted=${yesNo(audio?.muted)} volume=${count(audio?.volume)}`
        + ` source=${yesNo(audio?.hasSource)} error=${text(audio?.errorText, '(none)')}`
        + `/${count(audio?.errorCode)}`);

    // 每个媒体元素自己的状态：队列在、CDM 在，却停在 readyState 1 的时候，卡住的是哪一个。
    const media = asRecord(page.media);
    const mediaRows = Array.isArray(media?.rows) ? media.rows as Array<Record<string, unknown>> : [];
    if (mediaRows.length) {
        lines.push(`  media: total=${count(media?.total)} online=${yesNo(page.online)}`);
        for (const row of mediaRows.slice(0, 5)) {
            lines.push(`    #${count(row.index)} paused=${yesNo(row.paused)} t=${count(row.t)}`
                + ` ready=${count(row.ready)} network=${count(row.network)}`
                + ` error=${count(row.error)} source=${yesNo(row.source)}`);
        }
    } else {
        lines.push(`  media: (none) online=${yesNo(page.online)}`);
    }

    // 播放器停在哪里、和哪些 Apple 主机说过话：段请求卡住与许可证被拒，从外面看是一样的。
    const states = Array.isArray(page.states) ? page.states as Array<Record<string, unknown>> : [];
    if (states.length) {
        lines.push(`  player states: ${states.map(state => `${count(state.state)}${state.playing === true ? '*' : ''}`).join(' ')}`);
    }
    const hosts = asRecord(page.hosts);
    const hostRows = hosts ? Object.entries(hosts).map(([host, value]) => ({
        host,
        count: count(asRecord(value)?.count),
        maxMs: count(asRecord(value)?.maxMs),
    })).sort((left, right) => Number(right.count) - Number(left.count)).slice(0, 10) : [];
    lines.push(`  hosts: ${hostRows.length ? hostRows.map(row => `${row.host}=${row.count}/${row.maxMs}ms`).join(' ') : '(none)'}`);

    // 加密媒体从不自己说“被拒了”还是“根本没问”：这串记录 CDM 的每一步。
    const eme = Array.isArray(page.eme) ? page.eme as Array<Record<string, unknown>> : [];
    if (eme.length) {
        lines.push(`  eme: ${eme.map(entry => {
            const step = text(entry.step, '?');
            if (step === 'access') return `access:${text(entry.system, '?')}${entry.ok === false ? `!${text(entry.error, '')}` : '=ok'}`;
            if (step === 'keys') return entry.ok === false ? `keys!${text(entry.error, '')}` : 'keys=ok';
            if (step === 'message') return `msg:${count(entry.bytes)}B`;
            if (step === 'update') return `update:${count(entry.bytes)}B`;
            return step;
        }).join(' ')}`);
        // 请求了什么、实际批了什么：Apple 要的 robustness 与 WebView 能给的是不是同一个。
        const granted = eme.filter(entry => entry.step === 'access' && entry.ok !== false).map(entry => (
            `cfg=${text(entry.configurations, '(none)')} granted=${text(entry.granted, '(none)')}`
        ));
        if (granted.length) lines.push(`  eme config: ${granted[0]}`);
    } else {
        lines.push('  eme: (none)');
    }

    const mediaLog = Array.isArray(page.mediaLog) ? page.mediaLog as Array<Record<string, unknown>> : [];
    if (mediaLog.length) {
        lines.push('  media log (tail):');
        for (const event of mediaLog.slice(-10)) {
            lines.push(`    #${count(event.index)} ${text(event.type, '?')} t=${count(event.t)}`
                + ` ready=${count(event.ready)} network=${count(event.network)}`
                + `${typeof event.error === 'number' ? ` error=${event.error}` : ''}`);
        }
    }

    const consoleLines = bridge.console;
    if (Array.isArray(consoleLines) && consoleLines.length) {
        lines.push('  page log (tail):');
        for (const line of consoleLines.slice(-12)) {
            lines.push(`    ${String(line).slice(0, 240)}`);
        }
    } else {
        lines.push('  page log (tail): (none)');
    }
    return lines;
};
