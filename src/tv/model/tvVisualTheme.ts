import { DEFAULT_LUMIERE_TUNING, type LumiereTuning, type Theme } from '../../types';

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

// Low-tier projectors cannot sustain the desktop bloom pyramid at their native pixel ratio.
const TV_LUMIERE_CONSTRAINED: LumiereTuning = {
    ...DEFAULT_LUMIERE_TUNING,
    renderQuality: 'low',
    bloom: 0,
    textBloom: 0,
    frontBokeh: false,
    moteAmount: 0,
    echo: 0,
    fogOctaves: 2,
    lineArt: false,
    themeIcons: false,
    windowNeighbors: 1,
    hideTrails: true,
};
const TV_LUMIERE_BALANCED: LumiereTuning = {
    ...DEFAULT_LUMIERE_TUNING,
    renderQuality: 'balanced',
};

export const resolveTvLumiereTuning = (constrained: boolean): LumiereTuning => (
    constrained ? TV_LUMIERE_CONSTRAINED : TV_LUMIERE_BALANCED
);
