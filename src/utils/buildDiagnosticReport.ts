import { getLibraryTraceLines } from '../nativeBridge/api/libraryTrace.js';
import { getQrLoginTraceLines } from '../nativeBridge/api/qrLoginTrace.js';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { readCrashDiagnostics, readDiagnosticsHeartbeats } from './crashDiagnostics';
import { readPlaybackContinuitySnapshot } from './mediaDiagnostics';
import { readCpuProbeForDiagnostics, readFrameTimingSnapshot, readFpsHistory } from './frameTimingDiagnostics';
import { getGlobalVisualizerFrameRate } from './frameRateLimiter';
import { readAppUpdateDiagnostics } from '../services/appUpdate/appUpdateDiagnostics';
import { modelsPresent } from '../services/analysis/modelAvailability';
import { canRunBeatThis } from '../services/analysis/beatThis';
import { probeBeatThisGpu, readBeatThisGpuDiagnostics } from '../services/analysis/beatThisGpu';
import { readBeatFxSourceDiagnostics } from '../services/beatFx/beatFxSource';
import { readBeatFxWanted } from '../services/beatFx/beatFxWanted';
import { readDrumHitsDiagnostics } from '../services/analysis/drumHits';
import { isCapacitorAndroid } from '../platform/runtime';
import {
    readAndroidDisplayFrameRateInfo,
    readAndroidDisplayFrameRateJournal,
    readLastDisplayFrameRateRequest,
    sampleAndroidDisplayFrameRate,
} from '../services/androidDisplayFrameRate';
import { readLastAiThemeAttempt, readAiThemeAttempts, readFailedAiThemeAttempts } from './aiThemeDiagnostics';
import { isNeutralAudioEffects } from './audioEffects';
import { getCollectionOrderDiagnosticLines } from './collectionOrderDiagnostics';
import { getOnlineMutationDiagnosticLines } from './onlineMutationDiagnostics';
import { getOnlinePlaybackDiagnosticLines } from './onlinePlaybackDiagnostics';
import { readAppleMusicDiagnosticLines } from '../services/onlineMusic/appleMusic/appleMusicDiagnostics';
import { getLyricsDiagnosticLines } from './lyricsDiagnostics';
import { getLocalLibraryDiagnosticLines } from './localLibraryDiagnostics';
import {
    canPersistVideoLayerFile,
    loadVideoLayerFileHandle,
} from '../services/videoLayerFile';
import { useVideoLayerSettingsStore } from '../stores/useVideoLayerSettingsStore';
import { collectWebGL2Diagnostics, formatWebGL2DiagnosticsLine } from './webglDiagnostics';
import { getModResolutionGuardStats } from '../mods/runtime/modResolutionGuard';
import { getNativeStageStatsSnapshot } from '../services/nativeStageDiagnostics';
import { BUILTIN_VISUALIZER_BACKGROUND_MODES } from '../types/visualizerModes';
import {
    VISUALIZER_BACKGROUND_REGISTRY,
    hasVisualizerBackgroundMode,
} from '../components/visualizer/backgrounds/registry';

// src/utils/buildDiagnosticReport.ts
// 设置 → 帮助 → 复制诊断数据。给用户原样贴进 issue 用，所以字段固定为英文并包在代码块里。
// 只包含可以公开的内容：版本、运行环境、请求形态与条数，不含 cookie、token、账号。

const readLocalStorageFlag = (key: string): string => {
    try {
        const value = localStorage.getItem(key);
        if (value == null) return 'absent';
        return value.length > 0 ? `len=${value.length}` : 'empty';
    } catch {
        return 'unavailable';
    }
};

/** 原始值，不带长度或隐私含义——用于那些本身就是设置数值的键。 */
const readLocalStorageValue = (key: string): string => {
    try {
        const value = localStorage.getItem(key);
        return value == null || value === '' ? '(default)' : value;
    } catch {
        return 'unavailable';
    }
};

const formatPlaybackHeartbeat = (raw: string | null): string => {
    if (!raw) return '(none)';
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        const at = typeof value.at === 'number' ? new Date(value.at).toISOString() : 'unknown';
        return `at=${at}`
            + ` visualizer=${value.visualizer ?? 'unknown'}`
            + ` background=${value.background ?? 'unknown'}`
            + ` playing=${value.playing === true}`
            + ` visibility=${value.visibility ?? 'unknown'}`
            + ` foreground=${value.foreground === true}`
            + ` screenOn=${value.screenOn === true}`;
    } catch {
        return raw;
    }
};

const formatServiceHeartbeat = (raw: string | null): string => {
    if (!raw) return '(none)';
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        const at = typeof value.at === 'number' ? new Date(value.at).toISOString() : 'unknown';
        return `at=${at}`
            + ` playing=${value.playing === true}`
            + ` wakeLock=${value.wakeLock ?? 'unknown'}`
            + ` wifiLock=${value.wifiLock ?? 'unknown'}`
            + ` foreground=${value.foreground === true}`;
    } catch {
        return raw;
    }
};

/**
 * 背景选项列表只有一个来源：背景 registry。这里同时导出「声明的内置列表」和「运行时实际列表」，
 * 用来区分旧版本没有 nomand、mod 把条目删掉、以及注册表加载失败三种情况。
 */
const readVisualizerBackgroundLines = (): string[] => {
    const declared: string[] = [...BUILTIN_VISUALIZER_BACKGROUND_MODES];
    const live = VISUALIZER_BACKGROUND_REGISTRY.map(entry => String(entry.mode));
    const missing = declared.filter(mode => !live.includes(mode));
    const extra = live.filter(mode => !declared.includes(mode));
    return [
        `  declared builtins: ${declared.join(', ') || '(none)'}`,
        `  live registry: ${live.join(', ') || '(empty)'}`,
        `  nomand present: ${hasVisualizerBackgroundMode('nomand') ? 'yes' : 'no'}`,
        `  missing builtins: ${missing.length ? missing.join(', ') : '(none)'}`,
        `  extra/mod modes: ${extra.length ? extra.join(', ') : '(none)'}`,
        `  stored mode: ${readLocalStorageValue('visualizer_background_mode')}`,
    ];
};

const formatSeconds = (value: number | null): string => (
    value === null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(2)}s`
);

const formatMilliseconds = (value: number | null): string => (
    value === null || !Number.isFinite(value) ? 'n/a' : `${Math.round(value)}ms`
);

/**
 * 播放连续性现场：缓冲中断、网络停滞、主线程卡顿、输出链路和音频效果一起导出，避免把
 * 网易云的偶发卡顿误判成取链问题，也避免把用户开着的噪声音效当成平台故障。
 */
const readPlaybackContinuityLines = (): string[] => {
    const continuity = readPlaybackContinuitySnapshot();
    const audioSettings = useAudioSettingsStore.getState();
    const playback = usePlaybackStore.getState();
    const equalizer = audioSettings.audioEqualizerSettings;
    const effects = equalizer.effects;
    const lastEventAt = continuity.lastEventAt
        ? new Date(continuity.lastEventAt).toISOString()
        : '(not recorded)';
    const stream = continuity.stream;
    const decodeKbps = (() => {
        const bytes = continuity.decodedBytes;
        const media = continuity.decodedMediaSec;
        const baseBytes = continuity.decodeBaseBytes;
        const baseMedia = continuity.decodeBaseMediaSec;
        if (bytes === null || media === null || baseBytes === null || baseMedia === null) return null;
        const deltaBytes = bytes - baseBytes;
        const deltaMedia = media - baseMedia;
        if (deltaBytes <= 0 || deltaMedia <= 1) return null;
        return (deltaBytes * 8) / deltaMedia / 1000;
    })();
    return [
        `  source: ${continuity.source}`,
        // 「歌卡」这类反馈先看这一行：拿到的是 mp3 还是 flac、多少码率、是不是试听片段。
        `  stream: ${stream
            ? `${stream.provider} level=${stream.resolvedLevel}`
                + `${stream.requestedLevel ? `(requested ${stream.requestedLevel})` : ''}`
                + ` br=${stream.bitrateKbps === null ? 'n/a' : `${Math.round(stream.bitrateKbps)}kbps`}`
                + ` format=${stream.format} host=${stream.host}`
                + `${stream.sizeMb === null ? ''
                    : ` size=${(stream.sizeMb < 1 ? stream.sizeMb.toFixed(2) : stream.sizeMb.toFixed(1))}MB`}`
                + `${stream.trial ? ' TRIAL-CLIP' : ''}`
            : '(not recorded)'}`,
        `  deck: ${continuity.deck} readyState=${continuity.readyState} networkState=${continuity.networkState}`,
        `  buffer: ahead=${formatSeconds(continuity.bufferedAheadSec)} ranges=${continuity.bufferedRanges}`,
        `  interruptions: waiting=${continuity.waitingCount} total=${formatMilliseconds(continuity.waitingTotalMs)}`
            + ` max=${formatMilliseconds(continuity.waitingMaxMs)} last=${formatMilliseconds(continuity.lastWaitingMs)}`,
        `  network stalls: stalled=${continuity.stalledCount} errors=${continuity.errorCount}`,
        // 播放中如果位置/速率被改过（我们或系统），会在这里留下计数；配合解码进度就能分清
        // 「网络不够」「解码跟不上」「我们动了播放位置」这三种完全不同的卡。
        `  element events: seeking=${continuity.seekingCount} seeked=${continuity.seekedCount}`
            + ` ratechange=${continuity.rateChangeCount} rate=${continuity.playbackRate ?? 'n/a'}`,
        `  decode: bytes=${continuity.decodedBytes === null ? 'n/a' : `${(continuity.decodedBytes / 1048576).toFixed(1)}MB`}`
            + ` media=${formatSeconds(continuity.decodedMediaSec)}`
            + ` avg=${decodeKbps === null ? 'n/a' : `≈${Math.round(decodeKbps)}kbps`}`,
        `  main-thread stalls: count=${continuity.clockLagCount}`
            + ` total=${formatMilliseconds(continuity.clockLagTotalMs)}`
            + ` max=${formatMilliseconds(continuity.clockLagMaxMs)}`
            + ` last=${formatMilliseconds(continuity.lastClockLagMs)}`,
        `  audio clock: samples=${continuity.clockSamples}`
            + ` lag=${continuity.clockLagCount}`
            + ` progress=${continuity.lastClockProgressRatio === null
                ? 'n/a'
                : `${(continuity.lastClockProgressRatio * 100).toFixed(0)}%`}`
            + ` (media/wall; <75% counts as a stall)`,
        `  last audio event: ${continuity.lastEvent} at=${lastEventAt}`,
        `  audio context: state=${continuity.audioContextState}`
            + ` sampleRate=${continuity.audioContextSampleRate ?? 'n/a'}`
            + ` baseLatency=${formatSeconds(continuity.audioContextBaseLatencySec)}`
            + ` outputLatency=${formatSeconds(continuity.audioContextOutputLatencySec)}`
            + ` latencyHint=${continuity.audioContextLatencyHint}`
            + ` renderCapacity=${continuity.audioContextRenderCapacity === null
                ? 'n/a'
                : continuity.audioContextRenderCapacity.toFixed(3)}`
            + ` stateChanges=${continuity.audioContextStateChangeCount}`
            + ` lastStateChange=${continuity.audioContextLastStateChangeAt
                ? new Date(continuity.audioContextLastStateChangeAt).toISOString()
                : 'n/a'}`,
        `  output settings: quality=${audioSettings.audioQuality} replayGain=${playback.replayGainMode}`
            + ` fade=${audioSettings.playbackFadeEnabled ? 'on' : 'off'}`,
        `  effects: enabled=${equalizer.enabled ? 'yes' : 'no'}`
            + ` path=${equalizer.enabled && !isNeutralAudioEffects(effects) ? 'processed' : 'bypassed'}`
            + ` highpass=${effects.highpass} lowpass=${effects.lowpass}`
            + ` drive=${effects.drive} crush=${effects.crush} wow=${effects.wow}`
            + ` noise=${effects.noise} width=${effects.width} space=${effects.space} punch=${effects.punch}`,
    ];
};

/**
 * 帧耗时与卡顿归属。用户报「卡顿」时先看这一段：
 * 单帧阻塞 100ms 以上（loafHeavy）即使整体统计看着平滑，也算我们这边的卡 —— 现场那次
 * 150ms 阻塞（脚本 198ms、样式布局 0ms、出处在 LatticeLyrics 的 rAF 回调）就是这么被抓到的。
 */
export type StutterAttributionInput = {
    renderHealth: 'smooth' | 'mild' | 'heavy' | 'unknown';
    loafHeavy: boolean;
    scriptHeavy: boolean;
    audioStalled: boolean;
};

/** 卡顿归因（纯函数，便于回归）。 */
export const resolveStutterAttribution = (input: StutterAttributionInput): string => {
    const renderHeavy = input.renderHealth === 'heavy';
    if (input.renderHealth === 'unknown' && !input.loafHeavy) return 'insufficient-samples';
    if ((renderHeavy || input.loafHeavy) && input.scriptHeavy) return 'app-script';
    if (renderHeavy && input.audioStalled) return 'device-throughput';
    if (renderHeavy || input.loafHeavy) return 'ui-thread-render';
    if (input.audioStalled) return 'audio-pipeline';
    return 'clean';
};

/**
 * 智能动感模式的现场：开关是什么、模型在不在、能不能跑（GPU 适配器、worker、模型建没建起来），
 * 以及最近一次取拍点到底用了模型还是回退到内置估计。
 */
const readSmartBeatLines = async (): Promise<string[]> => {
    const setting = readLocalStorageValue('visualizer_smart_beat');
    const models = modelsPresent();
    const gpu = readBeatThisGpuDiagnostics();
    const adapter = await withDeadline(probeBeatThisGpu(), 1500, false);
    const last = readBeatFxSourceDiagnostics();
    const wanted = readBeatFxWanted();
    const drums = readDrumHitsDiagnostics();
    const resident = gpu.resident.length
        ? gpu.resident.map(entry => entry.model + ' ' + Math.round(entry.bytes / 1048576) + 'MB').join(', ')
        : '(none)';
    return [
        '  setting: ' + (setting.length > 220 ? setting.slice(0, 220) + '…' : setting),
        '  bridge: ' + (isCapacitorAndroid() ? 'android-native' : (typeof window.electron?.runBeatThis === 'function' ? 'electron' : 'none')),
        '  models: beat_this=' + (models.beat_this ? 'yes' : 'no')
            + ' htdemucs=' + (models.htdemucs ? 'yes' : 'no')
            + ' htdemucs_gpu=' + (models.htdemucs_gpu ? 'yes' : 'no'),
        '  can run beat_this: ' + (canRunBeatThis() ? 'yes' : 'no') + ' gpu adapter: ' + (adapter ? 'yes' : 'no'),
        '  gpu: unsupported=' + (gpu.unsupported ? 'yes' : 'no')
            + ' worker=' + (gpu.workerActive ? 'yes' : 'no')
            + ' ready=[' + gpu.readyModels.join(',') + ']'
            + ' resident=[' + resident + ']'
            + ' last-error=' + (gpu.lastError ?? '(none)')
            + (gpu.failedModels.length ? ' failed=[' + gpu.failedModels.join(',') + ']' : ''),
        '  wanted: ' + (wanted
            ? 'beats=' + (wanted.beats ? 'yes' : 'no')
                + ' drums=' + (wanted.drums ? 'yes' : 'no')
                + ' vocals=' + (wanted.vocals ? 'yes' : 'no')
                + ' storedOnly=' + (wanted.storedOnly ? 'yes' : 'no')
                + ' key=' + (wanted.key ? 'set' : '(none)')
            : '(nothing asked for yet)'),
        '  drums: tracks=' + drums.tracks.length
            + ' running=' + drums.running
            + ' settled=' + drums.settled
            + ' last=' + (drums.last
                ? 'hits=' + drums.last.hits + (drums.last.drumless ? ' drumless' : '') + ' at=' + new Date(drums.last.at).toISOString()
                : '(none)')
            + ' error=' + (drums.lastError ?? '(none)'),
        '  last lookup: ' + (last
            ? 'at=' + new Date(last.at).toISOString()
                + ' source=' + last.source
                + ' storedOnly=' + (last.storedOnly ? 'yes' : 'no')
                + (last.retry ? ' retry=yes' : '')
                + (last.note ? ' note=' + last.note : '')
            : '(none since start)'),
    ];
};

/** 应用内更新的现场：包里的地址、Cordova 桥的形态、读到的安装版本、最近一次检查的结果。 */
const readAppUpdateLines = (): string[] => {
    const update = readAppUpdateDiagnostics();
    const installed = update.installed
        ? update.installed.versionCode + ' (' + update.installed.versionName + ')'
        : 'n/a';
    const last = update.lastCheck
        ? 'at=' + update.lastCheck.at
            + ' status=' + update.lastCheck.status
            + ' available=' + (update.lastCheck.availableVersionCode ?? 'n/a')
            + ' remote=' + (update.lastCheck.remoteVersionName ?? 'n/a')
            + ' current=' + (update.lastCheck.currentVersionCode ?? 'n/a')
            + ' (' + (update.lastCheck.currentVersionName ?? 'n/a') + ')'
            + ' skipped=' + (update.lastCheck.skippedVersionCode ?? 'n/a')
            + ' manual=' + (update.lastCheck.manual ? 'yes' : 'no')
            + ' decision=' + update.lastCheck.decision
            + (update.lastCheck.error ? ' error=' + update.lastCheck.error : '')
        : '(none)';
    return [
        '  endpoint: ' + (update.endpoint || '(none)') + ' configured=' + (update.configured ? 'yes' : 'no'),
        '  installer: ' + update.installer,
        '  installed: ' + installed,
        '  last check: ' + last,
    ];
};

/**
 * 「选了 120，不动就掉到 60」这类报告的分流依据：设置里选的档位、限幅器实际生效的档位、
 * 系统此刻的刷新率与屏幕支持的档位、窗口和 View 各申请了多少、以及连续两秒的刷新率采样。
 * 采样存在的意义就是把「触摸时 120、静止后回 60」的回落过程直接记下来，不靠复述。
 */
/** 把逐秒的刷新率压成「每 10 秒一个 min/max」，再从序列里找回落点，报告才读得下来。 */
const summarizeDisplayHistory = (journal: Array<{ ageMs: number; hz: number }>): string[] => {
    if (journal.length === 0) return ['  history: (no samples yet)'];
    const ordered = journal.slice().sort((a, b) => b.ageMs - a.ageMs);
    const values = ordered.map(point => point.hz);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const spanSeconds = Math.max(0, Math.round((ordered[0]!.ageMs - ordered[ordered.length - 1]!.ageMs) / 1000));
    const bucketMs = 10_000;
    const buckets = new Map<number, { min: number; max: number }>();
    for (const point of ordered) {
        const bucket = Math.floor(point.ageMs / bucketMs);
        const current = buckets.get(bucket);
        buckets.set(bucket, current
            ? { min: Math.min(current.min, point.hz), max: Math.max(current.max, point.hz) }
            : { min: point.hz, max: point.hz });
    }
    const lines = [
        `  history: span=${spanSeconds}s points=${ordered.length} min=${min.toFixed(1)}Hz max=${max.toFixed(1)}Hz avg=${avg.toFixed(1)}Hz`,
        `  history buckets (10s each, min/max, oldest→newest): ${[...buckets.entries()]
            .sort((a, b) => b[0] - a[0])
            .map(([, bucket]) => `${bucket.min.toFixed(0)}/${bucket.max.toFixed(0)}`)
            .join(' ') || '(none)'}`,
    ];
    // 回落点：前面至少三秒都在高刷，然后落到 70Hz 以下 —— 就是「不动就掉到 60」的那一刻。
    for (let index = 3; index < ordered.length; index += 1) {
        const before = ordered.slice(index - 3, index).every(point => point.hz >= 90);
        if (!before || ordered[index]!.hz > 70) continue;
        let end = index;
        while (end + 1 < ordered.length && ordered[end + 1]!.hz <= 70) end += 1;
        lines.push(`  history drop: at -${(ordered[index]!.ageMs / 1000).toFixed(0)}s `
            + `(from ${ordered[index - 1]!.hz.toFixed(0)}Hz to ${ordered[index]!.hz.toFixed(0)}Hz, `
            + `stayed ${((ordered[end]!.ageMs - ordered[index]!.ageMs) / 1000).toFixed(0)}s)`);
        break;
    }
    return lines;
};

const readDisplayFrameRateLines = async (): Promise<string[]> => {
    const setting = readLocalStorageValue('visualizer_frame_rate');
    const limiter = getGlobalVisualizerFrameRate();
    const info = await readAndroidDisplayFrameRateInfo();
    const sample = await sampleAndroidDisplayFrameRate(2000);
    const journal = await readAndroidDisplayFrameRateJournal();
    const request = readLastDisplayFrameRateRequest();
    const hz = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}Hz` : 'n/a');
    const lines = [
        `  setting: ${setting} limiter: ${limiter}`,
        info
            ? `  system: refresh=${hz(info.refreshRate)} mode=${info.modeWidth ?? '?'}x${info.modeHeight ?? '?'}@${hz(info.modeRefreshRate)}`
                + ` window=${hz(info.preferredRefreshRate)} min=${hz(info.preferredMinRefreshRate)} max=${hz(info.preferredMaxRefreshRate)}`
                + ` view-requested=${hz(info.requestedFrameRate)}`
                + ` screenOn=${info.screenOn === true ? 'yes' : 'no'}`
            : '  system: (native display info unavailable)',
        info?.supportedModes?.length
            ? `  supported modes: ${info.supportedModes.join(', ')}`
            : '  supported modes: n/a',
        sample && sample.samples.length
            ? `  sampled ${((sample.samples.length - 1) / 10).toFixed(1)}s: min=${hz(Math.min(...sample.samples))}`
                + ` max=${hz(Math.max(...sample.samples))}`
                + ` avg=${hz(sample.samples.reduce((sum, value) => sum + value, 0) / sample.samples.length)}`
                + ` points=${sample.samples.length} values=${sample.samples.map(value => value.toFixed(0)).join(',')}`
            : '  sampled: (unavailable)',
        request
            ? `  request: requested=${request.fps}Hz ok=${request.ok ? 'yes' : 'no'}`
                + `${request.viewReadback === undefined ? '' : ` view-readback=${request.viewReadback.toFixed(1)}Hz`}`
                + `${request.windowPreferred === undefined ? '' : ` window=${request.windowPreferred.toFixed(1)}Hz`}`
                + `${request.windowMin === undefined ? '' : ` min=${request.windowMin.toFixed(1)}Hz`}`
                + `${request.windowMax === undefined ? '' : ` max=${request.windowMax.toFixed(1)}Hz`}`
                + `${request.windowModeId === undefined ? '' : ` mode-id=${request.windowModeId}`}`
                + `${request.error ? ` error=${request.error}` : ''} at=${request.at}`
            : '  request: (none sent this session)',
        ...(journal ? summarizeDisplayHistory(journal) : ['  history: (unavailable)']),
    ];
    return lines;
};

/**
 * 帧间隔分位数说明界面掉不掉帧，longtask 说明是不是我们自己的脚本占住主线程，
 * 核数 / 内存 / 处理器探针说明设备本身够不够用。三条凑在一起才能分清
 * 「我们的渲染开销」和「用户处理器性能不足」。
 */
const readFrameTimingLines = (): string[] => {
    const frames = readFrameTimingSnapshot();
    const continuity = readPlaybackContinuitySnapshot();
    const stats = frames.stats;
    const playback = usePlaybackStore.getState();
    // 探针自己会阻塞主线程，放在读取快照之后：跳过窗口已经在采样侧设好，不会污染上面的数字。
    const cpu = readCpuProbeForDiagnostics();
    const percent = (value: number | null) => (value === null ? 'n/a' : `${value.toFixed(1)}ms`);
    const fps = (value: number | null) => (value === null ? 'n/a' : value.toFixed(1));
    const ratio = (count: number) => (
        stats.count > 0 ? `${((count / stats.count) * 100).toFixed(2)}%` : 'n/a'
    );
    const audioStalled = continuity.waitingCount > 0
        || continuity.stalledCount > 0
        || continuity.errorCount > 0;
    const bufferLow = continuity.bufferedAheadSec !== null && continuity.bufferedAheadSec < 5;
    const loaf = frames.longAnimationFrames;
    // 单帧阻塞 100ms 以上用户一定看得见，即使整体帧统计被大量平滑帧稀释成 smooth，也要按它定性。
    const loafHeavy = loaf.worstBlockingMs >= 100;
    // 我们的脚本占住主线程，和 GPU/合成器跟不上（设备渲染能力）是两种不同的卡顿。
    // 有 LoAF 数据时用「脚本 vs 样式/布局」的实际占比判断，比只看长任务条数可靠得多；
    // 没有 LoAF 的旧内核退回长任务启发式。
    const scriptHeavy = loaf.count > 0
        ? loaf.scriptMs >= loaf.styleLayoutMs && loaf.scriptMs >= 30
        : (frames.longTasks.count >= 3 || frames.longTasks.maxMs >= 200);
    const renderHeavy = frames.renderHealth === 'heavy';
    const attribution = resolveStutterAttribution({
        renderHealth: frames.renderHealth,
        loafHeavy,
        scriptHeavy,
        audioStalled,
    });

    return [
        `  sampler: installed=${frames.installed ? 'yes' : 'no'} visible=${(frames.visibleMs / 1000).toFixed(1)}s`
            + ` hidden=${(frames.hiddenMs / 1000).toFixed(1)}s frames=${frames.frameCount}`
            + ` recent-window=${stats.count}`,
        `  device: cores=${frames.cores ?? 'n/a'}`
            + ` memory=${frames.memoryGb === null ? 'n/a' : `${frames.memoryGb}GB`} class=${frames.deviceClass}`,
        `  display: refresh=${frames.refreshHz === null ? 'n/a' : `${frames.refreshHz}Hz (estimated from frame intervals)`}`
            + ` viewport=${typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`}`,
        `  fps: recent-second=${fps(frames.recentSecondFps)} worst-second=${fps(frames.worstSecondFps)}`,
        // 逐秒时间线：和 display frame rate 的 history 摆在一起，才看得出「屏幕 120、页面 60」。
        `  fps history (1s buckets, oldest→newest): ${readFpsHistory().map(value => value.toFixed(0)).join(',') || '(none)'}`,
        `  frame time: p50=${percent(stats.p50Ms)} p90=${percent(stats.p90Ms)} p95=${percent(stats.p95Ms)}`
            + ` p99=${percent(stats.p99Ms)} max=${percent(stats.maxMs)}`,
        // 「日常播放不卡、一移动就掉帧」：移动中的帧单独一行，直接和上面的整体分位数对比。
        `  motion frames (scroll/touch): count=${frames.motion.count}`
            + ` p50=${percent(frames.motion.stats.p50Ms)}`
            + ` p95=${percent(frames.motion.stats.p95Ms)}`
            + ` max=${percent(frames.motion.stats.maxMs)}`
            + ` slow>32ms=${frames.motion.slowCount}`
            + ` jank>50ms=${frames.motion.jankCount}`
            + ` freeze>100ms=${frames.motion.freezeCount}`,
        `  dropped frames: slow>32ms=${stats.slowCount} (${ratio(stats.slowCount)})`
            + ` jank>50ms=${stats.jankCount} (${ratio(stats.jankCount)}) freeze>100ms=${stats.freezeCount}`,
        `  session totals: slow=${frames.sessionSlowCount} jank=${frames.sessionJankCount}`
            + ` freeze=${frames.sessionFreezeCount} longest-freeze=${formatMilliseconds(frames.longestFreezeMs)}`,
        `  long tasks (>50ms): count=${frames.longTasks.count}`
            + ` total=${formatMilliseconds(frames.longTasks.totalMs)} max=${formatMilliseconds(frames.longTasks.maxMs)}`
            + ` attribution: self=${frames.longTasks.selfCount} other=${frames.longTasks.otherCount}`
            + ` unknown=${frames.longTasks.unknownCount}`,
        // 这一行才说得清「到底是被谁占住的」：脚本 / 样式与布局 / 最重的那个文件与函数。
        `  long animation frames (>50ms): count=${loaf.count}`
            + ` max-blocking=${formatMilliseconds(loaf.maxBlockingMs)}`
            + ` scripts=${formatMilliseconds(loaf.scriptMs)}`
            + ` style+layout=${formatMilliseconds(loaf.styleLayoutMs)}`
            + ` worst=${formatMilliseconds(loaf.worstBlockingMs)}`
            + ` (script ${formatMilliseconds(loaf.worstScriptMs)}`
            + ` + style/layout ${formatMilliseconds(loaf.worstStyleLayoutMs)}`
            + ` @${loaf.worstInvoker || 'unknown'}`
            + `${loaf.worstAtMs !== null && frames.installedAtMs !== null
                ? ` worst@+${((loaf.worstAtMs - frames.installedAtMs) / 1000).toFixed(1)}s`
                : ''})`,
        ...loaf.samples
            .slice()
            .sort((a, b) => b.blockingMs - a.blockingMs)
            .slice(0, 5)
            .map(sample => (
                `  long frame: +${frames.installedAtMs === null
                    ? 'n/a'
                    : `${Math.max(0, (sample.atMs - frames.installedAtMs) / 1000).toFixed(1)}s`}`
                + ` blocking=${formatMilliseconds(sample.blockingMs)}`
                + ` script=${formatMilliseconds(sample.scriptMs)}`
                + ` style+layout=${formatMilliseconds(sample.styleLayoutMs)}`
                + ` @${sample.invoker}`
            )),
        `  cpu probe: ${(cpu.ops / 1e6).toFixed(1)}M ops in ${cpu.durationMs.toFixed(0)}ms`
            + ` index=${cpu.index} (${(cpu.opsPerSecond / 1e6).toFixed(1)}M ops/s, 跨设备相对值)`,
        `  playback while sampling: state=${String(playback.playerState)}`
            + ` audio=${audioStalled ? 'stalled' : 'clean'} buffer-ahead=${formatSeconds(continuity.bufferedAheadSec)}`
            + `${bufferLow ? ' (low)' : ''}`,
        `  render health: ${frames.renderHealth}`,
        // 归属结论连同两个决定性输入一起写出来，避免只看到结论没法复核。
        `  attribution: ${attribution} (cpu=${cpu.index}, audio=${audioStalled ? 'stalled' : 'clean'})`,
    ];
};

const readNativePlaybackDiagnostics = async (): Promise<{
    cover?: string;
    status?: string;
    detail?: string;
    at?: number;
    applied?: boolean;
    power?: string;
} | null> => {
    if (typeof window === 'undefined') return null;
    const plugin = (window as any).Capacitor?.Plugins?.FoliaNative;
    if (typeof plugin?.getPlaybackDiagnostics !== 'function') return null;
    try {
        return await plugin.getPlaybackDiagnostics();
    } catch {
        return null;
    }
};

/**
 * 手机厂商屏幕顶部（挖孔 / 刘海）的现场。
 *
 * 「顶部还有黑边」时最需要知道的就是系统到底报了什么：cutout mode 是否已经切成
 * shortEdges、有没有识别到挖孔、安全区矩形是多少。全是设备侧只读信息，不含隐私。
 */
const readDisplayCutoutLines = async (): Promise<string[]> => {
    if (typeof window === 'undefined') return ['  (no window)'];
    const plugin = (window as unknown as {
        Capacitor?: { getPlatform?: () => string; Plugins?: { FoliaNative?: { getDisplayCutout?: () => Promise<unknown> } } };
    }).Capacitor;
    if (plugin?.getPlatform?.() !== 'android') {
        return ['  (not an android runtime)'];
    }
    const native = plugin?.Plugins?.FoliaNative;
    if (typeof native?.getDisplayCutout !== 'function') {
        return ['  (native cutout diagnostics unavailable)'];
    }
    try {
        const snapshot = await native.getDisplayCutout() as {
            available?: boolean;
            sdk?: number;
            layoutInDisplayCutoutMode?: number;
            hasCutout?: boolean;
            safeInsets?: { left?: number; top?: number; right?: number; bottom?: number };
            boundingRects?: Array<{ left?: number; top?: number; right?: number; bottom?: number }>;
            screenHeightPx?: number;
            decorHeightPx?: number;
            contentHeightPx?: number;
            webViewHeightPx?: number;
            webViewPaddingTopPx?: number;
            contentPaddingTopPx?: number;
            decorPaddingTopPx?: number;
            visibleFrame?: { left?: number; top?: number; right?: number; bottom?: number };
        } | null;
        if (!snapshot || snapshot.available === false) {
            return ['  (no decor view)'];
        }
        const insets = snapshot.safeInsets;
        const rects = Array.isArray(snapshot.boundingRects) ? snapshot.boundingRects : [];
        return [
            `  sdk: ${snapshot.sdk ?? 'unknown'}`,
            `  layoutInDisplayCutoutMode: ${describeCutoutMode(snapshot.layoutInDisplayCutoutMode)}`,
            `  hasCutout: ${snapshot.hasCutout ? 'yes' : 'no'}`,
            insets
                ? `  safe inset: left=${insets.left ?? 0} top=${insets.top ?? 0} right=${insets.right ?? 0} bottom=${insets.bottom ?? 0}`
                : '  safe inset: (none)',
            rects.length
                ? `  bounding rects: ${rects.map(rect => `[${rect.left ?? 0},${rect.top ?? 0},${rect.right ?? 0},${rect.bottom ?? 0}]`).join(' ')}`
                : '  bounding rects: (none)',
            `  height: screen=${snapshot.screenHeightPx ?? 'n/a'}`
                + ` decor=${snapshot.decorHeightPx ?? 'n/a'}`
                + ` content=${snapshot.contentHeightPx ?? 'n/a'}`,
            `  web view: height=${snapshot.webViewHeightPx ?? 'n/a'}`
                + ` paddingTop=${snapshot.webViewPaddingTopPx ?? 'n/a'}`,
            `  padding: decorTop=${snapshot.decorPaddingTopPx ?? 'n/a'}`
                + ` contentTop=${snapshot.contentPaddingTopPx ?? 'n/a'}`,
            snapshot.visibleFrame
                ? `  visible frame: [${snapshot.visibleFrame.left ?? 0},${snapshot.visibleFrame.top ?? 0},`
                    + `${snapshot.visibleFrame.right ?? 0},${snapshot.visibleFrame.bottom ?? 0}]`
                : '  visible frame: (unknown)',
        ];
    } catch (error) {
        return [`  cutout diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`];
    }
};

/** Android 的 layoutInDisplayCutoutMode 常量值对应关系，读起来比裸数字直观。 */
const describeCutoutMode = (mode: number | undefined): string => {
    if (mode == null) return 'unknown';
    if (mode === 0) return '0 (default)';
    if (mode === 1) return '1 (shortEdges)';
    if (mode === 2) return '2 (never)';
    if (mode === 3) return '3 (always)';
    return String(mode);
};

/**
 * 底部控制条的实际几何。
 *
 * 「控制条跑到画面中间」有两种完全不同的成因，光看设置值分不出来：
 * 1. 持久化的基线偏移量被调大了（值就在 `player_bottom_bar_offset`）；
 * 2. 那层 `absolute` 的包含块不是整屏（包含块被压扁后，`bottom: 32px` 也会落在画面中间）。
 * 所以这里把控制条矩形、它所在的绝对定位层、以及该层的包含块一并导出。
 */
const readBottomBarGeometry = (): string[] => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return ['  (no dom)'];
    }
    try {
        const bar = document.querySelector('[data-ponder="player-bar"]') as HTMLElement | null;
        if (!bar) return ['  bar: not mounted'];

        const rect = bar.getBoundingClientRect();

        const findAncestor = (
            start: HTMLElement | null,
            match: (element: HTMLElement) => boolean,
        ): HTMLElement | null => {
            let node: HTMLElement | null = start?.parentElement ?? null;
            while (node && node !== document.body) {
                if (match(node)) return node;
                node = node.parentElement;
            }
            return null;
        };

        // 实际定位层：最近的 absolute 祖先，它的 bottom 就是这条控制条的定位值。
        const layer = findAncestor(bar, element => getComputedStyle(element).position === 'absolute');
        const layerStyle = layer ? getComputedStyle(layer) : null;

        // 包含块：定位层之下的最近定位祖先，它的高度决定 bottom 是从哪里算起。
        const containingBlock = findAncestor(layer, element => getComputedStyle(element).position !== 'static');
        const blockRect = containingBlock?.getBoundingClientRect() ?? null;

        // 手机适配的联动按钮现场：右下角齿轮与左下角命令面板按钮应当同高。
        const describeChromeButton = (selector: string, label: string): string => {
            const element = document.querySelector(selector) as HTMLElement | null;
            if (!element) return `  ${label}: not mounted`;
            const buttonRect = element.getBoundingClientRect();
            return `  ${label}: top=${Math.round(buttonRect.top)} bottom=${Math.round(buttonRect.bottom)}`
                + ` width=${Math.round(buttonRect.width)} height=${Math.round(buttonRect.height)}`
                + ` cssBottom=${getComputedStyle(element).bottom}`;
        };

        return [
            `  viewport: ${window.innerWidth}x${window.innerHeight}`,
            `  bar rect: top=${Math.round(rect.top)} bottom=${Math.round(rect.bottom)}`
                + ` width=${Math.round(rect.width)} left=${Math.round(rect.left)} right=${Math.round(rect.right)}`
                + ` height=${Math.round(rect.height)} gapToViewportBottom=${Math.round(window.innerHeight - rect.bottom)}`,
            `  bar phone fit: html=${document.documentElement.getAttribute('data-folia-phone-fit') ?? '(none)'}`
                + ` orientation=${document.documentElement.getAttribute('data-folia-phone-orientation') ?? '(none)'}`
                + ` expanded=${bar.getAttribute('data-folia-player-bar-expanded') ?? '(none)'}`
                + ` computedWidth=${getComputedStyle(bar).width}`,
            `  layer: position=${layerStyle?.position ?? 'n/a'} bottom=${layerStyle?.bottom ?? 'n/a'}`,
            `  containing block: ${containingBlock?.tagName ?? 'none'}`
                + ` height=${blockRect ? Math.round(blockRect.height) : 'n/a'}`
                + ` top=${blockRect ? Math.round(blockRect.top) : 'n/a'}`
                + ` position=${containingBlock ? getComputedStyle(containingBlock).position : 'n/a'}`,
            describeChromeButton('[data-testid="panel-toggle"]', 'panel toggle'),
            describeChromeButton('[data-folia-command-palette-button="true"]', 'command button'),
        ];
    } catch (error) {
        return [`  geometry unavailable: ${error instanceof Error ? error.message : String(error)}`];
    }
};

/**
 * AI 主题生成现场：provider、模型、触发方式、请求状态、原始错误与耗时。
 *
 * 「偶尔报错」最难查的是它不可复现，所以这里把最近几次调用（含成功的）都留一份，
 * 失败时还能看到失败前一次是否成功、耗时是否异常。只导出错误原文，不导出提示词或 Key。
 */
const readAiThemeGenerationLines = (): string[] => {
    const attempts = readAiThemeAttempts();
    const last = readLastAiThemeAttempt();
    // 未走到请求就被跳过的那几条（封面取色源 / 没有歌词 / 正在生成中）单独列，
    // 免得和真正的模型失败混在一起 —— 「按了按钮什么都没发生」以前在报告里是空白。
    const skips = attempts.filter(entry => entry.stage === 'skipped');
    const failed = readFailedAiThemeAttempts().filter(entry => entry.stage !== 'skipped');
    const lines: string[] = [
        `  attempts: total=${attempts.length} failed=${failed.length} skipped=${skips.length}`,
        `  last: ${last ? formatAiThemeAttempt(last) : '(no AI theme generation recorded)'}`,
    ];
    if (skips.length) {
        lines.push('  skipped before the request:');
        skips.slice(-5).forEach((entry, index) => {
            lines.push(`    [${index + 1}] ${formatAiThemeAttempt(entry)}`);
        });
    }
    if (failed.length) {
        lines.push('  failed attempts:');
        failed.slice(-5).forEach((entry, index) => {
            lines.push(`    [${index + 1}] ${formatAiThemeAttempt(entry)}`);
        });
    }
    return lines;
};

const formatAiThemeAttempt = (entry: {
    at: number;
    provider: string;
    model: string;
    trigger: string;
    stage: string;
    ok: boolean;
    status?: number;
    error?: string;
    durationMs: number;
}): string => (
    `at=${new Date(entry.at).toISOString()}`
    + ` provider=${entry.provider}`
    + ` model=${entry.model}`
    + ` trigger=${entry.trigger}`
    + ` ok=${entry.ok ? 'yes' : 'no'}`
    + ` stage=${entry.stage}`
    + (entry.status ? ` status=${entry.status}` : '')
    + ` duration=${entry.durationMs}ms`
    + (entry.error ? ` error=${entry.error}` : '')
);

const formatByteSize = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '0B';
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)}GB`;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${Math.round(value)}B`;
};
/**
 * 等待一项采集，但最多等 ms 毫秒。设备存储或原生桥偶尔很慢（源存储上
 * navigator.storage.persisted() 会阻塞两百多毫秒），诊断导出不该因此把界面卡住或卡死。
 */
const withDeadline = async <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>(resolve => {
                timer = setTimeout(() => resolve(fallback), ms);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
};

/**
 * 视频层的本地视频在安卓上靠 IndexedDB 里的整份 Blob 持久化（桌面端存的是文件句柄）。
 *
 * 用户报「重启后视频没了」时，这几行能直接把范围分开：数据根本没写进去、写进去了但没被读回来、
 * 还是读回来了却没播出来 —— 这三种的修法完全不同，不该靠猜。
 */
const readVideoLayerLines = async (): Promise<string[]> => {
    const state = useVideoLayerSettingsStore.getState();
    const lines: string[] = [
        `  enabled: ${state.videoLayerEnabled} url: ${state.videoLayerUrl ? 'set' : '(none)'}`,
        `  runtime: status=${state.localFileStatus}`
            + ` name=${state.localFileStatus === 'none' ? '(none)' : (state.localFileName ?? '(unnamed)')}`,
        // 存的是句柄还是整份：安卓上曾经误走句柄那条路，报告里一眼能看出用的是哪种。
        `  pick path: ${canPersistVideoLayerFile() ? 'file-handle' : 'indexeddb-blob'}`,
    ];

    try {
        const handle = await withDeadline(loadVideoLayerFileHandle(), 600, null);
        lines.push(`  stored: handle=${handle ? 'yes' : 'no'}`);
    } catch (error) {
        lines.push(`  stored: read-error ${error instanceof Error ? error.message : 'unknown'}`);
    }

    try {
        const storage = (navigator as Navigator & { storage?: StorageManager }).storage;
        const estimate = await withDeadline(Promise.resolve(storage?.estimate?.()), 600, undefined);
        if (estimate) {
            const persisted = typeof storage?.persisted === 'function' ? await withDeadline(storage.persisted(), 400, false) : false;
            lines.push(
                `  origin storage: persisted=${persisted ? 'yes' : 'no'}`
                + ` usage=${formatByteSize(estimate.usage ?? 0)} quota=${formatByteSize(estimate.quota ?? 0)}`,
            );
        } else {
            lines.push('  origin storage: (unavailable)');
        }
    } catch (error) {
        lines.push(`  origin storage: error ${error instanceof Error ? error.message : 'unknown'}`);
    }

    return lines;
};

export const buildDiagnosticReport = async (): Promise<string> => {
    const appVersion = typeof __APP_VERSION__ === 'undefined' ? 'unknown' : __APP_VERSION__;
    const emptyHeartbeat = { last: null, previous: null };
    const heartbeats = await withDeadline(readDiagnosticsHeartbeats(), 800, { playback: emptyHeartbeat, service: emptyHeartbeat });
    const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }).Capacitor;
    const lines: string[] = [
        '### Folia diagnostics',
        '',
        '```text',
        `generated: ${new Date().toISOString()}`,
        `app: ${appVersion}`,
        `platform: ${capacitor?.getPlatform?.() ?? 'web'}${capacitor?.isNativePlatform?.() ? ' (native)' : ''}`,
        `user agent: ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`,
        `viewport: ${typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`}`,
        '',
        // 挖孔/刘海适配的现场：cutout mode、是否有挖孔、安全区矩形。
        'display cutout:',
        ...(await withDeadline(readDisplayCutoutLines(), 800, ['  (timed out)'])),
        '',
        'session storage:',
        `  qq session: ${readLocalStorageFlag('online_provider:qq:cookie')}`,
        `  netease session: ${readLocalStorageFlag('online_provider:netease:cookie')}`,
        `  kugou session: ${readLocalStorageFlag('online_provider:kugou:cookie')}`,
        '',
        // 视频层的本地视频重启后还在不在：写入 / 恢复 / 播放三段分开看。
        'video layer:',
        ...(await readVideoLayerLines()),
        '',
        // 底部控制条被误改到画面中间时，这两个值就是原因，所以一并导出。
        'ui settings:',
        `  bottom bar offset: ${readLocalStorageValue('player_bottom_bar_offset')} (base 32, max scales with viewport height)`,
        `  phone fit: ${readLocalStorageValue('folia_android_phone_fit')}`,
        `  phone fit orientation: ${readLocalStorageValue('folia_android_phone_fit_orientation')}`,
        `  command palette auto hide: ${readLocalStorageValue('auto_hide_command_palette_button')}`,
        `  hide player progress bar: ${readLocalStorageValue('hide_player_progress_bar')}`,
        '',
        'playback continuity:',
        ...readPlaybackContinuityLines(),
        '',
        'playback heartbeat:',
        `  previous: ${formatPlaybackHeartbeat(heartbeats.playback.previous)}`,
        `  last: ${formatPlaybackHeartbeat(heartbeats.playback.last)}`,
        '',
        'service heartbeat:',
        `  previous: ${formatServiceHeartbeat(heartbeats.service.previous)}`,
        `  last: ${formatServiceHeartbeat(heartbeats.service.last)}`,
        '',
        // 漫游背景 / 部分可视化依赖 WebGL2：把真实能力写进报告，避免只能让用户在浏览器另测。
        'graphics capability:',
        formatWebGL2DiagnosticsLine(collectWebGL2Diagnostics()),
        `mod resolution guard: enabled=${getModResolutionGuardStats().enabled} level=${getModResolutionGuardStats().level} scale=${getModResolutionGuardStats().scale} canvases=${getModResolutionGuardStats().canvases}`,
        `native stage: enabled=${getNativeStageStatsSnapshot().enabled} active=${getNativeStageStatsSnapshot().active} renderer=${getNativeStageStatsSnapshot().renderer} vulkan=${getNativeStageStatsSnapshot().vulkan} pipeline=${getNativeStageStatsSnapshot().pipeline} vulkanError=${getNativeStageStatsSnapshot().vulkanError || '(none)'} canvasMs=${getNativeStageStatsSnapshot().canvasMs} surface=${getNativeStageStatsSnapshot().surface} playing=${getNativeStageStatsSnapshot().playing} frames=${getNativeStageStatsSnapshot().frames}`,
        '',
        'visualizer backgrounds:',
        ...readVisualizerBackgroundLines(),
        '',
        // 智能动感模式：模型在不在、能不能跑、最近一次取拍点用了模型还是回退。
        'smart beat:',
        ...(await readSmartBeatLines()),
        '',
        // 应用内更新：地址有没有进包、桥在不在、检查停在哪一步。
        'app update:',
        ...readAppUpdateLines(),
        '',
        // 刷新率现场：设置档位、系统当前值、屏幕档位、申请值与两秒采样，先分清是谁把帧降下来的。
        'display frame rate:',
        ...(await readDisplayFrameRateLines()),
        '',
        // 卡顿分流：帧耗时 + 长任务 + 处理器探针，用来区分我们的渲染开销和设备性能。
        'frame timing:',
        ...readFrameTimingLines(),
        '',
        'bottom bar geometry:',
        ...readBottomBarGeometry(),
        '',
        'ai theme generation:',
        ...readAiThemeGenerationLines(),
        '',
        'library request trace:',
    ];

    const libraryLines = getLibraryTraceLines();
    lines.push(...(libraryLines.length ? libraryLines.map(line => `  ${line}`) : ['  (none)']));

    const localLibraryLines = getLocalLibraryDiagnosticLines();
    lines.push('', 'local library trace:');
    lines.push(...(localLibraryLines.length ? localLibraryLines : ['  (none)']));

    const collectionOrderLines = getCollectionOrderDiagnosticLines();
    lines.push('', 'collection order trace:');
    lines.push(...(collectionOrderLines.length ? collectionOrderLines : ['  (none)']));

    // 在线写入失败的留痕：这些失败在请求轨迹里可能一条都没有（provider 提前拒绝），
    // 所以必须单独报，否则「收藏失败」在诊断里无迹可寻。
    const mutationLines = getOnlineMutationDiagnosticLines();
    lines.push('', 'online mutation trace:');
    lines.push(...(mutationLines.length ? mutationLines : ['  (none)']));

    // 在线取流 / 媒体播放失败的留痕：用户只会看到「暂时无法播放这首歌」，
    // 而这条路径以前在报告里一条记录都没有（分不清是哪家 provider、什么原因）。
    const playbackLines = getOnlinePlaybackDiagnosticLines();
    lines.push('', 'online playback trace:');
    lines.push(...(playbackLines.length ? playbackLines : ['  (none)']));

    // Apple Music 在 Android 只在隐藏 WebView 里出声：起播没声音时，这一节是唯一的现场。
    lines.push('', 'apple music (android webview):');
    // 第一次要等页面把 Widevine 探完，比其它只读快照慢。
    lines.push(...(await withDeadline(readAppleMusicDiagnosticLines(), 8000, ['  (timed out)'])));

    const lyricsLines = getLyricsDiagnosticLines();
    lines.push('', 'lyrics pipeline trace:');
    lines.push(...(lyricsLines.length ? lyricsLines : ['  (none)']));

    const qrLines = getQrLoginTraceLines('qq');
    if (qrLines.length) {
        lines.push('', 'last qq login trace:');
        lines.push(...qrLines.map(line => `  ${line}`));
    }

    const crashEntries = await withDeadline(readCrashDiagnostics().catch(() => []), 800, []);
    // 本地音频代理在播放器断开（切歌、拖动进度、Activity 销毁）时抛的 SocketException /
    // Connection reset 是预期的收尾，不是崩溃。以前它们会占满崩溃列表的 20 条、把真正的
    // 退出原因挤掉，所以单独归一行摘要，不进崩溃列表。
    const isAudioServerTeardown = (entry: { source?: string }) => entry.source === 'local-audio-server';
    const teardownEntries = crashEntries.filter(isAudioServerTeardown);
    const crashOnlyEntries = crashEntries.filter(entry => !isAudioServerTeardown(entry));
    lines.push('', 'crash diagnostics:');
    if (crashOnlyEntries.length === 0) {
        lines.push('  (none)');
    } else {
        crashOnlyEntries.slice(-20).forEach((entry, index) => {
            lines.push(
                `  [${index + 1}] at=${new Date(entry.at).toISOString()}`
                + ` source=${entry.source}`
                + ` thread=${entry.thread || 'unknown'}`
                + ` type=${entry.type}`,
                `      message=${entry.message || '(empty)'}`,
            );
            if (entry.stack) {
                const stackLines = entry.stack.split(/\r?\n/).slice(0, 8);
                lines.push(...stackLines.map(line => `      ${line}`));
            }
        });
    }
    if (teardownEntries.length > 0) {
        const lastTeardown = teardownEntries[teardownEntries.length - 1];
        lines.push(
            `  local audio server teardown: ${teardownEntries.length}`
            + ` (expected when the player disconnects; last at=${new Date(lastTeardown.at).toISOString()} type=${lastTeardown.type})`,
        );
    }

    const playbackDiagnostics = await withDeadline(readNativePlaybackDiagnostics(), 1200, null);
    lines.push('', 'lock screen artwork:');
    if (!playbackDiagnostics) {
        lines.push('  (native diagnostics unavailable)');
    } else {
        lines.push(`  cover: ${playbackDiagnostics.cover || '(none)'}`);
        lines.push(`  status: ${playbackDiagnostics.status || 'unknown'}`);
        lines.push(`  detail: ${playbackDiagnostics.detail || '(empty)'}`);
        lines.push(`  applied: ${playbackDiagnostics.applied ? 'yes' : 'no'}`);
        lines.push(`  at: ${playbackDiagnostics.at ? new Date(playbackDiagnostics.at).toISOString() : '(not recorded)'}`);
        lines.push(`  power: ${playbackDiagnostics.power || '(not recorded)'}`);
    }

    lines.push('```');
    return lines.join('\n');
};
