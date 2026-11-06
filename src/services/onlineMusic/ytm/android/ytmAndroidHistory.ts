import type { YtmParams, YtmWirePage, YtmWireSong } from '../ytmTransport';
import { VIDEO_ID, songFromListItem } from './ytmAndroidCatalog';

// src/services/onlineMusic/ytm/android/ytmAndroidHistory.ts
// Android App：读账号在 YouTube Music 的听歌记录（历史页，账号在平台自己那里留下的「我播过什么」）。
// 只读：历史是平台替账号记的账，这里不写它、不删它的条目；在这里放一首歌记账也记不到它头上
// ——那条账记在 Folia 自己的播放记录里（recentPlays.ts）。
// 它不设已登录的门、不管会话：会话和库都从注入进来的 host 拿（ytmAndroidBridge 的 loadLibrary
// 和 signedSession，一轮在途操作随登出作废的规矩在桥的门里）。装配的接缝在注释的最后一节：
// 桥在 handlers 里加 `account_history` 操作，把 host 交进来，把本模块的错带上码交出去。
// 页面读法和桥里 playlistPageOf 是同一套：第一页从歌单式书架（MusicPlaylistShelf，采用桌面版
// 读 LM 榜的读法）里取行，往后的页从追加动画（AppendContinuationItemsAction）里取行；每行还是
// MusicResponsiveListItem 的样子，交给 ytmAndroidCatalog 的 songFromListItem 读成 wire 上的歌，
// 不是那个样子的行丢掉。空的第一页是真的没有历史；往后的页一行都没有，是页面改了样，报
// invalid-response，不把一次页面改动说成「记录到此为止」。

/* eslint-disable @typescript-eslint/no-explicit-any */

type Library = typeof import('youtubei.js');
type Session = InstanceType<Library['Innertube']>;

/** youtubei.js 的历史页 browse id。 */
export const YTM_HISTORY_BROWSE_ID = 'FEmusic_history';

// 一个令牌有多长：youtubei.js 的 continuation 是 8192 字符宽限内的一长串（桥里 pageToken 的同限）。
const TOKEN_MAX_LENGTH = 8192;

/** 本模块能把页面读坏了的错分型给装配方：桥见到它，把它的原话带上码交出去。 */
export class YtmHistoryError extends Error {}

export interface YtmAndroidHistoryHost {
    /** youtubei.js（ytmAndroidBridge 的 loadLibrary）。 */
    loadLibrary: () => Promise<Library>;
    /** 已登录的会话（ytmAndroidBridge 的 signedSession）；没人登录它自己抛 `auth-required`。 */
    session: () => Promise<Session>;
}

const invalidPageToken = (value: unknown): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length === 0 || value.length > TOKEN_MAX_LENGTH) {
        throw new YtmHistoryError('Invalid history page token');
    }
    return value;
};

/** 行里读出的是不是 wire 形状的一支歌：id、名字、歌手、专辑、时长都齐了才算。 */
const isWireSong = (song: YtmWireSong): boolean => (
    typeof song.id === 'string' && VIDEO_ID.test(song.id)
    && typeof song.name === 'string' && song.name.length > 0
    && Array.isArray(song.artists) && song.artists.every(artist => typeof artist.id === 'string' && typeof artist.name === 'string')
    && typeof song.album === 'object' && song.album !== null
    && typeof song.album.id === 'string' && typeof song.album.name === 'string'
    && Number.isFinite(song.durationMs) && song.durationMs >= 0
);

// 一页的行：第一页在书架里，往后的页在追加动画里；每一行交给目录读成 wire 的歌，不是任何一支
// 歌的行丢掉，书架或最后一行行上的令牌是往后的页。
const historyPage = (page: any, isFurtherPage: boolean, YTNodes: Library['YTNodes']): YtmWirePage<YtmWireSong> => {
    const playlistShelves = isFurtherPage ? [] : page.contents_memo?.getType(YTNodes.MusicPlaylistShelf) ?? [];
    const shelves = playlistShelves.length > 0 ? playlistShelves
        : isFurtherPage ? [] : page.contents_memo?.getType(YTNodes.MusicShelf) ?? [];
    const shelf = shelves[shelves.length - 1];
    const actions = [...(page.on_response_received_actions ?? []), ...(page.on_response_received_endpoints ?? [])];
    const appended = actions.find((action: any) => action?.type === 'AppendContinuationItemsAction');
    const continued = page.continuation_contents;
    const supportedContinuation = ['MusicShelfContinuation', 'MusicPlaylistShelfContinuation'].includes(continued?.type);
    if (!isFurtherPage && shelves.length === 0) throw new YtmHistoryError('The history page had no recognizable shelf');
    const rows = [...(isFurtherPage
        ? appended?.contents ?? (supportedContinuation ? continued.contents : [])
        : shelves.flatMap((section: any) => section.contents ?? []))];
    // 往后的页一行没有，可能是 YouTube 把页面改了样：报坏页，不当成「记录到此为止」。
    if (isFurtherPage && !appended && !supportedContinuation) throw new YtmHistoryError('The history page continued into nothing');
    const next = rows.find((row: any) => row?.type === 'ContinuationItem')?.endpoint?.payload?.token
        ?? (isFurtherPage ? continued?.continuation : shelf?.continuation);
    return {
        items: rows.map((row: any) => songFromListItem(row)).filter((song): song is YtmWireSong => song !== null && isWireSong(song)),
        ...(typeof next === 'string' && next ? { continuation: next } : {}),
    };
};

/**
 * 读听歌记录的一页。`params.continuation` 是上一页给的令牌，缺省读第一页；答的是 wire 形状
 * （一页歌，和往后的页令牌，没有就是到此为止）。装配在桥里已登录的门之后才有意义：没登录会话
 * 自己就抛 `auth-required`，这里不再问一遍。
 *
 * 装配的接缝（ytmAndroidBridge.ts，别处不动）：
 *   1. ytmTransport.ts 的 YtmOperation 加一个操作名（`account_history` 由配的老地方记得）；
 *   2. 桥的 handlers 里加：
 *        account_history: async params => {
 *            const page = await readYtmAccountHistory({ loadLibrary, session: signedSession }, params);
 *            ...page.continuation 过桥的 pageToken 校验后原样交出
 *        },
 *      往外交前照旧过一遍 wire 校验，仓库不直接交 youtubei.js 的页面节点；
 *   3. 桥的 toErrorResult 认得 YtmHistoryError 的把码翻成 invalid-response（或直接 fail 原话）。
 * ytmProvider 一侧照 userAlbums 的样子：capabilities.listeningHistory 与 library.getListeningHistory。
 */
export const readYtmAccountHistory = async (host: YtmAndroidHistoryHost, params: YtmParams): Promise<YtmWirePage<YtmWireSong>> => {
    const [yt, { YTNodes }] = await Promise.all([host.session(), host.loadLibrary()]);
    const hasContinuation = params.continuation !== undefined;
    const page: any = await yt.actions.execute('/browse', {
        ...(
            hasContinuation
                ? { continuation: invalidPageToken(params.continuation) }
                : { browseId: YTM_HISTORY_BROWSE_ID }
        ),
        client: 'YTMUSIC',
        parse: true,
    });
    return historyPage(page, hasContinuation, YTNodes);
};
