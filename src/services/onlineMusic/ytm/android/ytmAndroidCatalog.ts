import type { YtmWireArtist, YtmWireCollection, YtmWireSong } from '../ytmTransport';

// src/services/onlineMusic/ytm/android/ytmAndroidCatalog.ts
// Android App：把 youtubei.js 解析好的 YouTube Music 页面节点（搜索、专辑、歌手、播放队列）读成线上格式，
// 再按音质档位挑音频格式。和桌面版主进程的 electron/ytm/catalog.cjs、ytmApiBridge.cjs 的 pickAudioFormat
// 是同一套读法（那边在 Node 里跑，这边在 WebView 里跑），页面结构变了两边一起改。

/* eslint-disable @typescript-eslint/no-explicit-any */

export const VIDEO_ID = /^[\w-]{11}$/;

const str = (value: unknown): string => (value == null ? '' : String(value));

// 搜索结果的缩略图只有 60 / 120px；同一张图按后缀里写的尺寸给，改成 544 再要。
const squareArt = (url: string): string => url.replace(/=w(\d+)-h(\d+)(-[^=/]*)?$/, (match, width, height, rest = '') => (
    width === height && Number(width) < 544 ? `=w544-h544${rest}` : match
));

/** 按宽度挑一张缩略图，最宽不过 `maxWidth`。 */
export const thumbnailUrl = (thumbnails: any, maxWidth = 1200): string => {
    const byWidth = (Array.isArray(thumbnails) ? thumbnails : [])
        .filter((item: any) => typeof item?.url === 'string')
        .sort((left: any, right: any) => (left.width || 0) - (right.width || 0));
    const fitting = byWidth.filter((item: any) => (item.width || 0) <= maxWidth);
    return squareArt((fitting.at(-1) ?? byWidth[0])?.url ?? '');
};

const artistsOf = (list: any): YtmWireArtist[] => (Array.isArray(list) ? list : [])
    .filter((artist: any) => str(artist?.name).trim())
    .map((artist: any) => ({ id: str(artist.channel_id), name: str(artist.name).trim() }));

const yearToTime = (value: unknown): number | undefined => {
    const year = Number(/\b(19|20)\d{2}\b/.exec(str(value))?.[0]);
    return Number.isFinite(year) && year > 0 ? Date.UTC(year, 0, 1) : undefined;
};

type SongContext = { artists?: YtmWireArtist[]; albumId?: string; albumName?: string; coverUrl?: string };

/** 一行歌：搜索结果、专辑曲目或歌手的热门歌。`context` 补上专辑行里没写的东西。 */
export function songFromListItem(item: any, context: SongContext = {}): YtmWireSong | null {
    const id = item?.id;
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) return null;
    const name = str(item.title);
    if (!name) return null;
    const artists = artistsOf(item.artists?.length ? item.artists : item.authors);
    return {
        id, name,
        artists: artists.length > 0 ? artists : context.artists ?? [],
        album: {
            id: str(item.album?.id) || context.albumId || '',
            name: str(item.album?.name) || context.albumName || '',
            coverUrl: thumbnailUrl(item.thumbnail?.contents ?? item.thumbnails) || context.coverUrl || '',
        },
        durationMs: Math.max(0, Number(item.duration?.seconds) || 0) * 1000,
    };
}

/** 播放队列里的一项；公开数据里只有这里按 id 写出歌手和专辑。 */
export function songFromQueueItem(item: any): YtmWireSong | null {
    const id = item?.video_id;
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) return null;
    return {
        id, name: str(item.title),
        artists: artistsOf(item.artists),
        album: { id: str(item.album?.id), name: str(item.album?.name), coverUrl: thumbnailUrl(item.thumbnail) },
        durationMs: Math.max(0, Number(item.duration?.seconds) || 0) * 1000,
    };
}

export function albumFromCard(item: any, artists: YtmWireArtist[] = []): YtmWireCollection | null {
    const id = item?.id;
    if (typeof id !== 'string' || !id.startsWith('MPRE')) return null;
    const publishedAt = yearToTime(item.year ?? item.subtitle);
    const own = artistsOf(item.artists);
    return {
        id, type: 'album', name: str(item.title), coverUrl: thumbnailUrl(item.thumbnail),
        artists: own.length > 0 ? own : artists,
        ...(publishedAt === undefined ? {} : { publishedAt }),
    };
}

// 专辑页地址里的列表 id（`…/playlist?list=OLAK5uy_…`），没有时是 ''。
const listIdOf = (url: unknown): string => {
    try { return new URL(str(url)).searchParams.get('list') ?? ''; } catch { return ''; }
};

export function albumFromPage(album: any, id: string): { collection: YtmWireCollection; items: YtmWireSong[] } {
    const header = album?.header ?? {};
    const playlistId = listIdOf(album?.url);
    const name = str(header.title);
    const coverUrl = thumbnailUrl(header.thumbnail?.contents);
    const linked = (Array.isArray(header.strapline_text_one?.runs) ? header.strapline_text_one.runs : [])
        .filter((run: any) => str(run?.endpoint?.payload?.browseId).startsWith('UC'))
        .map((run: any) => ({ id: str(run.endpoint.payload.browseId), name: str(run.text).trim() }));
    const artistText = str(header.strapline_text_one).trim();
    const artists: YtmWireArtist[] = linked.length > 0 ? linked : artistText ? [{ id: '', name: artistText }] : [];
    const items = (Array.isArray(album?.contents) ? album.contents : [])
        .map((item: any) => songFromListItem(item, { artists, albumId: id, albumName: name, coverUrl }))
        .filter(Boolean) as YtmWireSong[];
    const publishedAt = yearToTime(header.subtitle);
    return {
        collection: {
            id, type: 'album', name, coverUrl, artists, trackCount: items.length,
            description: str(header.description?.description),
            ...(playlistId ? { playlistId } : {}),
            ...(publishedAt === undefined ? {} : { publishedAt }),
        },
        items,
    };
}

/** 歌手页：页头、热门歌和几排专辑。`more` 是一排专辑完整列表的入口，调用方再去读。 */
export function artistFromPage(artist: any, id: string) {
    const header = artist?.header ?? {};
    const name = str(header.title);
    const self = [{ id, name }];
    const sections = Array.isArray(artist?.sections) ? artist.sections : [];
    const shelf = sections.find((section: any) => section?.type === 'MusicShelf');
    const albumShelves: Array<{ items: YtmWireCollection[]; more: any }> = sections
        .filter((section: any) => section?.type === 'MusicCarouselShelf' && section.contents?.[0]?.item_type === 'album')
        .map((section: any) => ({
            items: section.contents.map((item: any) => albumFromCard(item, self)).filter(Boolean),
            more: str(section.header?.more_content?.endpoint?.payload?.browseId).startsWith('MPAD')
                ? section.header.more_content.endpoint : null,
        }));
    return {
        collection: {
            id, type: 'artist' as const, name,
            coverUrl: thumbnailUrl(header.thumbnail?.contents ?? header.foreground_thumbnail?.contents),
            description: str(header.description),
        },
        songs: (Array.isArray(shelf?.contents) ? shelf.contents : [])
            .map((item: any) => songFromListItem(item, { artists: self })).filter(Boolean) as YtmWireSong[],
        albumShelves,
    };
}

/** 歌词页的 id（从播放页的原始 JSON 读），没有歌词时是 null。 */
export function lyricsBrowseId(watchPage: any): string | null {
    const tabs = watchPage?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
        ?.watchNextTabbedResultsRenderer?.tabs ?? [];
    for (const tab of tabs) {
        const endpoint = tab?.tabRenderer?.endpoint?.browseEndpoint;
        const pageType = endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && typeof endpoint.browseId === 'string') return endpoint.browseId;
    }
    return null;
}

const lrcTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
    return `[${String(minutes).padStart(2, '0')}:${seconds}]`;
};

/** 手机版 App 的歌词页（原始 JSON）转成 LRC；没有时间轴时是 null。只有「♪」的行去掉，留出间奏。 */
export function lrcFromLyricsPage(page: any): string | null {
    const timed = page?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel
        ?.lyricsData?.timedLyricsData;
    if (!Array.isArray(timed)) return null;
    const lines: string[] = [];
    for (const entry of timed) {
        const text = typeof entry?.lyricLine === 'string' ? entry.lyricLine.replace(/\s+/g, ' ').trim() : '';
        const startMs = Number(entry?.cueRange?.startTimeMilliseconds);
        if (/[\p{L}\p{N}]/u.test(text) && Number.isFinite(startMs) && startMs >= 0) lines.push(`${lrcTime(startMs)}${text}`);
    }
    return lines.length > 0 ? lines.join('\n') : null;
}

// 音质档位挑格式，规则同桌面版的 pickAudioFormat；访客拿不到 ultra 的两个格式，ultra 按 high 给。
// standard 要 itag 250（约 64 kbit/s 的 Opus），high 要原声里码率最高的那个。
const STANDARD_ITAG = 250;
const STANDARD_BITRATE = 64000;
const STANDARD_FLOOR_BITRATE = 40000;
const ULTRA_ITAGS = [774, 141];
export const bitrateOf = (format: any): number => format.average_bitrate || format.bitrate || 0;

export function pickAudioFormat(formats: any[], level: string): any | undefined {
    const audio = formats.filter(format => format.has_audio && !format.has_video && Number(format.content_length) > 0);
    const original = audio.filter(format => !format.is_dubbed && !format.is_auto_dubbed && !format.is_drc
        && format.audio_track?.audio_is_default !== false);
    const every = original.length > 0 ? original : audio;
    const guests = every.filter(format => !ULTRA_ITAGS.includes(format.itag));
    const offered = guests.length > 0 ? guests : every;
    if (level === 'standard') {
        const audible = offered.filter(format => bitrateOf(format) >= STANDARD_FLOOR_BITRATE);
        const opus = audible.filter(format => /opus/i.test(String(format.mime_type)));
        const among = opus.length > 0 ? opus : audible;
        const nearest = among.find(format => format.itag === STANDARD_ITAG)
            ?? [...among].sort((left, right) => Math.abs(bitrateOf(left) - STANDARD_BITRATE) - Math.abs(bitrateOf(right) - STANDARD_BITRATE))[0];
        if (nearest) return nearest;
    }
    return [...offered].sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0))[0];
}
