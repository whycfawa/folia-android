export type NativeStageTheme = {
    accent: string;
    primary: string;
    secondary: string;
    background: string;
};

let theme: NativeStageTheme = {
    accent: '#7C9BFF',
    primary: '#FFFFFF',
    secondary: '#7C9BFF',
    background: '#07070B',
};
const listeners = new Set<() => void>();

export const getNativeStageTheme = (): NativeStageTheme => theme;

export const setNativeStageTheme = (next: Partial<NativeStageTheme>): void => {
    const merged = { ...theme, ...next };
    if (merged.accent === theme.accent && merged.primary === theme.primary
        && merged.secondary === theme.secondary && merged.background === theme.background) return;
    theme = merged;
    listeners.forEach(listener => listener());
};

export const subscribeNativeStageTheme = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
