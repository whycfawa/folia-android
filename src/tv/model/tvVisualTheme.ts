import type { Theme } from '../../types';

// src/tv/model/tvVisualTheme.ts
// TV keeps one projector-safe dark theme; constrained devices only lower the shared motion budget.
const TV_VISUAL_THEME: Theme = {
    name: 'Music TV Midnight',
    backgroundColor: '#07070c',
    primaryColor: '#f7f5ff',
    accentColor: '#a78bfa',
    secondaryColor: '#b8b0d0',
    fontStyle: 'sans',
    fontWeight: 600,
    animationIntensity: 'normal',
};

const TV_VISUAL_THEME_CONSTRAINED: Theme = {
    ...TV_VISUAL_THEME,
    name: 'Music TV Midnight Constrained',
    animationIntensity: 'calm',
};

export const resolveTvVisualTheme = (constrained: boolean): Theme => (
    constrained ? TV_VISUAL_THEME_CONSTRAINED : TV_VISUAL_THEME
);
