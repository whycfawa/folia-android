// src/tv/hooks/useTvCollectionTracks.ts

import { useCallback, useEffect, useRef, useState } from 'react';
import { omni } from '../../services/onlineMusic/omni';
import type { SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';

const TV_COLLECTION_TRACK_LIMIT = 120;

export type TvCollectionTracksModel = {
    tracks: SongResult[];
    isLoading: boolean;
    error: string | null;
    reload: () => void;
};

/** Loads one bounded page for the TV collection sheet; low-memory devices never build a large list. */
export const useTvCollectionTracks = (collection: ProviderCollection): TvCollectionTracksModel => {
    const [tracks, setTracks] = useState<SongResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const requestRef = useRef(0);

    const reload = useCallback(() => setRevision(value => value + 1), []);

    useEffect(() => {
        const requestId = ++requestRef.current;
        setIsLoading(true);
        setError(null);
        void omni.getCollectionTracks(collection, {
            limit: TV_COLLECTION_TRACK_LIMIT,
            offset: 0,
        })
            .then(page => {
                if (requestRef.current === requestId) setTracks(page.items);
            })
            .catch(loadError => {
                if (requestRef.current !== requestId) return;
                console.warn('[TV Collection] Track load failed', loadError);
                setTracks([]);
                setError(loadError instanceof Error ? loadError.message : 'collection-tracks-unavailable');
            })
            .finally(() => {
                if (requestRef.current === requestId) setIsLoading(false);
            });
    }, [collection, revision]);

    return { tracks, isLoading, error, reload };
};

