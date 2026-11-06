import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AppleMusicBridgeResult, AppleMusicOperation, AppleMusicParams } from './onlineMusic/appleMusic/appleMusicTransport';

type AppleMusicPlugin = {
    request: (options: { operation: string; params?: Record<string, unknown> }) => Promise<AppleMusicBridgeResult>;
    showWindow: (options?: { manual?: boolean }) => Promise<void>;
    hideWindow: () => Promise<void>;
};

const AppleMusic = registerPlugin<AppleMusicPlugin>('FoliaAppleMusic');

// src/services/appleMusicAndroidBridge.ts
// Android has no Electron preload: expose the same window.electron.appleMusicRequest shape the
// provider already calls, backed by the FoliaAppleMusic WebView companion.
export const installAppleMusicAndroidBridge = (): void => {
    if (Capacitor.getPlatform() !== 'android' || typeof window === 'undefined') return;
    const target = window as Window & { foliaAppleMusicRequest?: (operation: AppleMusicOperation, params?: AppleMusicParams) => Promise<AppleMusicBridgeResult> };
    if (typeof target.foliaAppleMusicRequest === 'function') return;
    target.foliaAppleMusicRequest = async (operation: AppleMusicOperation, params: AppleMusicParams = {}): Promise<AppleMusicBridgeResult> => {
        try {
            if (operation === 'showWindow') {
                await AppleMusic.showWindow();
                return { ok: true, data: null };
            }
            if (operation === 'hideWindow') {
                await AppleMusic.hideWindow();
                return { ok: true, data: null };
            }
            return await AppleMusic.request({ operation, params: params as Record<string, unknown> });
        } catch (error) {
            console.warn('[AppleMusic] Android companion request failed', error);
            return { ok: false, error: 'request-failed' };
        }
    };
};

/**
 * Opens Apple's own page full screen, on a page the listener can use, and leaves it open: the same
 * WebView the app plays through, so a song that sounds here and not under the app's controls is a
 * problem in our wiring, and a song that does not sound here either is the page's own.
 * A close button floats over it; nothing inside the login flow hides this window.
 */
export const openAppleMusicPlayerWindow = async (): Promise<boolean> => {
    if (Capacitor.getPlatform() !== 'android' || typeof window === 'undefined') return false;
    try {
        await AppleMusic.showWindow({ manual: true });
        return true;
    } catch (error) {
        console.warn('[AppleMusic] could not open the player window', error);
        return false;
    }
};
