import { LyricData, OnlineLyricsState, ReplayGainInfo, SongResult } from '../types';
import { saveToCache } from './db';
import { PrefetchedSongData, isUrlValid, updatePrefetchedAudioUrl } from './prefetchService';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { loadOnlineLyricsState, markOnlineLyricsPureMusic, resolveOnlineLyrics, resolveOnlineLyricsPureMusic, saveOnlineLyricsState } from '../utils/onlineLyricsState';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { getPlatformLyricSource } from '../utils/lyrics/lyricSources';
import { settlesOnOwnWordTiming } from '../utils/lyrics/ownWordTiming';
import { createSafeObjectUrl } from '../utils/blobGuards';
import type { AudioQualityPreference, MediaId, ProviderAudioSource } from '../types/onlineMusic';
import { omni } from './onlineMusic/omni';
import { autoRetryDelaysMs, logOnlineFailure, onlineFailureOf, type OnlineFailure } from './onlineMusic/failure/onlineFailureCase';
import { noteOnlineRequestCooldown, onlineRequestCooldown } from './onlineMusic/failure/onlineRequestCooldown';
import { getSongResourceCacheKey } from './onlineMusic/resourceKeys';
import { deleteCachedSongAudio, getCachedSongAudioBlob, getCachedSongReplayGain, getSongCacheWithLegacyMigration } from './onlineMusic/resourceCache';
import { measureSongAudio, notTheSongWhy } from './wholeSongCheck';
import { isCachedSongAudioDistrusted } from './playbackRecovery/mediaCacheGuard';
import { audioMimeTypeFor, toPlayableAudioUrl } from '../utils/appPlaybackHelpers';
import { IS_ANDROID_WEBVIEW } from '../utils/platform';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { noteOnlinePlaybackOutcome } from '../utils/onlinePlaybackDiagnostics';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { saveLyricCacheSongMetadata } from './lyricExport/lyricCacheMetadata';
import { errorFields } from '../utils/errorText';

// How long playback waits for a stored copy's header to give its play length (`wholeCopy`). Past
// it the copy plays untested: the check must not hold up a song that starts from the cache.
const COPY_CHECK_CEILING_MS = 300;
// ── 安卓：跨源媒体的 CORS 缺口 ────────────────────────────────────────────
// 播放器的 <audio> 带 crossOrigin="anonymous"，又接 WebAudio 分析：CDN 不回 CORS 头时，
// 地址拿到了却一个音频事件都没有（表现为「取链成功但无声」）。
// 这里经原生 HTTP 桥（nativeAndroidBridge 的 fetch 代理，已白名单各平台 CDN 域名）把文件
// 拉成同源 blob 再交给音频元素：blob 同源，crossOrigin 与 WebAudio 分析都不再受 CDN 限制。
// 哪些平台需要这样做由平台自己声明（OnlineMusicProvider.requiresSameOriginAudio）。
const proxiedAudioObjectUrls = new Map<string, string>();
// 拉整首音频比普通 API 慢：给原生桥 30 秒，前端最多等 25 秒；等太久就退回平台地址，
// 不让「一直在拉流」把播放卡成永远不开始。
const PROXIED_AUDIO_TIMEOUT_MS = 25_000;

const describeAudioHost = (url: string): string => {
    try { return new URL(url).hostname.slice(0, 60); } catch { return 'invalid-url'; }
};

const readProxiedAudioBlob = async (url: string): Promise<Blob> => {
    const attempt = async () => {
        const response = await fetch(url, { foliaTimeoutMs: PROXIED_AUDIO_TIMEOUT_MS + 5_000 } as RequestInit);
        if (!response.ok) throw new Error(`upstream answered ${response.status}`);
        const blob = await response.blob();
        // 几百字节的「音频」一定是错误页/占位符，不是能放的文件。
        if (blob.size < 4096) throw new Error('upstream answered a stub (' + blob.size + ' bytes)');
        return blob;
    };
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            attempt(),
            new Promise<Blob>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(`timed out after ${PROXIED_AUDIO_TIMEOUT_MS}ms`)), PROXIED_AUDIO_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const isLocalStreamUrl = (url: string): boolean => {
    try {
        const host = new URL(url).hostname;
        return host === '127.0.0.1' || host === 'localhost';
    } catch {
        return false;
    }
};

const androidProxiedAudioUrl = async (url: string, provider: string | undefined): Promise<string> => {
    if (!IS_ANDROID_WEBVIEW || !provider || !omni.requiresSameOriginAudio(provider)) return url;
    // omni 已把它挂到原生本地流服务（Range + ACAO:*）上时，不要再整文件拉一遍 blob。
    if (isLocalStreamUrl(url)) return url;
    const cached = proxiedAudioObjectUrls.get(url);
    if (cached) return cached;
    const startedAt = Date.now();
    let blob: Blob | null = null;
    try {
        blob = await readProxiedAudioBlob(url);
    } catch (firstError) {
        // 一次重试：CDN 偶尔对首个请求回 5xx / 空响应，重试后通常就好。
        console.warn('[Playback] proxying the audio file failed once; retrying', errorFields(firstError));
        try {
            blob = await readProxiedAudioBlob(url);
        } catch (retryError) {
            console.warn('[Playback] proxying the audio file failed; playing the platform address directly', errorFields(retryError));
            noteOnlinePlaybackOutcome({
                stage: 'media', outcome: 'error', providerId: provider ?? 'unknown', kind: 'proxy-source',
                detail: `${describeAudioHost(url)} failed: ${String(errorFields(retryError).message ?? 'unknown')}`.slice(0, 160),
            });
            return url;
        }
    }
    try {
        // CDN 常把音频标成 application/octet-stream 或不给类型；按文件头补一个正确 MIME，
        // 否则播放器可能判成不支持的源（报告里是 media-error-4 / no supported sources）。
        const headBytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        const mime = audioMimeTypeFor(url, blob.type, headBytes);
        const playableBlob = mime && mime !== blob.type ? blob.slice(0, blob.size, mime) : blob;
        const objectUrl = URL.createObjectURL(playableBlob);
        console.info('[Playback] proxied audio for same-origin playback', {
            host: new URL(url).hostname, bytes: playableBlob.size, mime: playableBlob.type || '(none)', ms: Date.now() - startedAt,
        });
        noteOnlinePlaybackOutcome({
            stage: 'media', outcome: 'ok', providerId: provider ?? 'unknown', kind: 'proxy-source',
            detail: `${describeAudioHost(url)} ${playableBlob.size}B ${playableBlob.type || 'no-mime'} ${Date.now() - startedAt}ms`.slice(0, 160),
        });
        proxiedAudioObjectUrls.set(url, objectUrl);
        while (proxiedAudioObjectUrls.size > 24) {
            const oldest = proxiedAudioObjectUrls.keys().next().value;
            if (!oldest) break;
            const old = proxiedAudioObjectUrls.get(oldest);
            proxiedAudioObjectUrls.delete(oldest);
            if (old) URL.revokeObjectURL(old);
        }
        return objectUrl;
    } catch (error) {
        console.warn('[Playback] could not hand the proxied audio to the player', errorFields(error));
        return url;
    }
};

export type OnlineAudioSourceResult =
    // `preview`: the URL plays a preview clip of the song, as its provider said (omni notes it).
    | { kind: 'ok'; audioSrc: string; blobUrl?: string; replayGain?: ReplayGainInfo; preview?: boolean }
    | { kind: 'unavailable'; failure: OnlineFailure };

export interface LoadOnlineAudioSourceOptions {
    // The media cache's copy is passed over: it is the copy that just failed to play.
    bypassMediaCache?: boolean;
    // Where the platform could not be reached, asks again by itself (`autoRetryDelaysMs`) as long as
    // the play that asks is still the one wanted, and says so before each wait.
    retry?: {
        isCurrent: () => boolean;
        onRetrying?: (shown: OnlineFailure, attempt: number) => void;
        sleep?: (ms: number) => Promise<void>;
    };
}

const sleepBeforeRetry = (ms: number): Promise<void> => new Promise(resolve => {
    globalThis.setTimeout(resolve, ms);
});

/** 诊断用的一行歌曲身份：标题 + 歌手，不含账号信息。 */
const songDiagnosticIdentity = (song: SongResult): { songTitle: string; songArtist: string } => ({
    songTitle: String(song.name || '').slice(0, 80),
    songArtist: (song.artists || []).map(artist => artist?.name).filter(Boolean).join(' / ').slice(0, 80),
});

export async function loadOnlineSongAudioSource(
    song: SongResult,
    audioQuality: AudioQualityPreference,
    prefetched: PrefetchedSongData | null,
    options: LoadOnlineAudioSourceOptions = {},
): Promise<OnlineAudioSourceResult> {
    // The copy in the media cache is taken only where it was fetched at the level the option now
    // means for this song's provider, or at an unknown one. A copy of another level is passed
    // over for a URL of the level asked for: the option decides what plays, cached or not.
    const providerId = getOnlineProviderIdForSong(song) ?? undefined;
    const level = providerId ? omni.resolveAudioQuality(providerId, audioQuality) : undefined;
    // A copy that failed to decode earlier in this session, or that the caller passes over, is not
    // read; a copy that cannot be read is logged and passed over: the platform is asked instead.
    const readCopy = async (atLevel?: AudioQualityPreference): Promise<Blob | null> => {
        if (options.bypassMediaCache || isCachedSongAudioDistrusted(song)) return null;
        try {
            return await getCachedSongAudioBlob(song, atLevel);
        } catch (error) {
            console.warn('[OnlinePlayback] Failed to read the cached audio; asking the provider instead', error);
            return null;
        }
    };
    // A copy proven not to be the song (under half its length) is a clip stored as the song, most
    // likely a preview kept before the writers checked what they store (wholeSongCheck.ts). It is
    // deleted with its level, and the song is asked of its platform as if there were no copy. Only
    // the file measured is deleted: one written since (the end of a play of this song) stays. Any
    // other copy plays, also one whose length cannot be told within the ceiling.
    const wholeCopy = async (blob: Blob | null): Promise<Blob | null> => {
        if (!blob) return null;
        const length = await measureSongAudio(song, blob, COPY_CHECK_CEILING_MS);
        if (length.verdict !== 'clip') return blob;
        let outcome: string;
        try {
            outcome = await deleteCachedSongAudio(song, blob.size) ? 'deleted' : 'left, a newer file is there';
        } catch (error) {
            outcome = `not deleted (${errorFields(error).name})`;
        }
        console.log(`[Cache] Copy of "${song.name}" ${outcome}: it is ${notTheSongWhy(length)}`);
        return null;
    };
    const playCopy = async (copy: Blob | null) => {
        const blob = await wholeCopy(copy);
        const blobUrl = blob && createSafeObjectUrl(blob);
        if (!blobUrl) return null;
        // Nothing on this path ever asks the provider again, so the stored gain is the only
        // one a cached track can have. Without it every cached track reaches the fader at 0dB.
        let replayGain = song.replayGain ?? prefetched?.replayGain;
        if (!replayGain) {
            replayGain = await getCachedSongReplayGain(song);
            if (replayGain) console.log(`[Cache] ReplayGain recovered for "${song.name}" from the store, not the provider`);
        }
        return { kind: 'ok' as const, audioSrc: blobUrl, blobUrl, replayGain };
    };
    // Where no URL can be had (offline, a sign-in that has ended, a song taken down), the copy that
    // was passed over for its level is what plays: another level is better than no song.
    const playCopyOfAnyLevel = async () => {
        const played = level ? await playCopy(await readCopy()) : null;
        if (played) console.log(`[Cache] No URL for "${song.name}": its copy of another level plays`);
        return played;
    };

    const fromCopy = await playCopy(await readCopy(level));
    if (fromCopy) return fromCopy;

    if (prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB' && isUrlValid(prefetched.audioUrlFetchedAt)) {
        return {
            kind: 'ok',
            audioSrc: prefetched.audioUrl,
            replayGain: song.replayGain ?? prefetched.replayGain,
            preview: omni.isPreviewAudioSource(prefetched.audioUrl),
        };
    }

    // No address: what went wrong is logged, also where a copy of another level then plays.
    const unavailable = async (failure: OnlineFailure, error?: unknown) => {
        logOnlineFailure(failure, error);
        return await playCopyOfAnyLevel() ?? { kind: 'unavailable' as const, failure };
    };
    const sleep = options.retry?.sleep ?? sleepBeforeRetry;
    for (let attempt = 0; ; attempt += 1) {
        // The platform asked to wait and the wait is not over: it is not asked again before then.
        const cooldown = providerId ? onlineRequestCooldown(providerId, 'play') : null;
        if (cooldown) {
            // 冷却期内不会发起取流：单独留痕，否则报告里既没有请求也没有失败。
            noteOnlinePlaybackOutcome({
                stage: 'resolve', outcome: 'error', providerId: providerId ?? 'unknown',
                ...songDiagnosticIdentity(song),
                mediaId: getPlaybackSongKey(song), quality: audioQuality,
                kind: 'rate-limited(cooldown)', code: cooldown.remainingMs,
                detail: 'provider cooldown: request skipped', elapsedMs: 0,
            });
            return await unavailable(onlineFailureOf(
                { operation: 'audio', providerId },
                { detail: { case: 'retry-later', retryAfterMs: cooldown.remainingMs } },
            ));
        }
        // Read before the request: a transport that is refused may drop the session it had, and
        // read after it, a sign-in that ran out would look like one there never was.
        const signedOut = providerId ? useOnlineProviderAccountStore.getState().accounts[providerId]?.status === 'anonymous' : false;
        let source: ProviderAudioSource | null = null;
        let thrown: unknown;
        try {
            source = await omni.getAudioSource(song, audioQuality);
        } catch (error) {
            thrown = error ?? new Error('The audio source request failed');
        }
        // 安卓上声明了 requiresSameOriginAudio 的平台：先经原生桥拉成同源 blob（失败就照用平台地址）。
        // 预取/记录用平台给的原始地址（blob 只活在这一个会话），播放才用 blob。
        const playableUrl = thrown === undefined ? toPlayableAudioUrl(source?.url) : null;
        const playUrl = playableUrl ? await androidProxiedAudioUrl(playableUrl, providerId) : null;
        if (playUrl && playableUrl) {
            const replayGain = applyOnlineAudioSourceMetadata(song, source?.replayGain).replayGain;
            updatePrefetchedAudioUrl(song, playableUrl, audioQuality, replayGain);
            return { kind: 'ok', audioSrc: playUrl, replayGain, preview: omni.isPreviewAudioSource(playableUrl) };
        }
        const failure = thrown === undefined
            // A provider (a mod's) that answers null, or an address that may not be played.
            ? onlineFailureOf({ operation: 'audio', providerId, signedOut }, { detail: { case: 'no-audio' } })
            : onlineFailureOf({ operation: 'audio', providerId, signedOut }, { error: thrown });
        noteOnlineRequestCooldown(failure);
        // 「暂时无法播放这首歌」来自 invalid-response / unknown 两档：把 stage、reason、上游码、是否拿到地址
        // 记下来，否则报告里只有一条 ok 记录、对不上。
        noteOnlinePlaybackOutcome({
            stage: 'resolve', outcome: 'error', providerId: providerId ?? 'unknown',
            ...songDiagnosticIdentity(song),
            mediaId: getPlaybackSongKey(song), quality: audioQuality,
            kind: failure.case,
            code: failure.facts?.upstreamCode ?? failure.facts?.httpStatus,
            detail: [failure.operation ? 'op=' + failure.operation : '', failure.facts?.message ?? '']
                .filter(Boolean).join(' ').slice(0, 140),
            elapsedMs: 0,
        });

        const delays = autoRetryDelaysMs(failure);
        const retry = options.retry;
        if (retry && attempt < delays.length && retry.isCurrent()) {
            logOnlineFailure(failure, thrown);
            retry.onRetrying?.(failure, attempt + 1);
            await sleep(delays[attempt]);
            if (!retry.isCurrent()) return { kind: 'unavailable', failure };
            continue;
        }
        return await unavailable(failure, thrown);
    }
}

export const applyOnlineAudioSourceMetadata = (
    song: SongResult,
    replayGain?: ReplayGainInfo,
): SongResult => replayGain
    ? { ...song, replayGain: { ...song.replayGain, ...replayGain } }
    : song;

export async function loadOnlineSongLyrics(
    song: SongResult,
    prefetched: PrefetchedSongData | null,
    userId: MediaId | null | undefined,
    callbacks: {
        isCurrent: () => boolean;
        onLyrics: (lyrics: LyricData | null) => void;
        onPureMusicChange?: (isPureMusic: boolean) => void;
        onStateChange?: (state: OnlineLyricsState | null) => void;
        onAutoMatchStart?: () => void;
        onDone: () => void;
    }
): Promise<void> {
    const { isCurrent, onLyrics, onPureMusicChange, onStateChange, onAutoMatchStart, onDone } = callbacks;
    const lyricCacheKey = getSongResourceCacheKey('lyric', song);
    const onlineLyricsState = await loadOnlineLyricsState(song);
  const initialSettingsLyricSettings = useLyricSettingsStore.getState();

    if (!isCurrent()) return;
    onStateChange?.(onlineLyricsState);

    const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
    if (!isCurrent()) return;
    const preferredCachedLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    const hasAuthoritativeLyricsSelection = onlineLyricsState?.lyricsSource === 'imported'
        || Boolean(onlineLyricsState?.hasOnlineOverride);
    // A platform whose own word timing is kept as it is (`prefersOwnWordByWord`) is not searched
    // for another source when it is also the preferred one: the automatic pick would replace the
    // timing the song actually has. Any other preferred source is still asked (issue #1127).
    const keepsOwnWordByWord = (candidate: LyricData | null | undefined) => {
        const lyricSettings = useLyricSettingsStore.getState();
        return settlesOnOwnWordTiming({
            ownSource: getPlatformLyricSource(song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null)?.id,
            prefersOwn: omni.prefersOwnWordByWordLyrics(song),
            lyrics: candidate,
            keepOwn: lyricSettings.keepProviderWordTiming,
        }, lyricSettings.preferredAlternativeLyricSource);
    };
    if (preferredCachedLyrics && (hasAuthoritativeLyricsSelection || !initialSettingsLyricSettings.autoUseBestLyric)) {
        const cachedText = preferredCachedLyrics.lines.map(line => line.fullText).join('\n');
        onPureMusicChange?.(resolveOnlineLyricsPureMusic(onlineLyricsState, cachedText));
        onLyrics(preferredCachedLyrics);
        onDone();
        return;
    }

    if (prefetched?.lyricRaw?.isPureMusic && !prefetched.lyrics
        && (hasAuthoritativeLyricsSelection || !initialSettingsLyricSettings.autoUseBestLyric)) {
        onPureMusicChange?.(true);
        onLyrics(null);
        onDone();
        return;
    }

    if (prefetched?.lyrics) {
        const preferredPrefetchedLyrics = resolveOnlineLyrics(onlineLyricsState, prefetched.lyrics);
        const effectiveLyrics = preferredPrefetchedLyrics ?? prefetched.lyrics;

  const settingsLyricSettings = useLyricSettingsStore.getState();
        const shouldAutoMatch = settingsLyricSettings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride
            && !keepsOwnWordByWord(effectiveLyrics);

        if (!shouldAutoMatch) {
            const effectiveText = effectiveLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
            onPureMusicChange?.(
                onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : (prefetched.lyricRaw?.isPureMusic || isPureMusicLyricText(effectiveText) || isPureMusicLyricText(prefetched.lyricRaw?.mainLrc))
            );
            onLyrics(effectiveLyrics);
            saveToCache(lyricCacheKey, prefetched.lyrics);
            saveLyricCacheSongMetadata(song);
            onDone();
            return;
        }
    }

    const processed = prefetched?.lyrics
        ? {
            mainLrc: prefetched.lyricRaw?.mainLrc ?? null,
            yrcLrc: prefetched.lyricRaw?.yrcLrc ?? null,
            transLrc: prefetched.lyricRaw?.transLrc ?? null,
            isPureMusic: prefetched.lyricRaw?.isPureMusic ?? false,
            lyrics: prefetched.lyrics,
            chorusRanges: [],
          }
        : await (async () => {
            const result = await omni.getLyrics(song, { userId });
            return {
                mainLrc: result.mainText ?? null,
                yrcLrc: result.wordByWordText ?? null,
                transLrc: result.translationText ?? null,
                isPureMusic: result.isPureMusic,
                lyrics: result.lyrics,
                chorusRanges: result.chorusRanges || [],
            };
        })();
    const parsedLyrics = processed.lyrics;

    if (!isCurrent()) return;

    let resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, parsedLyrics);
    let finalState = onlineLyricsState;

  const settingsLyricSettings = useLyricSettingsStore.getState();
    const shouldAutoMatch = settingsLyricSettings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride
        && !keepsOwnWordByWord(parsedLyrics);

    if (shouldAutoMatch) {
        // The lyrics in hand are already displayable, so hand them over and report done BEFORE the
        // search below. `onDone` is what releases the audio: playback waits on it, and this search
        // asks every provider for a better lyric file - seconds when it finds none, which is
        // exactly what an instrumental interlude does. Holding the audio for an OPTIONAL upgrade
        // is what turned a song change into several seconds of silence, and with blended changes
        // the outgoing track has already ended by then, so the silence is all the listener gets.
        // A better match, if one turns up, replaces these below.
        if (resolvedLyrics) onLyrics(resolvedLyrics);
        onDone();

        try {
            onAutoMatchStart?.();
            const metadata = getProviderSongMetadata(song);
            const artistName = metadata.artists.map(a => a.name).join(', ');
            const ownProviderId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null;
            const ownLyricSource = getPlatformLyricSource(ownProviderId);
            const bestMatch = await autoMatchBestLyric(song.name, artistName, metadata.durationMs, {
                album: metadata.album?.name,
                preferredSource: settingsLyricSettings.preferredAlternativeLyricSource,
                keepOwnWordTiming: settingsLyricSettings.keepProviderWordTiming,
                alternateArtist: () => omni.getAlternateArtistName(song),
                searchAlias: () => omni.getLyricSearchAlias(song),
                providerCandidate: ownLyricSource
                    ? {
                        providerId: ownLyricSource.id,
                        song,
                        lyricsResult: {
                            lyrics: parsedLyrics,
                            mainText: processed.mainLrc,
                            wordByWordText: processed.yrcLrc,
                            translationText: processed.transLrc,
                            isPureMusic: processed.isPureMusic,
                            chorusRanges: processed.chorusRanges,
                        },
                    }
                    : undefined
            });
            if (bestMatch && 'lyrics' in bestMatch && bestMatch.source !== ownProviderId) {
                const overrideState: OnlineLyricsState = {
                    lyricsSource: 'online',
                    matchedSongId: bestMatch.id,
                    hasOnlineOverride: true,
                    onlineOverrideLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                };
                await saveOnlineLyricsState(song, overrideState);
                resolvedLyrics = bestMatch.lyrics;
                finalState = overrideState;
                onStateChange?.(overrideState);
            } else if (bestMatch?.isPureMusic) {
                // Checked against `true`, not with `in`: a MATCH object also carries
                // `isPureMusic: false`, so `'isPureMusic' in bestMatch` was true for it too - and
                // a best match from the track's own provider (which fails the branch above) then
                // landed here and had its perfectly good lyrics thrown away as instrumental.
                const pureMusic = markOnlineLyricsPureMusic(onlineLyricsState);
                await saveOnlineLyricsState(song, pureMusic);
                resolvedLyrics = null;
                finalState = pureMusic;
                onStateChange?.(pureMusic);
            }
        } catch (error) {
            console.warn('[OnlinePlayback] Failed to auto-match best lyric:', error);
        }
    }

    if (!isCurrent()) return;

    const resolvedText = resolvedLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
    onPureMusicChange?.(
        finalState?.lyricsSource === 'online' && typeof finalState.matchedIsPureMusic === 'boolean'
            ? finalState.matchedIsPureMusic
            : (resolvedLyrics ? isPureMusicLyricText(resolvedText) : processed.isPureMusic)
    );

    if (!resolvedLyrics) {
        onLyrics(null);
        onDone();
        return;
    }

    onLyrics(resolvedLyrics);
    saveToCache(lyricCacheKey, resolvedLyrics);
    saveLyricCacheSongMetadata(song);
    onDone();
}
