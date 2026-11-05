// src/tv/services/tvProviderData.ts

import {
    clearProviderAccountSnapshot,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '../../services/onlineMusic/providerAccountCache';
import { omni } from '../../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import type { MediaId, OnlineProviderId, ProviderCollection } from '../../types/onlineMusic';

const refreshInFlight = new Map<OnlineProviderId, Promise<boolean>>();
const hydrationInFlight = new Map<OnlineProviderId, Promise<void>>();

const providerSupportsAccount = (providerId: OnlineProviderId): boolean => {
    try {
        return Boolean(omni.getProviderCapabilities(providerId).auth);
    } catch {
        return false;
    }
};

const fetchPlaylists = async (providerId: OnlineProviderId, userId: MediaId): Promise<ProviderCollection[]> => {
    const playlists: ProviderCollection[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore && offset < 1000) {
        const page = await omni.getProviderUserPlaylists(providerId, userId, { limit: 500, offset });
        playlists.push(...page.items.filter(collection => collection.type === 'playlist'));
        hasMore = page.hasMore && page.nextOffset > offset;
        offset = page.nextOffset;
    }
    return playlists;
};

export const hydrateTvProviderAccount = async (providerId: OnlineProviderId): Promise<void> => {
    const existing = hydrationInFlight.get(providerId);
    if (existing) return existing;

    const task = (async () => {
        const snapshot = await loadProviderAccountSnapshot(providerId).catch(() => null);
        if (!snapshot) return;
        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        if (account?.user) return;
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            status: 'authenticated',
            user: snapshot.user,
            collections: snapshot.collections,
            likedSongIds: snapshot.likedSongIds,
            hydration: 'ready',
            freshness: 'stale',
            lastUpdatedAt: snapshot.savedAt,
        });
    })().finally(() => hydrationInFlight.delete(providerId));

    hydrationInFlight.set(providerId, task);
    return task;
};

export const hydrateTvProviderAccounts = async (providerIds: OnlineProviderId[]): Promise<void> => {
    await Promise.all(providerIds.map(providerId => hydrateTvProviderAccount(providerId)));
};

export const refreshTvProviderAccount = (providerId: OnlineProviderId): Promise<boolean> => {
    const existing = refreshInFlight.get(providerId);
    if (existing) return existing;

    const task = (async () => {
        if (!providerSupportsAccount(providerId)) return false;
        const store = useOnlineProviderAccountStore.getState();
        const previous = store.accounts[providerId];
        let user;
        try {
            user = await omni.getLoginStatus(providerId);
        } catch (error) {
            store.updateAccount(providerId, {
                status: previous?.user ? 'authenticated' : 'error',
                hydration: 'ready',
                freshness: 'error',
                error: error instanceof Error ? error.message : 'provider-refresh-failed',
            });
            throw error;
        }

        if (!user) {
            store.updateAccount(providerId, {
                status: 'anonymous',
                user: null,
                collections: [],
                likedSongIds: [],
                hydration: 'ready',
                freshness: 'fresh',
            });
            await clearProviderAccountSnapshot(providerId).catch(() => undefined);
            return false;
        }

        store.updateAccount(providerId, {
            status: 'authenticated',
            user,
            hydration: 'ready',
            freshness: 'refreshing',
            error: undefined,
        });

        let playlists: ProviderCollection[] = previous?.collections.filter(collection => collection.type === 'playlist') ?? [];
        let likedSongIds: MediaId[] = previous?.likedSongIds ?? [];
        try {
            playlists = await fetchPlaylists(providerId, user.id);
        } catch (error) {
            console.warn('[TV Account] Playlist refresh failed', providerId, error);
        }
        try {
            likedSongIds = await omni.getProviderLikedSongIds(providerId, user.id);
        } catch (error) {
            console.warn('[TV Account] Liked-song refresh failed', providerId, error);
        }

        const nonPlaylistCollections = previous?.collections.filter(collection => collection.type !== 'playlist') ?? [];
        const collections = [...playlists, ...nonPlaylistCollections];
        const snapshot = await saveProviderAccountSnapshot(providerId, {
            user,
            collections,
            likedSongIds,
        }).catch(() => null);
        store.updateAccount(providerId, {
            status: 'authenticated',
            user,
            collections,
            likedSongIds,
            hydration: 'ready',
            freshness: 'fresh',
            lastUpdatedAt: snapshot?.savedAt ?? Date.now(),
            error: undefined,
        });
        return true;
    })().finally(() => refreshInFlight.delete(providerId));

    refreshInFlight.set(providerId, task);
    return task;
};

export const logoutTvProviderAccount = async (providerId: OnlineProviderId): Promise<void> => {
    if (providerSupportsAccount(providerId)) {
        await omni.logout(providerId).catch(() => undefined);
    }
    useOnlineProviderAccountStore.getState().clearAccount(providerId);
    await clearProviderAccountSnapshot(providerId).catch(() => undefined);
};

