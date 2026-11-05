// src/tv/TvApp.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyKeepScreenOn, readStoredKeepScreenOn } from '../services/androidKeepScreenOn';
import { useNativeBackButton } from '../hooks/useNativeBackButton';
import type { SongResult } from '../types';
import type { ProviderCollection } from '../types/onlineMusic';
import { TvCollectionOverlay } from './components/TvCollectionOverlay';
import { TvExitOverlay } from './components/TvExitOverlay';
import { TvLoginOverlay } from './components/TvLoginOverlay';
import { TvQueueOverlay } from './components/TvQueueOverlay';
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
import { resolveTvBackRoute, resolveTvLayer, TV_HOME_ROUTE, type TvRoute } from './model/tvRoute';
import { TvHome } from './pages/TvHome';
import { TvPlayer } from './pages/TvPlayer';

const RESET_FOCUS_MEMORY_LAYERS = ['exit', 'login'] as const;

export const TvApp = () => {
    const player = useTvPlayer();
    const nativePlayback = useTvNativePlayback(player);
    const performanceProfile = useTvPerformanceProfile();
    const account = useTvAccount({ onProviderSwitch: player.pause });
    const library = useTvLibrary(account);
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

    const closeControls = useCallback(() => {
        setRoute(current => (
            current.overlay === 'controls' ? { ...current, overlay: null } : current
        ));
    }, []);

    const hideControls = useCallback(() => closeControls(), [closeControls]);
    const touchControls = useTvControlsAutoHide({
        active: route.page === 'player' && route.overlay === 'controls',
        onHide: hideControls,
    });
    const defaultFocus = useMemo(() => ({
        home: 'home-hero',
        controls: 'controls-play',
        queue: player.currentIndex >= 0 ? 'queue-current' : 'queue-0',
        collection: 'collection-play-all',
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
                            : 'login-close'
                    : `login-provider-${account.activeProviderId}`,
    }), [
        account.activeProviderId,
        account.login,
        account.pendingSwitch,
        player.currentIndex,
    ]);
    const { moveFocus } = useTvFocus(
        activeLayer,
        `${route.page}:${route.overlay}:${collection?.id ?? ''}:${player.currentIndex}`,
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

    const handleAction = useCallback((action: TvRemoteAction): boolean => {
        if (action === 'back') return goBack();

        if (route.page === 'player' && !route.overlay) {
            if (action === 'ok') {
                player.togglePlayback();
                return true;
            }
            if (action === 'left' || action === 'right') {
                player.seekBy(action === 'left' ? -10 : 10);
                return true;
            }
            if (action === 'up' || action === 'down') {
                setRoute(current => ({ ...current, overlay: 'controls' }));
                return true;
            }
        }

        if (action === 'ok') return clickFocusedTvElement();
        if (isTvDirection(action)) return moveFocus(action);
        return false;
    }, [goBack, player, route, moveFocus]);

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

    const openAccount = useCallback(() => {
        setLoginError(null);
        loginCompletionBaselineRef.current = account.lastLoginCompletion?.sessionId ?? null;
        setRoute(current => ({ ...current, overlay: 'login' }));
    }, [account.lastLoginCompletion]);

    const openPlayer = useCallback(() => {
        setRoute(current => ({ ...current, page: 'player', overlay: null }));
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
            <audio ref={player.audioRef} className="tv-audio" preload="metadata" playsInline />
            {route.page === 'home' ? (
                <TvHome
                    account={account}
                    library={library}
                    player={player}
                    onActivateHero={activateHero}
                    onOpenAccount={openAccount}
                    onOpenPlayer={openPlayer}
                    onPlayTracks={playTracks}
                    onOpenCollection={openCollection}
                />
            ) : (
                <TvPlayer
                    player={player}
                    controlsOpen={route.overlay === 'controls'}
                    constrained={performanceProfile.tier === 'constrained'}
                    onOpenQueue={() => setRoute(current => ({ ...current, overlay: 'queue' }))}
                    onCloseControls={closeControls}
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
                    onClose={() => {
                        setRoute(current => (
                            current.overlay === 'queue' ? { ...current, overlay: 'controls' } : current
                        ));
                    }}
                />
            )}
            {route.overlay === 'collection' && collection && (
                <TvCollectionOverlay
                    collection={collection}
                    onPlayTracks={playTracks}
                    onClose={() => {
                        setCollection(null);
                        setRoute(current => ({ ...current, overlay: null }));
                    }}
                />
            )}
            {route.overlay === 'login' && (
                <TvLoginOverlay
                    account={account}
                    startError={loginError}
                    onClose={closeAccount}
                    onSwitchConfirmed={closeAccount}
                />
            )}
            {route.overlay === 'exit' && (
                <TvExitOverlay
                    songName={player.currentSong?.name ?? null}
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

