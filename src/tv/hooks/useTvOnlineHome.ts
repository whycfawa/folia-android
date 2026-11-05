import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import type {
    LibraryHomeCard,
    LibraryHomeFeedOwner,
    LibraryHomeFeedStatus,
} from '../../library/core/contracts/homeModel';
import { buildOnlineAlbumCards, buildOnlineRadioCards } from '../../library/core/model/homeCards';
import { readOnlineProviderCapabilities } from '../../library/core/services/onlineHomeProvider';
import { omni } from '../../services/onlineMusic/omni';
import type { SongResult } from '../../types';
import type { MediaId } from '../../types/onlineMusic';
import {
    createTvOnlineHomeResources,
    isAbortError,
    sameOnlineHomeFeedOwner,
    type TvRadioFeedData,
} from '../services/tvOnlineHomeFeeds';
import type { TvAccountModel } from './useTvAccount';

// src/tv/hooks/useTvOnlineHome.ts
// TV 首页的在线专辑与电台数据。两份资源都带 provider/账户归属：切换账户时旧数据立即清空，晚到的应答
// 也不会进入新账户。电台资源额外保留完整歌曲数组，私人 FM / 每日推荐点击时无需再读一次列表。

export type TvRadioActionError = 'personal-fm' | 'daily';

export type TvOnlineHomeModel = {
    canUseAlbums: boolean;
    canUseRadio: boolean;
    albumCards: LibraryHomeCard[];
    radioCards: LibraryHomeCard[];
    albumsStatus: LibraryHomeFeedStatus;
    radioStatus: LibraryHomeFeedStatus;
    radioActionError: TvRadioActionError | null;
    playPersonalFm: () => Promise<SongResult[] | null>;
    playDailyRecommendations: () => Promise<SongResult[] | null>;
};

export const useTvOnlineHome = (account: TvAccountModel): TvOnlineHomeModel => {
    const { t } = useTranslation();
    const providerId = account.activeProviderId;
    const userId: MediaId | null = account.activeAccount?.user?.id ?? null;
    const owner = useMemo(
        () => (userId === null ? null : { providerId, userId }),
        [providerId, userId],
    );
    const capabilities = useMemo(
        () => readOnlineProviderCapabilities(providerId),
        [providerId],
    );
    const canUseAlbums = capabilities.userLibrary && Boolean(capabilities.userAlbums);
    const canUseRadio = capabilities.recommendations;

    const resourcesRef = useRef<ReturnType<typeof createTvOnlineHomeResources> | null>(null);
    if (!resourcesRef.current) resourcesRef.current = createTvOnlineHomeResources();
    const resources = resourcesRef.current;
    const { favoriteAlbums, radioFeed } = resources;

    const albumSnapshot = useSyncExternalStore(
        favoriteAlbums.subscribe,
        favoriteAlbums.getSnapshot,
    );
    const radioSnapshot = useSyncExternalStore(
        radioFeed.subscribe,
        radioFeed.getSnapshot,
    );
    const playbackRequestRef = useRef(0);
    const [radioActionError, setRadioActionError] = useState<TvRadioActionError | null>(null);

    useLayoutEffect(() => {
        const albumsOwner = canUseAlbums ? owner : null;
        const radioOwner = canUseRadio ? owner : null;
        favoriteAlbums.setOwner(albumsOwner);
        radioFeed.setOwner(radioOwner);
        if (albumsOwner) void favoriteAlbums.ensure();
        if (radioOwner) void radioFeed.ensure();

        return () => {
            favoriteAlbums.setOwner(null);
            radioFeed.setOwner(null);
        };
    }, [canUseAlbums, canUseRadio, favoriteAlbums, owner, radioFeed]);

    useEffect(() => {
        playbackRequestRef.current += 1;
        setRadioActionError(null);
        return () => {
            playbackRequestRef.current += 1;
        };
    }, [owner]);

    const isCurrentOwner = useCallback((candidate: LibraryHomeFeedOwner | null): boolean => (
        candidate !== null
        && owner !== null
        && candidate.providerId === owner.providerId
        && String(candidate.userId) === String(owner.userId)
    ), [owner]);

    const runRadioPlayback = useCallback(async (
        reason: TvRadioActionError,
        selectCachedSongs: (data: TvRadioFeedData) => SongResult[],
        loadFallbackSongs: () => Promise<SongResult[]>,
    ): Promise<SongResult[] | null> => {
        const snapshot = radioFeed.getSnapshot();
        if (!snapshot.data || !isCurrentOwner(snapshot.owner)) return null;

        const requestId = ++playbackRequestRef.current;
        const ownerAtStart = snapshot.owner;
        setRadioActionError(null);
        let songs = selectCachedSongs(snapshot.data);
        try {
            if (songs.length === 0) songs = await loadFallbackSongs();
        } catch (error) {
            const latest = radioFeed.getSnapshot();
            if (
                requestId !== playbackRequestRef.current
                || !sameOnlineHomeFeedOwner(ownerAtStart, latest.owner)
                || !isCurrentOwner(latest.owner)
            ) return null;
            if (!isAbortError(error)) {
                console.warn('[TV Online] Radio playback unavailable', reason, error);
                setRadioActionError(reason);
            }
            return null;
        }

        const latest = radioFeed.getSnapshot();
        if (
            requestId !== playbackRequestRef.current
            || !sameOnlineHomeFeedOwner(ownerAtStart, latest.owner)
            || !isCurrentOwner(latest.owner)
        ) return null;
        if (songs.length === 0) {
            setRadioActionError(reason);
            return null;
        }
        return songs;
    }, [isCurrentOwner, radioFeed]);

    const playPersonalFm = useCallback(
        () => runRadioPlayback(
            'personal-fm',
            data => data.personalFm,
            () => omni.getPersonalFm(),
        ),
        [runRadioPlayback],
    );

    const playDailyRecommendations = useCallback(
        () => runRadioPlayback(
            'daily',
            data => data.dailySongs,
            () => omni.getDailySongs(),
        ),
        [runRadioPlayback],
    );

    const albumCards = useMemo(
        () => buildOnlineAlbumCards(albumSnapshot.data, t),
        [albumSnapshot.data, t],
    );
    const radioCards = useMemo(
        () => buildOnlineRadioCards(radioSnapshot.data?.feed ?? null, { t }),
        [radioSnapshot.data?.feed, t],
    );

    return {
        canUseAlbums,
        canUseRadio,
        albumCards,
        radioCards,
        albumsStatus: albumSnapshot.status,
        radioStatus: radioSnapshot.status,
        radioActionError,
        playPersonalFm,
        playDailyRecommendations,
    };
};
