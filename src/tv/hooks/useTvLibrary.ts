// src/tv/hooks/useTvLibrary.ts

import { useEffect, useMemo, useRef, useState } from 'react';
import { getLocalSongs } from '../../services/db';
import { omni } from '../../services/onlineMusic/omni';
import { buildLocalQueue } from '../../services/playbackAdapters';
import type { SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import type { TvAccountModel } from './useTvAccount';

const TV_LOCAL_ROW_SIZE = 14;

export type TvLibraryModel = {
    localSongs: SongResult[];
    recentLocalSongs: SongResult[];
    likedSongs: SongResult[];
    playlists: ProviderCollection[];
    isLoadingLocal: boolean;
    isLoadingLiked: boolean;
    likedError: string | null;
};

export const useTvLibrary = (account: TvAccountModel): TvLibraryModel => {
    const [localSongs, setLocalSongs] = useState<SongResult[]>([]);
    const [likedSongs, setLikedSongs] = useState<SongResult[]>([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);
    const [isLoadingLiked, setIsLoadingLiked] = useState(false);
    const [likedError, setLikedError] = useState<string | null>(null);
    const likedRequestRef = useRef(0);
    const userId = account.activeAccount?.user?.id ?? null;
    const providerId = account.activeProviderId;

    useEffect(() => {
        let cancelled = false;
        setIsLoadingLocal(true);
        void getLocalSongs()
            .then(songs => {
                if (cancelled) return;
                const sorted = [...songs].sort((left, right) => right.addedAt - left.addedAt);
                setLocalSongs(buildLocalQueue(sorted));
            })
            .catch(error => {
                console.warn('[TV Library] Local library unavailable', error);
                if (!cancelled) setLocalSongs([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoadingLocal(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const requestId = ++likedRequestRef.current;
        if (!userId) {
            setLikedSongs([]);
            setIsLoadingLiked(false);
            setLikedError(null);
            return;
        }

        setIsLoadingLiked(true);
        setLikedError(null);
        void omni.getProviderLikedSongs(providerId, userId)
            .then(songs => {
                if (likedRequestRef.current === requestId) setLikedSongs(songs);
            })
            .catch(error => {
                if (likedRequestRef.current !== requestId) return;
                console.warn('[TV Library] Liked songs unavailable', error);
                setLikedSongs([]);
                setLikedError(error instanceof Error ? error.message : 'liked-songs-unavailable');
            })
            .finally(() => {
                if (likedRequestRef.current === requestId) setIsLoadingLiked(false);
            });
    }, [providerId, userId]);

    const playlists = useMemo(
        () => (account.activeAccount?.collections ?? []).filter(collection => (
            collection.type === 'playlist' || collection.type === 'cloud'
        )),
        [account.activeAccount?.collections],
    );

    const recentLocalSongs = useMemo(
        () => localSongs.slice(0, TV_LOCAL_ROW_SIZE),
        [localSongs],
    );

    return {
        localSongs,
        recentLocalSongs,
        likedSongs,
        playlists,
        isLoadingLocal,
        isLoadingLiked,
        likedError,
    };
};

