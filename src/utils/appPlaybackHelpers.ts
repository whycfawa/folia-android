import i18n from '../i18n/config';
import type { LyricData, ReplayGainMode, SongResult } from '../types';
import type { StructuredLyric } from '../types/navidrome';
import { detectTimedLyricFormat } from './lyrics/formatDetection';
import { getLineRenderHints } from './lyrics/renderHints';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from './appPlaybackGuards';

export { hasRenderableLyrics } from './lyrics/validity';

// Pure helpers for playback state, debug snapshots, and lyric timing.
export const clampMediaVolume = (value: number) => Math.min(1, Math.max(0, value));

export const extractCloudLyricText = (response: any): string => {
    if (typeof response?.lrc === 'string') return response.lrc;
    if (typeof response?.data?.lrc === 'string') return response.data.lrc;
    if (typeof response?.lyric === 'string') return response.lyric;
    if (typeof response?.data?.lyric === 'string') return response.data.lyric;
    return '';
};

export const findLatestActiveLineIndex = (lines: LyricData['lines'], time: number) => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || time < line.startTime) {
            continue;
        }
        if (time <= (line.renderHints?.renderEndTime ?? line.endTime)) {
            return index;
        }
    }
    return -1;
};

export const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const getReplayGainModeLabel = (mode: ReplayGainMode): string => i18n.t(`replayGain.${mode}`);

export const getAudioSrcKind = (audioSrc: string | null): 'empty' | 'blob' | 'http' | 'other' => {
    if (!audioSrc) {
        return 'empty';
    }

    if (audioSrc.startsWith('blob:')) {
        return 'blob';
    }

    if (audioSrc.startsWith('http://') || audioSrc.startsWith('https://')) {
        return 'http';
    }

    return 'other';
};

export const toSafeRemoteUrl = (url: string | null | undefined): string | null | undefined => {
    if (!url) {
        return url;
    }

    const normalizedUrl = url.split(/,\s*(?=https?:\/\/)/i)[0]?.trim() || url;

    if (normalizedUrl.startsWith('http:') && normalizedUrl.includes('music.126.net')) {
        return normalizedUrl.replace('http:', 'https:');
    }

    return normalizedUrl;
};

// The form playback holds a source's audio URL in. The same as toSafeRemoteUrl since the last platform rule that
// differed between the desktop and the web moved into its source (a source hands the URL its runtime can play).
export const toSafePlaybackUrl = (url: string | null | undefined): string | null | undefined => toSafeRemoteUrl(url);

// toSafePlaybackUrl only normalizes (http→https, drops trailing fallback URLs) and never filters the scheme;
// script schemes and blank strings are not audio sources. Shared by the loader and the prefetch resolver.
const NON_MEDIA_URL_SCHEME = /^\s*(javascript|vbscript):/i;

export const toPlayableAudioUrl = (rawUrl: string | null | undefined): string | null => {
    const url = toSafePlaybackUrl(rawUrl);
    if (!url || !url.trim() || NON_MEDIA_URL_SCHEME.test(url)) return null;
    return url;
};

export const resolveDebugSongSource = (song: SongResult | null): 'none' | 'local' | 'navidrome' | 'online' => {
    if (isStagePlaybackSong(song)) {
        return 'online';
    }

    if (isLocalPlaybackSong(song)) {
        return 'local';
    }

    if (isNavidromePlaybackSong(song)) {
        return 'navidrome';
    }

    return song ? 'online' : 'none';
};

export const resolveDebugLyricsSource = (
    song: SongResult | null,
    lyrics: LyricData | null
): 'none' | 'local' | 'embedded' | 'online' | 'navi' => {
    if (isStagePlaybackSong(song)) {
        return lyrics ? 'local' : 'none';
    }

    if (isLocalPlaybackSong(song)) {
        return lyrics ? 'online' : 'none';
    }

    if (isNavidromePlaybackSong(song)) {
        const navidromeSong = song as NavidromeSongLike;
        if (navidromeSong.lyricsSource) {
            return navidromeSong.lyricsSource;
        }
        if (navidromeSong.matchedLyrics) {
            return 'online';
        }
        const hasStructuredLyrics = Array.isArray(navidromeSong.cachedStructuredLyrics)
            ? navidromeSong.cachedStructuredLyrics.length > 0
            : Boolean(navidromeSong.cachedStructuredLyrics?.line.length || navidromeSong.cachedStructuredLyrics?.cueLine?.length);
        if (lyrics || hasStructuredLyrics || navidromeSong.cachedPlainLyrics?.trim()) {
            return 'navi';
        }
        return 'none';
    }

    if (song && lyrics) {
        return 'online';
    }

    return 'none';
};

type NavidromeSongLike = SongResult & {
    lyricsSource?: 'navi' | 'online';
    matchedLyrics?: LyricData;
    cachedStructuredLyrics?: StructuredLyric | StructuredLyric[] | StructuredLyric['line'];
    cachedPlainLyrics?: string;
};

export const hasEnhancedStructuredLines = (item: StructuredLyric): boolean => {
    return item.cueLine?.some(cueLine => cueLine.cue?.some(cue => typeof cue.start === 'number'))
        || item.line?.some(line => detectTimedLyricFormat(line.value) === 'enhanced-lrc')
        || false;
};

export const toDebugLineSnapshot = (line: LyricData['lines'][number] | null) => {
    if (!line) {
        return null;
    }

    const renderHints = getLineRenderHints(line);
    return {
        text: line.fullText || null,
        translation: line.translation ?? null,
        wordCount: line.words.length,
        startTime: line.startTime,
        endTime: line.endTime,
        renderEndTime: renderHints?.renderEndTime ?? null,
        rawDuration: renderHints?.rawDuration ?? Math.max(line.endTime - line.startTime, 0),
        timingClass: renderHints?.timingClass ?? null,
        lineTransitionMode: renderHints?.lineTransitionMode ?? null,
        wordRevealMode: renderHints?.wordRevealMode ?? null,
    };
};

/**
 * 播放器拿到的地址是什么：`blob`（经原生桥拉成同源 blob）还是远端，远端带上主机名。
 * 播放失败时写进诊断，区分「地址本身失效」与「跨源/代理拉流失败」。
 */
export const describePlaybackSource = (src: string | null | undefined): { kind: 'none' | 'blob' | 'local' | 'remote' | 'other'; host: string } => {
    const value = String(src || '');
    if (!value) return { kind: 'none', host: '' };
    if (value.startsWith('blob:')) return { kind: 'blob', host: '' };
    if (value.startsWith('file:') || value.startsWith('data:')) return { kind: 'local', host: '' };
    try {
        const parsed = new URL(value);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return { kind: 'remote', host: parsed.hostname };
    } catch {
        return { kind: 'other', host: '' };
    }
    return { kind: 'other', host: '' };
};

/**
 * 经原生桥拉下来的音频 blob 该用什么 MIME：CDN 经常回 application/octet-stream 或不给类型，
 * 只靠 URL 后缀又可能没有后缀。先按文件头认（ID3/帧同步/fLaC/OggS/RIFF/fTyp），
 * 再退声明值、URL 后缀；都认不出回 null（交给播放器自己嗅探）。
 */
export const audioMimeTypeFor = (
    url: string,
    declared?: string | null,
    head?: Uint8Array | null,
): string | null => {
    if (head && head.length >= 4) {
        const [b0, b1, b2, b3] = head;
        if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return 'audio/mpeg';
        if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return 'audio/mpeg';
        if (b0 === 0x66 && b1 === 0x4c && b2 === 0x61 && b3 === 0x43) return 'audio/flac';
        if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return 'audio/ogg';
        if (head.length >= 12 && b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
            && head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45) return 'audio/wav';
        if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'audio/mp4';
    }
    const mime = String(declared || '').split(';')[0].trim().toLowerCase();
    if (mime.startsWith('audio/') && mime !== 'audio/*') return mime;
    const path = String(url || '').split('?')[0].toLowerCase();
    if (path.endsWith('.flac')) return 'audio/flac';
    if (path.endsWith('.ogg') || path.endsWith('.oga')) return 'audio/ogg';
    if (path.endsWith('.wav')) return 'audio/wav';
    if (path.endsWith('.m4a') || path.endsWith('.mp4') || path.endsWith('.aac')) return 'audio/mp4';
    if (path.endsWith('.mp3')) return 'audio/mpeg';
    return null;
};
