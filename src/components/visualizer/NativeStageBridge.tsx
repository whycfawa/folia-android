import React from 'react';
import { IS_ANDROID_WEBVIEW } from '../../utils/platform';
import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { PlayerState } from '../../types';
import { selectDisplayLyrics, usePlaybackStore } from '../../stores/usePlaybackStore';
import { addNativeStageControlListener, addNativeStageFallbackListener, disableNativeStage, enableNativeStage, getNativeStageStats, updateNativeStage, updateNativeStageAudio, updateNativeStageProgress, updateNativeStageWords } from '../../services/nativeStage';
import { setNativeStageStats } from '../../services/nativeStageDiagnostics';
import { runNativeStageControl } from '../../services/nativeStageActions';
import { getNativeStageTheme, subscribeNativeStageTheme } from '../../services/nativeStageTheme';
import { audioBands, audioPower, currentTime } from '../../stores/motionSignals';
import { buildWordGraphemeTimings } from '../../utils/lyrics/graphemeTiming';

// src/components/visualizer/NativeStageBridge.tsx
// 只做 opt-in 接线：开关打开时启用原生舞台并隐藏 WebView 视觉层；关闭时恢复原样。
// 原生 View 在 WebView 后面，现有控件/设置/模组全部继续由 WebView 绘制。

const STYLE_ID = 'folia-native-stage-style';

const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
html.folia-native-stage,
html.folia-native-stage body,
html.folia-native-stage #root,
html.folia-native-stage [data-folia-app-shell="true"] {
  background: transparent !important;
}
html.folia-native-stage [data-testid="player-visual-surface"] {
  opacity: 0 !important;
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
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
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
        let cancelled = false;
        void enableNativeStage().then(() => {
            if (!cancelled) document.documentElement.classList.add('folia-native-stage');
        }).catch(error => {
            console.warn('[NativeStage] enable failed', error);
            document.documentElement.classList.remove('folia-native-stage');
            useDesktopSettingsStore.getState().handleToggleNativeStage(false);
        });
        return () => {
            cancelled = true;
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
        const prevLine = lines[lineIndex - 1]?.fullText || '';
        const lineTranslation = lines[lineIndex]?.translation || '';
        const prevTranslation = lines[lineIndex - 1]?.translation || '';
        const nextTranslation = lines[lineIndex + 1]?.translation || '';
        const title = song?.name || '';
        const artist = (song?.artists || []).map(artistItem => artistItem?.name).filter(Boolean).join(' / ');
        void updateNativeStage({
            mode: visualizerMode,
            line,
            nextLine,
            prevLine,
            lineTranslation,
            prevTranslation,
            nextTranslation,
            title,
            artist,
            accent: nativeTheme.accent,
            primary: nativeTheme.primary,
            secondary: nativeTheme.secondary,
            background: nativeTheme.background,
            daylight: isDaylight,
            playing: playerState === PlayerState.PLAYING,
            chorus: Boolean(lines[lineIndex]?.isChorus),
        }).catch(error => console.warn('[NativeStage] update failed', error));
    }, [enabled, isDaylight, lineIndex, lyrics, nativeTheme, playerState, song, visualizerMode]);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW || !enabled) return undefined;
        let removeFallback: (() => void) | undefined;
        void addNativeStageFallbackListener(() => {
            console.warn('[NativeStage] surface produced no frames, falling back to WebView');
            document.documentElement.classList.remove('folia-native-stage');
            document.getElementById(STYLE_ID)?.remove();
            useDesktopSettingsStore.getState().handleToggleNativeStage(false);
        }).then(cleanup => { removeFallback = cleanup; });
        return () => removeFallback?.();
    }, [enabled]);

    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW || !enabled) return undefined;
        let remove: (() => void) | undefined;
        void addNativeStageControlListener((action, value) => runNativeStageControl(action, value)).then(cleanup => { remove = cleanup; });
        setNativeStageStats({ enabled: true });
        const enabledAt = Date.now();
        const timer = window.setInterval(() => {
            void getNativeStageStats().then(stats => {
                const active = Boolean(stats?.active);
                setNativeStageStats({
                    active,
                    renderer: String(stats?.renderer || 'none'),
                    frames: Number(stats?.frames || 0),
                    surface: Boolean(stats?.surface),
                    playing: Boolean(stats?.playing),
                    vulkan: Boolean(stats?.vulkan),
                    canvasMs: Number(stats?.canvasMs || 0),
                    vulkanError: String(stats?.vulkanError || ''),
                    pipeline: Boolean(stats?.pipeline),
                });
                if (!active && Date.now() - enabledAt > 3500) {
                    console.warn('[NativeStage] plugin inactive, restoring WebView');
                    document.documentElement.classList.remove('folia-native-stage');
                    document.getElementById(STYLE_ID)?.remove();
                    useDesktopSettingsStore.getState().handleToggleNativeStage(false);
                }
            }).catch(() => undefined);
        }, 1000);
        return () => {
            window.clearInterval(timer);
            setNativeStageStats({ enabled: false, active: false, renderer: 'none', surface: false, playing: false, vulkan: false, canvasMs: 0, vulkanError: '', pipeline: false });
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
                chars: buildWordGraphemeTimings(word),
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
