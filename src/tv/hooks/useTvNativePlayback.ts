// src/tv/hooks/useTvNativePlayback.ts

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TvPlayerModel } from '../model/tvTypes';
import {
    buildTvNativePlaybackIdentity,
    buildTvNativePlaybackPayload,
    loadTvNativePlaybackPlugin,
    resolveTvNativeMediaAction,
    type TvNativePlaybackPlugin,
} from '../services/tvNativePlayback';

export type TvNativePlaybackController = {
    available: boolean;
    canBackground: boolean;
    canExit: boolean;
    moveToBackground: () => Promise<boolean>;
    exitApp: () => Promise<boolean>;
};

/**
 * Keeps Android's MediaSession and foreground service in sync with TV's own queue.
 *
 * The phone bridge reads a different Zustand store, so TV needs a separate snapshot source.
 * Position is only pushed on real state changes (play/pause/seek/track), which avoids restarting
 * a foreground service from the background every second on Android 12+.
 */
export const useTvNativePlayback = (player: TvPlayerModel): TvNativePlaybackController => {
    const [plugin, setPlugin] = useState<TvNativePlaybackPlugin | null>(null);
    const [foregroundRevision, setForegroundRevision] = useState(0);
    const lastIdentityRef = useRef('');
    const actionLockRef = useRef<'background' | 'exit' | null>(null);
    const exitRequestedRef = useRef(false);

    const {
        audioRef,
        currentSong,
        status,
        duration,
        positionRevision,
        currentTime,
        resumeCurrent,
        pause,
        next,
        previous,
    } = player;

    useEffect(() => {
        let disposed = false;
        void loadTvNativePlaybackPlugin().then(resolved => {
            if (!disposed) setPlugin(resolved);
        });
        return () => {
            disposed = true;
        };
    }, []);

    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                setForegroundRevision(revision => revision + 1);
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, []);

    useEffect(() => {
        if (!plugin || exitRequestedRef.current) return;
        const audioPosition = audioRef.current?.currentTime;
        const positionSeconds = typeof audioPosition === 'number' && Number.isFinite(audioPosition)
            ? audioPosition
            : currentTime.get();
        const payload = buildTvNativePlaybackPayload({
            song: currentSong,
            status,
            positionSeconds,
            durationSeconds: duration,
        });

        if (!payload) {
            if (lastIdentityRef.current) {
                lastIdentityRef.current = '';
                void plugin.clearPlaybackState().catch(() => undefined);
            }
            return;
        }

        const identity = buildTvNativePlaybackIdentity(payload);
        if (identity === lastIdentityRef.current) return;
        lastIdentityRef.current = identity;
        void plugin.updatePlaybackState(payload).catch(() => {
            if (lastIdentityRef.current === identity) lastIdentityRef.current = '';
        });
    }, [
        audioRef,
        currentSong,
        currentTime,
        duration,
        foregroundRevision,
        plugin,
        positionRevision,
        status,
    ]);

    useEffect(() => {
        if (!plugin) return undefined;
        let disposed = false;
        let listenerHandle: { remove: () => Promise<void> } | { remove: () => void } | null = null;
        const registered = plugin.addListener('mediaAction', ({ action }) => {
            if (disposed) return;
            const resolved = resolveTvNativeMediaAction(action);
            if (resolved === 'play') resumeCurrent();
            else if (resolved === 'pause') pause();
            else if (resolved === 'next') next();
            else if (resolved === 'previous') previous();
            else if (resolved === 'stop') pause();
        });

        Promise.resolve(registered)
            .then(handle => {
                if (disposed) {
                    void handle.remove();
                    return;
                }
                listenerHandle = handle;
            })
            .catch(() => undefined);

        return () => {
            disposed = true;
            if (listenerHandle) void listenerHandle.remove();
        };
    }, [next, pause, plugin, previous, resumeCurrent]);

    const moveToBackground = useCallback(async (): Promise<boolean> => {
        if (!plugin?.moveTaskToBack || actionLockRef.current) return false;
        actionLockRef.current = 'background';
        try {
            await plugin.moveTaskToBack();
            return true;
        } catch {
            return false;
        } finally {
            actionLockRef.current = null;
        }
    }, [plugin]);

    const exitApp = useCallback(async (): Promise<boolean> => {
        if (actionLockRef.current) return false;
        actionLockRef.current = 'exit';
        exitRequestedRef.current = true;
        pause();
        try {
            await plugin?.clearPlaybackState().catch(() => undefined);
        } finally {
            actionLockRef.current = null;
        }
        if (!plugin?.exitApp) return false;
        try {
            await plugin.exitApp();
            return true;
        } catch {
            return false;
        }
    }, [pause, plugin]);

    return {
        available: Boolean(plugin),
        canBackground: Boolean(plugin?.moveTaskToBack),
        canExit: Boolean(plugin?.exitApp),
        moveToBackground,
        exitApp,
    };
};
