let accent = '#7C9BFF';
const listeners = new Set<() => void>();

export const getNativeStageAccent = (): string => accent;

export const setNativeStageAccent = (next: string): void => {
    if (!next || next === accent) return;
    accent = next;
    listeners.forEach(listener => listener());
};

export const subscribeNativeStageAccent = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
