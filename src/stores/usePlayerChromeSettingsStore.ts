// src/stores/usePlayerChromeSettingsStore.ts
// What the player page shows around the lyrics: the progress bar, the back and track-switch
// buttons, the titlebar, the transparent background and the auto-hide behaviour.
//
// Split out of useSettingsUiStore.

import { create } from 'zustand';
import i18n from '../i18n/config';
import {
    DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY,
    DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY,
    isPlayerControlSlotActionId,
    type PlayerControlSlotActionId,
} from '../types/playerControlSlots';
import {
    PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
    resolvePlayerBottomBarMaxOffset,
} from '../utils/playerBottomBarLayout';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';

const PLAYER_BOTTOM_BAR_OFFSET_STORAGE_KEY = 'player_bottom_bar_offset';
const PLAYER_CONTROL_SLOT_PRIMARY_STORAGE_KEY = 'player_control_slot_primary';
const PLAYER_CONTROL_SLOT_SECONDARY_STORAGE_KEY = 'player_control_slot_secondary';

/**
 * 安卓上的底部偏移量原来由一个自由滑块写入：在可滚动列表里被手指蹭一下就会把控制条抬到画面中间
 * 并立刻持久化，装新版本也不会自己恢复。滑块已从安卓端移除（改用「调整位置」流程），这里把历史
 * 遗留的大偏移复位一次；小幅抬高属于正常使用，不动它。
 */
const ANDROID_OFFSET_RESET_FLAG = 'folia_android_bottom_bar_offset_reset_v1';

const migrateLegacyAndroidBottomBarOffset = (offsetPx: number): number => {
    if (typeof window === 'undefined') return offsetPx;
    const isAndroid = (window as unknown as { Capacitor?: { getPlatform?: () => string } })
        .Capacitor?.getPlatform?.() === 'android';
    if (!isAndroid) return offsetPx;

    try {
        if (localStorage.getItem(ANDROID_OFFSET_RESET_FLAG) === '1') return offsetPx;
        localStorage.setItem(ANDROID_OFFSET_RESET_FLAG, '1');

        const max = resolvePlayerBottomBarMaxOffset(window.innerHeight);
        const quarterOfRange = PLAYER_BOTTOM_BAR_BASE_OFFSET_PX
            + (max - PLAYER_BOTTOM_BAR_BASE_OFFSET_PX) * 0.25;
        if (offsetPx < quarterOfRange) return offsetPx;

        localStorage.setItem(PLAYER_BOTTOM_BAR_OFFSET_STORAGE_KEY, String(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX));
        return PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    } catch {
        return offsetPx;
    }
};

/** Reads the persisted lower-bounded offset; the viewport-dependent upper bound is applied by consumers. */
const readStoredPlayerBottomBarOffset = (): number => {
    if (typeof window === 'undefined') {
        return PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    }

    const parsed = parseFloat(localStorage.getItem(PLAYER_BOTTOM_BAR_OFFSET_STORAGE_KEY) ?? '');
    if (!Number.isFinite(parsed)) {
        return PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    }

    return migrateLegacyAndroidBottomBarOffset(
        Math.max(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, Math.round(parsed)),
    );
};

const readStoredPlayerControlSlot = (
    key: string,
    fallback: PlayerControlSlotActionId,
): PlayerControlSlotActionId => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    const saved = localStorage.getItem(key);
    return isPlayerControlSlotActionId(saved) ? saved : fallback;
};

export type PlayerChromeSettingsState = {
    hidePlayerProgressBar: boolean;
    playerBottomBarOffset: number;
    playerControlSlotPrimary: PlayerControlSlotActionId;
    playerControlSlotSecondary: PlayerControlSlotActionId;
    hidePlayerRightPanelButton: boolean;
    alwaysShowPlayerBackButton: boolean;
    alwaysShowTrackSwitchButtons: boolean;
    alwaysShowMainWindowTitlebar: boolean;
    /** A frosted bar behind the window titlebar on the player page, so its buttons read over any picture. */
    playerHeaderBlur: boolean;
    hideFullscreenButton: boolean;
    useNativeMacFullscreenButton: boolean;
    transparentPlayerBackground: boolean;
    enablePlayerPageNativeBlur: boolean;
    autoHidePlayerChrome: boolean;
    /** Android 沉浸模式：命令面板按钮的自动隐藏开关。 */
    autoHideCommandPaletteButton: boolean;
    autoHideCursorWithPlayerChrome: boolean;
    hideCursorWhenIdle: boolean;
    showOpenPanelCloseButton: boolean;
    setTransparentPlayerBackgroundFromSystem: (enabled: boolean) => void;
    handleTogglePlayerPageNativeBlur: (enable: boolean) => void;
    handleToggleHidePlayerProgressBar: (enable: boolean) => void;
    handleSetPlayerBottomBarOffset: (offsetPx: number) => void;
    handleSetPlayerControlSlot: (slot: 'primary' | 'secondary', actionId: PlayerControlSlotActionId) => void;
    handleToggleHidePlayerRightPanelButton: (enable: boolean) => void;
    handleToggleAlwaysShowPlayerBackButton: (enable: boolean) => void;
    handleToggleAlwaysShowTrackSwitchButtons: (enable: boolean) => void;
    handleToggleAlwaysShowMainWindowTitlebar: (enable: boolean) => void;
    handleTogglePlayerHeaderBlur: (enable: boolean) => void;
    handleToggleHideFullscreenButton: (enable: boolean) => void;
    handleToggleNativeMacFullscreenButton: (enable: boolean) => void;
    handleToggleTransparentPlayerBackground: (enable: boolean) => void;
    handleWallpaperTransparentRefused: () => void;
    handleToggleAutoHidePlayerChrome: (enable: boolean) => void;
    handleToggleAutoHideCommandPaletteButton: (enable: boolean) => void;
    handleToggleAutoHideCursorWithPlayerChrome: (enable: boolean) => void;
    handleToggleHideCursorWhenIdle: (enable: boolean) => void;
    handleToggleOpenPanelCloseButton: (enable: boolean) => void;
};

export const usePlayerChromeSettingsStore = create<PlayerChromeSettingsState>((set, get) => ({
    hidePlayerProgressBar: getStoredBoolean('hide_player_progress_bar', false),
    playerBottomBarOffset: readStoredPlayerBottomBarOffset(),
    playerControlSlotPrimary: readStoredPlayerControlSlot(
        PLAYER_CONTROL_SLOT_PRIMARY_STORAGE_KEY,
        DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY,
    ),
    playerControlSlotSecondary: readStoredPlayerControlSlot(
        PLAYER_CONTROL_SLOT_SECONDARY_STORAGE_KEY,
        DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY,
    ),
    hidePlayerRightPanelButton: getStoredBoolean('hide_player_right_panel_button', false),
    alwaysShowPlayerBackButton: getStoredBoolean('always_show_player_back_button', false),
    alwaysShowTrackSwitchButtons: getStoredBoolean('always_show_track_switch_buttons', false),
    alwaysShowMainWindowTitlebar: getStoredBoolean('always_show_main_window_titlebar', false),
    playerHeaderBlur: getStoredBoolean('player_header_blur', false),
    hideFullscreenButton: getStoredBoolean('hide_fullscreen_button', false),
    useNativeMacFullscreenButton: getStoredBoolean('use_native_mac_fullscreen_button', false),
    transparentPlayerBackground: getStoredBoolean('transparent_player_background', false),
    enablePlayerPageNativeBlur: getStoredBoolean('enable_player_page_native_blur', false),
    autoHidePlayerChrome: getStoredBoolean('auto_hide_player_chrome', false),
    autoHideCommandPaletteButton: getStoredBoolean('auto_hide_command_palette_button', false),
    // Rides the chrome auto-hide clock rather than owning one: the cursor goes away with the
    // controls it would have clicked. Opt-out, so auto-hide can keep the pointer if wanted.
    autoHideCursorWithPlayerChrome: getStoredBoolean('auto_hide_cursor_with_player_chrome', true),
    hideCursorWhenIdle: getStoredBoolean('hide_cursor_when_idle', false),
    showOpenPanelCloseButton: getStoredBoolean('show_open_panel_close_button', true),
    setTransparentPlayerBackgroundFromSystem: (enabled) => {
        setStoredBoolean('transparent_player_background', enabled);
        set({ transparentPlayerBackground: enabled });
    },
    handleTogglePlayerPageNativeBlur: (enable) => {
        setStoredBoolean('enable_player_page_native_blur', enable);
        set({ enablePlayerPageNativeBlur: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('enable_player_page_native_blur', enable);
        }
    },
    handleToggleAutoHidePlayerChrome: (enabled: boolean) => {
        localStorage.setItem('auto_hide_player_chrome', enabled ? 'true' : 'false');
        set({ autoHidePlayerChrome: enabled });
    },
    handleToggleAutoHideCommandPaletteButton: (enabled: boolean) => {
        localStorage.setItem('auto_hide_command_palette_button', enabled ? 'true' : 'false');
        set({ autoHideCommandPaletteButton: enabled });
    },
    handleToggleAutoHideCursorWithPlayerChrome: (enable) => {
        setStoredBoolean('auto_hide_cursor_with_player_chrome', enable);
        set({ autoHideCursorWithPlayerChrome: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'cursorAutoHideOn' : 'cursorAutoHideOff')),
        });
    },
    handleToggleHideCursorWhenIdle: (enable) => {
        setStoredBoolean('hide_cursor_when_idle', enable);
        set({ hideCursorWhenIdle: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'cursorIdleHideOn' : 'cursorIdleHideOff')),
        });
    },
    handleToggleHidePlayerProgressBar: (enable) => {
        setStoredBoolean('hide_player_progress_bar', enable);
        set({ hidePlayerProgressBar: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'progressBarHidden' : 'progressBarShown')),
        });
    },
    handleSetPlayerBottomBarOffset: (offsetPx) => {
        const next = Number.isFinite(offsetPx)
            ? Math.max(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, Math.round(offsetPx))
            : PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
        if (typeof window !== 'undefined') {
            localStorage.setItem(PLAYER_BOTTOM_BAR_OFFSET_STORAGE_KEY, String(next));
        }
        set({ playerBottomBarOffset: next });
    },
    handleSetPlayerControlSlot: (slot, actionId) => {
        if (!isPlayerControlSlotActionId(actionId)) {
            return;
        }
        const key = slot === 'primary'
            ? PLAYER_CONTROL_SLOT_PRIMARY_STORAGE_KEY
            : PLAYER_CONTROL_SLOT_SECONDARY_STORAGE_KEY;
        if (typeof window !== 'undefined') {
            localStorage.setItem(key, actionId);
        }
        set(slot === 'primary'
            ? { playerControlSlotPrimary: actionId }
            : { playerControlSlotSecondary: actionId });
    },
    handleToggleAlwaysShowPlayerBackButton: (enable) => {
        setStoredBoolean('always_show_player_back_button', enable);
        set({ alwaysShowPlayerBackButton: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'playerBackButtonAlwaysShown' : 'playerBackButtonAutoHidden')),
        });
    },
    handleToggleAlwaysShowTrackSwitchButtons: (enable) => {
        setStoredBoolean('always_show_track_switch_buttons', enable);
        set({ alwaysShowTrackSwitchButtons: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'trackSwitchButtonsAlwaysShown' : 'trackSwitchButtonsAutoHidden')),
        });
    },
    handleToggleAlwaysShowMainWindowTitlebar: (enable) => {
        setStoredBoolean('always_show_main_window_titlebar', enable);
        set({ alwaysShowMainWindowTitlebar: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'mainWindowTitlebarAlwaysShown' : 'mainWindowTitlebarAutoHidden')),
        });
    },
    handleTogglePlayerHeaderBlur: (enable) => {
        setStoredBoolean('player_header_blur', enable);
        set({ playerHeaderBlur: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'playerHeaderBlurOn' : 'playerHeaderBlurOff')),
        });
    },
    handleToggleHideFullscreenButton: (enable) => {
        setStoredBoolean('hide_fullscreen_button', enable);
        set({ hideFullscreenButton: enable });
    },
    handleToggleNativeMacFullscreenButton: (enable) => {
        setStoredBoolean('use_native_mac_fullscreen_button', enable);
        set({ useNativeMacFullscreenButton: enable });
    },
    handleToggleHidePlayerRightPanelButton: (enable) => {
        setStoredBoolean('hide_player_right_panel_button', enable);
        set({ hidePlayerRightPanelButton: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'rightBtnHidden' : 'rightBtnShown')),
        });
    },
    handleToggleTransparentPlayerBackground: (enable) => {
        setStoredBoolean('transparent_player_background', enable);
        set({ transparentPlayerBackground: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'transparentBgOn' : 'transparentBgOff')),
        });
    },
    // Main-process guard fired the refusal (classic Windows wallpaper mode cannot present a
    // transparent wallpaper window): surface why the toggle did not take effect.
    handleWallpaperTransparentRefused: () => {
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.transparentBgWallpaperUnsupported'),
        });
    },
    handleToggleOpenPanelCloseButton: (enable) => {
        setStoredBoolean('show_open_panel_close_button', enable);
        set({ showOpenPanelCloseButton: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'panelCloseBtnShown' : 'panelCloseBtnHidden')),
        });
    },
}));

/**
 * The PlayerChromeSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectPlayerChromeSettingsSnapshot = (state: PlayerChromeSettingsState) => ({
    hidePlayerProgressBar: state.hidePlayerProgressBar,
    playerBottomBarOffset: state.playerBottomBarOffset,
    playerControlSlotPrimary: state.playerControlSlotPrimary,
    playerControlSlotSecondary: state.playerControlSlotSecondary,
    hidePlayerRightPanelButton: state.hidePlayerRightPanelButton,
    alwaysShowPlayerBackButton: state.alwaysShowPlayerBackButton,
    alwaysShowTrackSwitchButtons: state.alwaysShowTrackSwitchButtons,
    alwaysShowMainWindowTitlebar: state.alwaysShowMainWindowTitlebar,
    playerHeaderBlur: state.playerHeaderBlur,
    hideFullscreenButton: state.hideFullscreenButton,
    useNativeMacFullscreenButton: state.useNativeMacFullscreenButton,
    transparentPlayerBackground: state.transparentPlayerBackground,
    enablePlayerPageNativeBlur: state.enablePlayerPageNativeBlur,
    autoHidePlayerChrome: state.autoHidePlayerChrome,
    autoHideCommandPaletteButton: state.autoHideCommandPaletteButton,
    autoHideCursorWithPlayerChrome: state.autoHideCursorWithPlayerChrome,
    hideCursorWhenIdle: state.hideCursorWhenIdle,
    showOpenPanelCloseButton: state.showOpenPanelCloseButton,
    handleToggleHidePlayerProgressBar: state.handleToggleHidePlayerProgressBar,
    handleSetPlayerBottomBarOffset: state.handleSetPlayerBottomBarOffset,
    handleSetPlayerControlSlot: state.handleSetPlayerControlSlot,
    handleToggleHidePlayerRightPanelButton: state.handleToggleHidePlayerRightPanelButton,
    handleToggleAlwaysShowPlayerBackButton: state.handleToggleAlwaysShowPlayerBackButton,
    handleToggleAlwaysShowTrackSwitchButtons: state.handleToggleAlwaysShowTrackSwitchButtons,
    handleToggleAlwaysShowMainWindowTitlebar: state.handleToggleAlwaysShowMainWindowTitlebar,
    handleTogglePlayerHeaderBlur: state.handleTogglePlayerHeaderBlur,
    handleToggleHideFullscreenButton: state.handleToggleHideFullscreenButton,
    handleToggleNativeMacFullscreenButton: state.handleToggleNativeMacFullscreenButton,
    handleToggleTransparentPlayerBackground: state.handleToggleTransparentPlayerBackground,
    setTransparentPlayerBackgroundFromSystem: state.setTransparentPlayerBackgroundFromSystem,
    handleTogglePlayerPageNativeBlur: state.handleTogglePlayerPageNativeBlur,
    handleToggleAutoHidePlayerChrome: state.handleToggleAutoHidePlayerChrome,
    handleToggleAutoHideCommandPaletteButton: state.handleToggleAutoHideCommandPaletteButton,
    handleToggleAutoHideCursorWithPlayerChrome: state.handleToggleAutoHideCursorWithPlayerChrome,
    handleToggleHideCursorWhenIdle: state.handleToggleHideCursorWhenIdle,
    handleToggleOpenPanelCloseButton: state.handleToggleOpenPanelCloseButton,
    handleWallpaperTransparentRefused: state.handleWallpaperTransparentRefused,
});
