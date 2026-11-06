// src/tv/TvApp.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyKeepScreenOn, readStoredKeepScreenOn } from '../services/androidKeepScreenOn';
import { useNativeBackButton } from '../hooks/useNativeBackButton';
import type { SongResult } from '../types';
import type { ProviderCollection } from '../types/onlineMusic';
import { TvCollectionOverlay } from './components/TvCollectionOverlay';
import { TvExitOverlay } from './components/TvExitOverlay';
import { TvEffectsOverlay } from './components/TvEffectsOverlay';
import { TvLoginOverlay } from './components/TvLoginOverlay';
import { TvQueueOverlay } from './components/TvQueueOverlay';
import { TvSearchOverlay } from './components/TvSearchOverlay';
import { useTvAccount } from './hooks/useTvAccount';
import { useTvControlsAutoHide } from './hooks/useTvControlsAutoHide';
import { useTvFocus } from './hooks/useTvFocus';
import { useTvLibrary } from './hooks/useTvLibrary';
import { useTvNativePlayback } from './hooks/useTvNativePlayback';
import { useTvPerformanceProfile } from './hooks/useTvPerformanceProfile';
import { useTvPlayer } from './hooks/useTvPlayer';
import { useTvRemote } from './hooks/useTvRemote';
import { clickFocusedTvElement } from './input/focusDom';
import { isTvDirection, type TvRemoteAction } from './input/tvKeys';
import {
    createTvTrackSkipGesture,
    TV_TRACK_SKIP_INTERVAL_MS,
} from './input/tvTrackSkipGesture';
import { shouldRevealTvPlayerChrome } from './model/tvPlayerChrome';
import { resolveTvBackRoute, resolveTvLayer, TV_HOME_ROUTE, type TvRoute } from './model/tvRoute';
import { TvHome } from './pages/TvHome';
import { TvPlayer } from './pages/TvPlayer';

const RESET_FOCUS_MEMORY_LAYERS = ['exit', 'login', 'collection', 'search', 'queue', 'effects'] as const;

export const TvApp = () => {
    const player = useTvPlayer();
    const nativePlayback = useTvNativePlayback(player);
    const performanceProfile = useTvPerformanceProfile();
    const account = useTvAccount({ onProviderSwitch: player.pause });
    const library = useTvLibrary(account);
    const trackSkipGestureRef = useRef(createTvTrackSkipGesture());
    const pendingChromeRevealTimerRef = useRef<number | null>(null);
    const [route, setRoute] = useState<TvRoute>(TV_HOME_ROUTE);
    const [collection, setCollection] = useState<ProviderCollection | null>(null);
    const [loginError, setLoginError] = useState<string | null>(null);
    const loginCompletionBaselineRef = useRef<number | null>(null);
    const activeLayer = resolveTvLayer(route);

    useNativeBackButton();

    const closeAccount = useCallback(() => {
        if (account.pendingSwitch) account.cancelSwitch(account.pendingSwitch.request.id);
        account.closeLogin();
        setRoute(current => ({ ...current, overlay: null }));
        setLoginError(null);
        loginCompletionBaselineRef.current = null;
    }, [account.cancelSwitch, account.closeLogin, account.pendingSwitch]);

    const cancelPendingChromeReveal = useCallback(() => {
        if (pendingChromeRevealTimerRef.current === null) return;
        window.clearTimeout(pendingChromeRevealTimerRef.current);
        pendingChromeRevealTimerRef.current = null;
    }, []);

    const revealPlayerChrome = useCallback(() => {
        cancelPendingChromeReveal();
        setRoute(current => (
            current.page === 'player' && !current.overlay
                ? { ...current, overlay: 'controls' }
                : current
        ));
    }, [cancelPendingChromeReveal]);

    const schedulePlayerChromeReveal = useCallback(() => {
        cancelPendingChromeReveal();
        // A hidden-player horizontal press may start a double-tap skip. Delay chrome
        // activation until the second press can no longer complete that gesture.
        pendingChromeRevealTimerRef.current = window.setTimeout(() => {
            pendingChromeRevealTimerRef.current = null;
            trackSkipGestureRef.current.clear();
            revealPlayerChrome();
        }, TV_TRACK_SKIP_INTERVAL_MS);
    }, [cancelPendingChromeReveal, revealPlayerChrome]);

    const closeControls = useCallback(() => {
        cancelPendingChromeReveal();
        trackSkipGestureRef.current.clear();
        setRoute(current => (
            current.overlay === 'controls' ? { ...current, overlay: null } : current
        ));
    }, [cancelPendingChromeReveal]);

    const hideControls = useCallback(() => closeControls(), [closeControls]);
    const touchControls = useTvControlsAutoHide({
        active: route.page === 'player' && route.overlay === 'controls',
        onHide: hideControls,
    });
    const defaultFocus = useMemo(() => ({
        home: 'home-hero',
        controls: 'controls-play',
        effects: `effects-lyrics-${player.visualizerMode}`,
        queue: player.currentIndex >= 0
            ? 'queue-current'
            : player.queue[0]
                ? `queue-${player.queue[0].id}-0`
                : undefined,
        collection: 'collection-play-all',
        search: 'search-input',
        exit: 'exit-background',
        login: account.pendingSwitch
            ? 'login-switch-confirm'
            : account.login?.methodStep?.options[0]
                ? `login-method-${account.login.methodStep.options[0].id}`
                : account.login
                    ? account.login.backendFailure
                        ? 'login-restart'
                        : account.login.canRetry
                            ? 'login-retry'
                            : `login-provider-${account.activeProviderId}`
                    : `login-provider-${account.activeProviderId}`,
    }), [
        account.activeProviderId,
        account.login,
        account.pendingSwitch,
        player.currentIndex,
        player.queue[0]?.id,
        player.visualizerMode,
    ]);
    const { moveFocus } = useTvFocus(
        activeLayer,
        `${route.page}:${route.overlay}:${collection?.id ?? ''}:${player.currentIndex}:${
            account.login?.session?.phase ?? ''
        }:${account.pendingSwitch?.request.id ?? ''}`,
        defaultFocus,
        RESET_FOCUS_MEMORY_LAYERS,
    );

    const goBack = useCallback((): boolean => {
        if (route.overlay === 'login') {
            closeAccount();
            return true;
        }
        const next = resolveTvBackRoute(route);
        if (!next) return false;
        if (route.overlay === 'collection') setCollection(null);
        setRoute(next);
        return true;
    }, [closeAccount, route]);

    const handleAction = useCallback((
        action: TvRemoteAction,
        { repeat }: { repeat: boolean },
    ): boolean => {
        if (action === 'back') {
            cancelPendingChromeReveal();
            trackSkipGestureRef.current.clear();
            return goBack();
        }

        if (route.page === 'player' && !route.overlay) {
            if (shouldRevealTvPlayerChrome(action)) {
                if (action === 'left' || action === 'right') {
                    if (repeat) {
                        cancelPendingChromeReveal();
                        trackSkipGestureRef.current.clear();
                        return true;
                    }
                    if (trackSkipGestureRef.current.press(action, performance.now())) {
                        cancelPendingChromeReveal();
                        if (action === 'left') player.skipPrevious();
                        else player.next();
                        return true;
                    }
                    schedulePlayerChromeReveal();
                    return true;
                }
                trackSkipGestureRef.current.clear();
                revealPlayerChrome();
                return true;
            }
        }

        cancelPendingChromeReveal();
        if (
            route.page === 'player'
            && route.overlay === 'controls'
            && !repeat
            && (action === 'left' || action === 'right')
        ) {
            if (trackSkipGestureRef.current.press(action, performance.now())) {
                if (action === 'left') player.skipPrevious();
                else player.next();
                return true;
            }
        } else {
            trackSkipGestureRef.current.clear();
        }

        if (action === 'ok') return clickFocusedTvElement();
        if (isTvDirection(action)) return moveFocus(action);
        if (action === 'menu') return false;
        return false;
    }, [
        cancelPendingChromeReveal,
        goBack,
        player,
        revealPlayerChrome,
        route,
        moveFocus,
        schedulePlayerChromeReveal,
    ]);

    useTvRemote({
        onAction: handleAction,
        onHandledKey: () => {
            if (route.overlay === 'controls') touchControls();
        },
    });

    useEffect(() => {
        if (route.overlay !== 'login' || account.pendingSwitch) return;
        const completion = account.lastLoginCompletion;
        if (
            !completion
            || completion.outcome !== 'completed'
            || completion.sessionId === loginCompletionBaselineRef.current
        ) return;
        loginCompletionBaselineRef.current = completion.sessionId;
        setRoute(current => ({ ...current, overlay: null }));
        setLoginError(null);
    }, [account.lastLoginCompletion, account.pendingSwitch, route.overlay]);

    useEffect(() => {
        applyKeepScreenOn(route.page === 'player' || readStoredKeepScreenOn());
    }, [route.page]);

    useEffect(() => () => cancelPendingChromeReveal(), [cancelPendingChromeReveal]);

    const openAccount = useCallback(() => {
        setLoginError(null);
        loginCompletionBaselineRef.current = account.lastLoginCompletion?.sessionId ?? null;
        setRoute(current => ({ ...current, overlay: 'login' }));
    }, [account.lastLoginCompletion]);

    const openSearch = useCallback(() => {
        setRoute(current => (
            current.page === 'home' ? { ...current, overlay: 'search' } : current
        ));
    }, []);

    const openPlayer = useCallback(() => {
        setRoute(current => ({ ...current, page: 'player', overlay: null }));
    }, []);

    const openEffects = useCallback(() => {
        setRoute(current => (
            current.page === 'player' ? { ...current, overlay: 'effects' } : current
        ));
    }, []);

    const leaveInBackground = useCallback(() => {
        setRoute(current => (
            current.overlay === 'exit' ? { ...current, overlay: null } : current
        ));
        void nativePlayback.moveToBackground().then(moved => {
            if (moved) return;
            setRoute(current => (
                current.overlay ? current : { ...current, overlay: 'exit' }
            ));
        });
    }, [nativePlayback.moveToBackground]);

    const exitTvApp = useCallback(() => {
        void nativePlayback.exitApp();
    }, [nativePlayback.exitApp]);

    const activateHero = useCallback(() => {
        if (player.currentSong) {
            player.resumeCurrent();
            openPlayer();
            return;
        }
        if (library.localSongs.length > 0) {
            player.playQueue(library.localSongs, 0);
            openPlayer();
            return;
        }
        if (library.likedSongs.length > 0) {
            player.playQueue(library.likedSongs, 0);
            openPlayer();
            return;
        }
        if (!account.isAuthenticated) openAccount();
    }, [account.isAuthenticated, library.likedSongs, library.localSongs, openAccount, openPlayer, player]);

    const playTracks = useCallback((songs: SongResult[], startIndex: number) => {
        if (songs.length === 0) return;
        player.playQueue(songs, startIndex);
        setCollection(null);
        openPlayer();
    }, [openPlayer, player]);

    const openCollection = useCallback((nextCollection: ProviderCollection) => {
        setCollection(nextCollection);
        setRoute(current => ({ ...current, overlay: 'collection' }));
    }, []);

    return (
        <div
            className={`tv-app${route.page === 'player' ? ' is-player' : ''}${
                performanceProfile.tier === 'constrained' ? ' is-constrained' : ''
            }`}
            data-tv-performance-tier={performanceProfile.tier}
        >
            <audio
                ref={player.audioRef}
                className="tv-audio"
                preload="metadata"
                playsInline
                crossOrigin="anonymous"
            />
            {route.page === 'home' ? (
                <TvHome
                    account={account}
                    library={library}
                    player={player}
                    onActivateHero={activateHero}
                    onOpenAccount={openAccount}
                    onOpenSearch={openSearch}
                    onPlayTracks={playTracks}
                    onOpenCollection={openCollection}
                    inert={route.overlay !== null}
                />
            ) : (
                <TvPlayer
                    player={player}
                    controlsOpen={route.overlay === 'controls' || route.overlay === 'queue'}
                    constrained={performanceProfile.tier === 'constrained'}
                    onOpenQueue={() => setRoute(current => ({ ...current, overlay: 'queue' }))}
                    onOpenEffects={openEffects}
                    inert={route.overlay !== null && route.overlay !== 'controls'}
                />
            )}
            {route.overlay === 'queue' && (
                <TvQueueOverlay
                    queue={player.queue}
                    currentIndex={player.currentIndex}
                    onPlay={index => {
                        player.playQueue(player.queue, index);
                        setRoute(current => ({ ...current, overlay: 'controls' }));
                    }}
                />
            )}
            {route.overlay === 'effects' && (
                <TvEffectsOverlay
                    visualizerMode={player.visualizerMode}
                    backgroundMode={player.backgroundMode}
                    onVisualizerModeChange={player.setVisualizerMode}
                    onBackgroundModeChange={player.setBackgroundMode}
                />
            )}
            {route.overlay === 'collection' && collection && (
                <TvCollectionOverlay
                    collection={collection}
                    onPlayTracks={playTracks}
                />
            )}
            {route.overlay === 'search' && (
                <TvSearchOverlay
                    onPlayTracks={playTracks}
                />
            )}
            {route.overlay === 'login' && (
                <TvLoginOverlay
                    account={account}
                    startError={loginError}
                    onSwitchConfirmed={closeAccount}
                />
            )}
            {route.overlay === 'exit' && (
                <TvExitOverlay
                    isPlaying={player.status === 'playing'}
                    canBackground={nativePlayback.canBackground}
                    canExit={nativePlayback.canExit}
                    onBackground={leaveInBackground}
                    onExit={exitTvApp}
                />
            )}
        </div>
    );
};

