import React from 'react';
import { IS_ANDROID_WEBVIEW } from '../../utils/platform';
import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import { PlayerState } from '../../types';
import { selectDisplayLyrics, usePlaybackStore } from '../../stores/usePlaybackStore';
import { addNativeStageControlListener, addNativeStageFallbackListener, disableNativeStage, enableNativeStage, getNativeStageStats, updateNativeStage, updateNativeStageAudio, updateNativeStageProgress, updateNativeStageWords } from '../../services/nativeStage';
import { setNativeStageStats } from '../../services/nativeStageDiagnostics';
import { runNativeStageControl } from '../../services/nativeStageActions';
import { getNativeStageTheme, subscribeNativeStageTheme } from '../../services/nativeStageTheme';
import { audioBands, audioPower, currentTime } from '../../stores/motionSignals';

// src/components/visualizer/NativeStageBridge.tsx
// 只做 opt-in 接线：开关打开时启用原生舞台并隐藏 WebView 视觉层；关闭时恢复原样。
// 原生 View 在 WebView 后面，现有控件/设置/模组全部继续由 WebView 绘制。

const STYLE_ID = 'folia-native-stage-style';

const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
html.folia-native-stage body,
html.folia-native-stage #root {
  background: transparent !important;
}
html.folia-native-stage [data-testid="player-visual-surface"] {
  opacity: 0 !important;
}
html.folia-native-stage [data-folia-player-controls] {
  display: none !important;
}
`;
    document.head.appendChild(style);
};

const NativeStageBridge: React.FC = () => {
    const enabled = useDesktopSettingsStore(state => state.nativeStageEnabled);
    const song = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    const lineIndex = usePlaybackStore(state => state.currentLineIndex);
    const playerState = usePlaybackStore(state => state.playerState);
    const duration = usePlaybackStore(state => state.duration);
    const nativeTheme = React.useSyncExternalStore(subscribeNativeStageTheme, getNativeStageTheme, getNativeStageTheme);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW) return undefined;
        if (!enabled) {
            document.documentElement.classList.remove('folia-native-stage');
            document.getElementById(STYLE_ID)?.remove();
            void disableNativeStage().catch(() => undefined);
            return undefined;
        }
        ensureStyle();
        document.documentElement.classList.add('folia-native-stage');
        void enableNativeStage().catch(error => {
            console.warn('[NativeStage] enable failed', error);
            document.documentElement.classList.remove('folia-native-stage');
            useDesktopSettingsStore.getState().handleToggleNativeStage(false);
        });
        return () => {
            document.documentElement.classList.remove('folia-native-stage');
            document.getElementById(STYLE_ID)?.remove();
            void disableNativeStage().catch(() => undefined);
        };
    }, [enabled]);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW || !enabled) return;
        const lines = lyrics?.lines ?? [];
        const line = lines[lineIndex]?.fullText || '';
        const nextLine = lines[lineIndex + 1]?.fullText || '';
        const title = song?.name || '';
        const artist = (song?.artists || []).map(artistItem => artistItem?.name).filter(Boolean).join(' / ');
        void updateNativeStage({
            line,
            nextLine,
            title,
            artist,
            accent: nativeTheme.accent,
            primary: nativeTheme.primary,
            secondary: nativeTheme.secondary,
            background: nativeTheme.background,
            playing: playerState === PlayerState.PLAYING,
        }).catch(error => console.warn('[NativeStage] update failed', error));
    }, [enabled, lineIndex, lyrics, nativeTheme, playerState, song]);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW || !enabled) return undefined;
        let removeFallback: (() => void) | undefined;
        void addNativeStageFallbackListener(() => {
            console.warn('[NativeStage] surface produced no frames, falling back to WebView');
            useDesktopSettingsStore.getState().handleToggleNativeStage(false);
        }).then(cleanup => { removeFallback = cleanup; });
        return () => removeFallback?.();
    }, [enabled]);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW || !enabled) return undefined;
        let remove: (() => void) | undefined;
        void addNativeStageControlListener((action, value) => runNativeStageControl(action, value)).then(cleanup => { remove = cleanup; });
        setNativeStageStats({ enabled: true });
        const timer = window.setInterval(() => {
            void getNativeStageStats().then(stats => setNativeStageStats({
                active: Boolean(stats?.active),
                renderer: String(stats?.renderer || 'none'),
                frames: Number(stats?.frames || 0),
            })).catch(() => undefined);
        }, 1000);
        return () => {
            window.clearInterval(timer);
            setNativeStageStats({ enabled: false, active: false, renderer: 'none' });
            remove?.();
        };
    }, [enabled]);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW || !enabled) return undefined;
        const timer = window.setInterval(() => {
            const position = currentTime.get();
            const active = lyrics?.lines?.[lineIndex];
            const span = active ? Math.max(0.001, active.endTime - active.startTime) : 0;
            const lineProgress = active ? Math.max(0, Math.min(1, (position - active.startTime) / span)) : 0;
            void updateNativeStageProgress({ position, duration, lineProgress }).catch(() => undefined);
            const words = (active?.words || []).map(word => ({
                text: word.text,
                startTime: word.startTime,
                endTime: word.endTime,
            }));
            void updateNativeStageWords({ words: JSON.stringify(words), position }).catch(() => undefined);
        }, 200);
        return () => window.clearInterval(timer);
    }, [duration, enabled, lineIndex, lyrics]);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW || !enabled || playerState !== PlayerState.PLAYING) return undefined;
        const timer = window.setInterval(() => {
            void updateNativeStageAudio({
                power: audioPower.get(),
                bass: audioBands.bass.get(),
                mid: audioBands.mid.get(),
                treble: audioBands.treble.get(),
            }).catch(() => undefined);
        }, 50);
        return () => window.clearInterval(timer);
    }, [enabled, playerState]);

    return null;
};

export default NativeStageBridge;
