// src/tv/input/tvKeys.ts
// Maps the several key names Android TV WebViews produce onto the remote actions the TV UI
// understands. Kept pure so the hardware-key assumptions can be tested without a device.

export type TvRemoteAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'menu';

type TvKeyboardLike = {
    key: string;
    code?: string;
    keyCode?: number;
    repeat?: boolean;
};

export const isTvSpaceKey = (event: TvKeyboardLike): boolean => (
    event.key === ' '
    || event.key === 'Spacebar'
    || event.code === 'Space'
);

export const resolveTvRemoteAction = (event: TvKeyboardLike): TvRemoteAction | null => {
    const key = event.key;
    const code = event.code ?? '';
    const keyCode = event.keyCode ?? 0;

    if (key === 'ArrowUp' || code === 'ArrowUp' || keyCode === 19) return 'up';
    if (key === 'ArrowDown' || code === 'ArrowDown' || keyCode === 20) return 'down';
    if (key === 'ArrowLeft' || code === 'ArrowLeft' || keyCode === 21) return 'left';
    if (key === 'ArrowRight' || code === 'ArrowRight' || keyCode === 22) return 'right';

    if (
        key === 'Enter'
        || key === 'NumpadEnter'
        || isTvSpaceKey(event)
        || key === 'Select'
        || key === 'DPAD_CENTER'
        || code === 'Enter'
        || code === 'NumpadEnter'
        || code === 'Select'
        || code === 'DPAD_CENTER'
        || keyCode === 13
        || keyCode === 23
        || keyCode === 66
    ) {
        return 'ok';
    }

    if (
        key === 'Escape'
        || key === 'BrowserBack'
        || key === 'GoBack'
        || key === 'Back'
        || code === 'Escape'
        || code === 'BrowserBack'
        || keyCode === 4
    ) {
        return 'back';
    }

    if (
        key === 'ContextMenu'
        || key === 'Menu'
        || code === 'ContextMenu'
        || keyCode === 82
    ) {
        return 'menu';
    }

    return null;
};

export const isTvDirection = (action: TvRemoteAction): action is 'up' | 'down' | 'left' | 'right' => (
    action === 'up' || action === 'down' || action === 'left' || action === 'right'
);
