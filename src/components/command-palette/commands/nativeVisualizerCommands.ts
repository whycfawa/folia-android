import { Cpu } from 'lucide-react';
import { createToggleCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';
import { IS_ANDROID_WEBVIEW } from '../../../utils/platform';
import { isNativeVisualizerEnabled, setNativeVisualizerEnabled } from '../../../services/nativeVisualizer';

// src/components/command-palette/commands/nativeVisualizerCommands.ts
// 原生渲染层的开关（试验）：把播放页的整屏背景 + 频谱条交给 Android GL 画，其余仍是 WebView。
// 只在安卓壳里出现；开关状态存 localStorage，下次启动由 bootstrap 重新拉起。

export const nativeVisualizerCommands: CommandPaletteCommand[] = [
    createToggleCommand(
        'toggle-native-visualizer',
        'visualizer',
        '原生渲染层（实验）',
        '用 Android GL 画播放页背景与频谱条，替代 WebView 里的可视化器画布',
        ['native', 'gl', 'surface', '原生渲染', '原生可视化', '性能'],
        () => {
            void setNativeVisualizerEnabled(!isNativeVisualizerEnabled());
        },
        { icon: Cpu, isAvailable: () => IS_ANDROID_WEBVIEW },
    ),
];
