import type {
    LibraryHomeFeedOwner,
    LibraryHomeFeedResource,
    LibraryHomeRadioFeed,
} from '../../library/core/contracts/homeModel';
import { onlineHomeFeedDeps } from '../../library/core/services/onlineHomeFeedDeps';
import {
    createFavoriteAlbumsFeed,
    createHomeFeedResource,
    HOME_FEED_RECOMMENDATION_LIMIT,
} from '../../library/core/services/onlineHomeFeeds';
import { omni } from '../../services/onlineMusic/omni';
import type { SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import { resolveTvSongCoverUrl } from './tvPlaybackSource';

// src/tv/services/tvOnlineHomeFeeds.ts
// TV 首页在线数据的资源工厂。收藏专辑沿用 core 的全量分页资源；电台资源额外保留完整歌曲数组，
// 让私人 FM / 每日推荐点击时可以直接播放，同时继续使用 core 的归属 generation 丢弃旧账户应答。

export type TvRadioFeedData = {
    feed: LibraryHomeRadioFeed;
    personalFm: SongResult[];
    dailySongs: SongResult[];
};

export type TvOnlineHomeResources = {
    favoriteAlbums: LibraryHomeFeedResource<ProviderCollection[]>;
    radioFeed: LibraryHomeFeedResource<TvRadioFeedData | null>;
};

const createTvRadioFeed = (): LibraryHomeFeedResource<TvRadioFeedData | null> => createHomeFeedResource<TvRadioFeedData | null>({
    label: 'TV radio feed',
    empty: null,
    load: async owner => {
        const { personalFm, dailySongs, recommendedCollections, partial } = await omni.getHomeFeed(
            HOME_FEED_RECOMMENDATION_LIMIT,
        );
        return {
            personalFm,
            dailySongs,
            feed: {
                personalFmCoverUrl: resolveTvSongCoverUrl(personalFm[0] ?? null) ?? undefined,
                dailyCoverUrl: resolveTvSongCoverUrl(dailySongs[0] ?? null) ?? '',
                dailyCount: dailySongs.length,
                supportsDailySongs: omni.supportsDailySongs(owner.providerId),
                recommended: recommendedCollections,
                ...(partial ? { partial: true as const } : {}),
            },
        };
    },
    isComplete: data => !data?.feed.partial,
});

export const createTvOnlineHomeResources = (): TvOnlineHomeResources => ({
    favoriteAlbums: createFavoriteAlbumsFeed(onlineHomeFeedDeps),
    radioFeed: createTvRadioFeed(),
});

export const sameOnlineHomeFeedOwner = (
    left: LibraryHomeFeedOwner | null,
    right: LibraryHomeFeedOwner | null,
): boolean => (
    left !== null
    && right !== null
    && left.providerId === right.providerId
    && String(left.userId) === String(right.userId)
);

export const isAbortError = (error: unknown): boolean => (
    typeof error === 'object'
    && error !== null
    && (error as { name?: unknown }).name === 'AbortError'
);
