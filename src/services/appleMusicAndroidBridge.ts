import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AppleMusicBridgeResult, AppleMusicOperation, AppleMusicParams } from './onlineMusic/appleMusic/appleMusicTransport';

type AppleMusicPlugin = {
    request: (options: { operation: string; params?: Record<string, unknown> }) => Promise<AppleMusicBridgeResult>;
    showWindow: () => Promise<void>;
    hideWindow: () => Promise<void>;
};

const AppleMusic = registerPlugin<AppleMusicPlugin>('FoliaAppleMusic');

// src/services/appleMusicAndroidBridge.ts
// Android has no Electron preload: expose the same window.electron.appleMusicRequest shape the
// provider already calls, backed by the FoliaAppleMusic WebView companion.
export const installAppleMusicAndroidBridge = (): void => {
    if (Capacitor.getPlatform() !== 'android' || typeof window === 'undefined') return;
    const target = window as Window & { electron?: Record<string, unknown> };
    const bridge = (target.electron ?? {}) as Record<string, unknown>;
    if (typeof bridge.appleMusicRequest === 'function') return;
    bridge.platform = 'android';
    bridge.appleMusicRequest = async (operation: AppleMusicOperation, params: AppleMusicParams = {}): Promise<AppleMusicBridgeResult> => {
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
    target.electron = bridge as Window['electron'];
};
