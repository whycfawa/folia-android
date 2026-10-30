import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAndroidLayoutSettingsStore } from '../../../../stores/useAndroidLayoutSettingsStore';
import { IS_ANDROID_WEBVIEW } from '../../../../utils/platform';
import type { AppLanguagePreference } from '../../../../i18n/config';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { selectPonderSettingsSnapshot, usePonderStore } from '../../../../stores/usePonderStore';
import { useSettingsModalStore } from '../../../../stores/useSettingsModalStore';
import { Button, Group, Reveal, Row, Segmented, Select, Toggle, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { FoundUpdateRow } from './FoundUpdateRow';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/GeneralPage.tsx
// The 通用 page: the interface language, what the app does when it starts and how its window
// buttons show, the desktop app's update check (with the new version, once one is found), and the
// hints of the Ponder tutorials.

const LANGUAGE: SettingsGroupDef = { id: 'languageSettings', titleKey: 'options.languageSettings' };
const LAUNCH: SettingsGroupDef = { id: 'labWindowAndTools', titleKey: 'options.settingsHeadingLaunch' };
const UPDATE: SettingsGroupDef = { id: 'updateCheck', titleKey: 'options.updateCheck', electronOnly: true };
const PONDER: SettingsGroupDef = { id: 'ponderHints', titleKey: 'options.ponderHints' };
// Android 外壳：只有 Capacitor WebView 里这些开关才有意义（桌面上整组不渲染）。
const ANDROID_SHELL: SettingsGroupDef = { id: 'androidShell', titleKey: 'options.settingsHeadingAndroid' };

const O = {
    language: option(LANGUAGE, 'appLanguage', 'options.appLanguage'),
    autoPlay: option(LAUNCH, 'autoPlayOnLaunch', 'options.autoPlayOnLaunch'),
    openPlayer: option(LAUNCH, 'openPlayerOnLaunch', 'options.openPlayerOnLaunch', { electronOnly: true }),
    titlebarButtons: option(LAUNCH, 'alwaysShowMainWindowTitlebar', 'options.alwaysShowMainWindowTitlebar'),
    updateCheck: option(UPDATE, 'enableUpdateCheck', 'options.enableUpdateCheck'),
    autoUpdate: option(UPDATE, 'enableAutoUpdate', 'options.enableAutoUpdate'),
    updateChannel: option(UPDATE, 'updateChannel', 'options.updateChannel'),
    ponderHints: option(PONDER, 'ponderHintVisibility', 'options.ponderHints'),
    ponderTouchButton: option(PONDER, 'ponderTouchButton', 'options.ponderTouchButton'),
    androidAdaptiveDisplay: option(ANDROID_SHELL, 'adaptiveDisplay', 'options.adaptiveDisplay'),
    androidKeepScreenOn: option(ANDROID_SHELL, 'keepScreenOn', 'options.keepScreenOn'),
    androidPhoneFit: option(ANDROID_SHELL, 'phoneFit', 'options.phoneFit'),
    androidOrientation: option(ANDROID_SHELL, 'orientationFit', 'options.orientationFit'),
    androidCommandPaletteAutoHide: option(ANDROID_SHELL, 'autoHideCommandPaletteButton', 'options.autoHideCommandPaletteButton'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const GeneralPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { isElectron, viewProps } = useSettingsPage();
    const { openPlayerOnLaunch, onToggleOpenPlayerOnLaunch } = viewProps.desktop.preferences;
    const update = viewProps.desktop.model;
    const { electronSettings, updateStatus } = update;
    // Android 移植：这几个设置只有原生壳里有效，桌面上组件自己返回 null。
    // Android 外壳的设置：store 里的三个开关 + 原生「自适应分辨率」（插件状态）。

    const keepScreenOnEnabled = useAndroidLayoutSettingsStore(state => state.keepScreenOnEnabled);
    const setKeepScreenOnEnabled = useAndroidLayoutSettingsStore(state => state.setKeepScreenOnEnabled);
    const phoneFitEnabled = useAndroidLayoutSettingsStore(state => state.phoneFitEnabled);
    const setPhoneFitEnabled = useAndroidLayoutSettingsStore(state => state.setPhoneFitEnabled);
    const phoneFitOrientation = useAndroidLayoutSettingsStore(state => state.phoneFitOrientation);
    const setPhoneFitOrientation = useAndroidLayoutSettingsStore(state => state.setPhoneFitOrientation);
    const autoHideCommandPaletteButton = usePlayerChromeSettingsStore(state => state.autoHideCommandPaletteButton);
    const handleToggleAutoHideCommandPaletteButton = usePlayerChromeSettingsStore(state => state.handleToggleAutoHideCommandPaletteButton);
    const [adaptiveDisplayEnabled, setAdaptiveDisplayEnabled] = React.useState(false);
    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW) return;
        const plugin = (window as unknown as { Capacitor?: { Plugins?: { FoliaNative?: {
            getAdaptiveLayout?: () => Promise<{ enabled?: boolean }>;
        } } } }).Capacitor?.Plugins?.FoliaNative;
        void plugin?.getAdaptiveLayout?.().then(result => setAdaptiveDisplayEnabled(Boolean(result?.enabled))).catch(() => undefined);
    }, []);
    const toggleAdaptiveDisplay = async (next: boolean) => {
        setAdaptiveDisplayEnabled(next);
        const plugin = (window as unknown as { Capacitor?: { Plugins?: { FoliaNative?: {
            setAdaptiveLayout?: (options: { enabled: boolean }) => Promise<unknown>;
        } } } }).Capacitor?.Plugins?.FoliaNative;
        try { await plugin?.setAdaptiveLayout?.({ enabled: next }); } catch (error) {
            console.warn('[Settings] adaptive-display:set-failed', error);
            setAdaptiveDisplayEnabled(!next);
        }
    };
    const languagePreference = useSettingsModalStore(state => state.appLanguagePreference);
    const setLanguagePreference = useSettingsModalStore(state => state.handleSetAppLanguagePreference);
    const autoPlay = useAudioSettingsStore(state => state.autoPlayOnLaunch);
    const setAutoPlay = useAudioSettingsStore(state => state.handleToggleAutoPlayOnLaunch);
    const titlebarButtons = usePlayerChromeSettingsStore(state => state.alwaysShowMainWindowTitlebar);
    const setTitlebarButtons = usePlayerChromeSettingsStore(state => state.handleToggleAlwaysShowMainWindowTitlebar);
    const ponder = usePonderStore(useShallow(selectPonderSettingsSnapshot));

    const resolvedLanguage = i18n.resolvedLanguage;
    const resolvedLanguageLabel = resolvedLanguage === 'zh-TW'
        ? t('options.appLanguageZhTW')
        : resolvedLanguage?.startsWith('zh')
            ? t('options.appLanguageZhCN')
            : resolvedLanguage === 'in' || resolvedLanguage?.startsWith('id')
                ? t('options.appLanguageInID')
                : resolvedLanguage === 'vi'
                    ? t('options.appLanguageViVN')
                    : t('options.appLanguageEnUS');

    const isInternalBuild = electronSettings.UPDATE_CHANNEL === 'internal';
    const autoUpdateSupported = Boolean(updateStatus?.autoUpdateSupported);

    return (
        <>
            <Group def={LANGUAGE} bare>
                <Row
                    option={O.language}
                    hint={languagePreference === 'system' ? t('options.appLanguageSystemHint', { language: resolvedLanguageLabel }) : undefined}
                >
                    <Select<AppLanguagePreference>
                        value={languagePreference}
                        options={[
                            { value: 'system', label: t('options.appLanguageSystem') },
                            { value: 'zh-CN', label: t('options.appLanguageZhCN') },
                            { value: 'zh-TW', label: t('options.appLanguageZhTW') },
                            { value: 'en', label: t('options.appLanguageEnUS') },
                            { value: 'in', label: t('options.appLanguageInID') },
                            { value: 'vi', label: t('options.appLanguageViVN') },
                        ]}
                        onChange={preference => void setLanguagePreference(preference)}
                    />
                </Row>
            </Group>

            <Group def={LAUNCH}>
                <Row option={O.autoPlay} hint={t('options.autoPlayOnLaunchDesc')} note={t('options.autoPlayOnLaunchDescSub')}>
                    <Toggle checked={autoPlay} onChange={setAutoPlay} />
                </Row>
                {isElectron && (
                    <Row option={O.openPlayer} note={t('options.openPlayerOnLaunchDesc')}>
                        <Toggle checked={openPlayerOnLaunch} onChange={onToggleOpenPlayerOnLaunch} />
                    </Row>
                )}
                <Row option={O.titlebarButtons} hint={t('options.alwaysShowMainWindowTitlebarDesc')}>
                    <Toggle checked={titlebarButtons} onChange={setTitlebarButtons} />
                </Row>
            </Group>

            {/* Android 外壳：与上游设置页同一套 Group/Row 控件，桌面上整组不渲染。 */}
            {IS_ANDROID_WEBVIEW && (
                <Group def={ANDROID_SHELL}>
                    <Row option={O.androidAdaptiveDisplay} hint={t('options.adaptiveDisplayDesc')}>
                        <Toggle checked={adaptiveDisplayEnabled} onChange={next => void toggleAdaptiveDisplay(next)} />
                    </Row>

                    <Row option={O.androidKeepScreenOn} hint={t('options.keepScreenOnDesc')}>
                        <Toggle checked={keepScreenOnEnabled} onChange={setKeepScreenOnEnabled} />
                    </Row>
                    <Row option={O.androidPhoneFit} hint={t('options.phoneFitDesc')}>
                        <Toggle checked={phoneFitEnabled} onChange={setPhoneFitEnabled} />
                    </Row>
                    <Row option={O.androidCommandPaletteAutoHide} hint={t('options.autoHideCommandPaletteButtonDesc')}>
                        <Toggle
                            checked={autoHideCommandPaletteButton}
                            onChange={handleToggleAutoHideCommandPaletteButton}
                        />
                    </Row>                    {phoneFitEnabled && (
                        <Row option={O.androidOrientation} hint={t('options.orientationFitDesc')}>
                            <Segmented
                                value={phoneFitOrientation}
                                options={[
                                    { value: 'portrait', label: t('options.orientationPortrait') },
                                    { value: 'landscape', label: t('options.orientationLandscape') },
                                ]}
                                onChange={setPhoneFitOrientation}
                            />
                        </Row>
                    )}
                </Group>
            )}
            {isElectron && (
                <Group
                    def={UPDATE}
                    // The state of the check; pressing it checks again.
                    action={(
                        <Button
                            variant="quiet"
                            icon={RefreshCw}
                            onClick={() => void update.onCheckForUpdates()}
                            disabled={!electronSettings.ENABLE_UPDATE_CHECK || !updateStatus?.updateCheckSupported || updateStatus?.status === 'checking'}
                        >
                            {update.updateBadgeLabel}
                        </Button>
                    )}
                    foot={t(autoUpdateSupported ? 'options.autoUpdateGithubNotice' : 'options.updateCheckGithubNotice')}
                >
                    <FoundUpdateRow />
                    <Row
                        option={O.updateCheck}
                        hint={t(updateStatus?.updateCheckSupportReason === 'channel' ? 'options.updateUnsupportedChannel' : 'options.enableUpdateCheckDesc')}
                        disabled={!updateStatus?.updateCheckSupported}
                    >
                        <Toggle checked={electronSettings.ENABLE_UPDATE_CHECK} onChange={() => void update.onToggleUpdateCheck()} />
                    </Row>
                    <Reveal when={electronSettings.ENABLE_UPDATE_CHECK}>
                        {/* Kept in view where the app cannot update itself: the reason is under the label. */}
                        <Row
                            sub
                            option={O.autoUpdate}
                            hint={t(autoUpdateSupported
                                ? 'options.enableAutoUpdateDesc'
                                : updateStatus?.autoUpdateSupportReason === 'system' ? 'options.updateUnsupportedSystem' : 'options.manualUpdateOnlyDesc')}
                            disabled={!update.canEnableAutoUpdate}
                        >
                            <Toggle checked={electronSettings.ENABLE_AUTO_UPDATE && autoUpdateSupported} onChange={() => void update.onToggleAutoUpdate()} />
                        </Row>
                    </Reveal>
                    <Row option={O.updateChannel} disabled={isInternalBuild}>
                        <Select
                            value={electronSettings.UPDATE_CHANNEL}
                            options={isInternalBuild
                                ? [{ value: 'internal', label: t('options.updateChannelInternal') }]
                                : [
                                    { value: 'realeco', label: t('options.updateChannelRealeco') },
                                    { value: 'limo', label: t('options.updateChannelLimo') },
                                    { value: 'cielo', label: t('options.updateChannelCielo') },
                                ]}
                            onChange={channel => void update.onUpdateChannelChange(channel as 'realeco' | 'limo' | 'cielo')}
                        />
                    </Row>
                </Group>
            )}

            <Group def={PONDER}>
                <Row option={O.ponderHints} hint={t('options.ponderHintsDesc')}>
                    <Segmented
                        value={ponder.ponderHintVisibility}
                        options={[
                            { value: 'always', label: t('options.ponderHintsAlways') },
                            { value: 'unseen', label: t('options.ponderHintsUnseen') },
                            { value: 'off', label: t('options.ponderHintsOff') },
                        ]}
                        onChange={ponder.setPonderHintVisibility}
                    />
                </Row>
                <Row option={O.ponderTouchButton} hint={t('options.ponderTouchButtonDesc')}>
                    <Toggle checked={ponder.showPonderTouchButton} onChange={ponder.setShowPonderTouchButton} />
                </Row>
            </Group>
        </>
    );
};

export default GeneralPage;
