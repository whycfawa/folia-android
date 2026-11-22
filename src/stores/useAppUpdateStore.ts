import { create } from 'zustand';
import {
    decideAppUpdate,
    fetchAppUpdateInfo,
    isAppUpdateConfigured,
    type AppUpdateDecision,
    type AppUpdateInfo,
} from '../services/appUpdate/appUpdateClient';
import {
    canRequestPackageInstalls,
    describeApkInstaller,
    downloadApk,
    installApk,
    openInstallSettings,
    readInstalledAppVersion,
    waitForApkInstaller,
} from '../services/appUpdate/appUpdateInstaller';
import { appUpdateEndpoint } from '../services/appUpdate/appUpdateClient';
import { noteAppUpdateDiagnostics } from '../services/appUpdate/appUpdateDiagnostics';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useAppUpdateStore.ts
// 应用内更新：每次启动检查 GitHub Release，之后每 6 小时查一次；弹窗的打开与下载安装状态都在这。
// 版本号取自安装包本身（原生插件），不解析界面上的版本名。

const SKIPPED_KEY = 'app_update_skipped_version';
const PROMPT_ENABLED_KEY = 'app_update_prompt_enabled';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const START_DELAY_MS = 5000;

export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'needs-permission' | 'failed';

type AppUpdateState = {
    status: AppUpdateStatus;
    update: AppUpdateInfo | null;
    decision: AppUpdateDecision;
    progress: number;
    error: string | null;
    manualResult: 'up-to-date' | 'failed' | null;
    promptEnabled: boolean;
    promptVisible: boolean;
    check: (manual: boolean) => Promise<void>;
    dismiss: () => void;
    setPromptEnabled: (enabled: boolean) => void;
    download: () => Promise<void>;
    install: () => Promise<void>;
    openInstallSettings: () => Promise<void>;
};

const readSkippedVersion = (): number | null => {
    try {
        const raw = localStorage.getItem(SKIPPED_KEY);
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
        return null;
    }
};

const writeSkippedVersion = (versionCode: number | null): void => {
    try {
        if (versionCode === null) localStorage.removeItem(SKIPPED_KEY);
        else localStorage.setItem(SKIPPED_KEY, String(versionCode));
    } catch {
        // 存不进去只影响「以后再说」的记忆，不影响本次弹窗。
    }
};

let installedVersion: { versionCode: number; versionName: string } | null = null;
let checking = false;



const resolveInstalledVersion = async () => {
    if (installedVersion) return installedVersion;
    installedVersion = await readInstalledAppVersion();
    return installedVersion;
};

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
    status: 'idle',
    update: null,
    decision: 'none',
    progress: 0,
    error: null,
    manualResult: null,
    promptEnabled: getStoredBoolean(PROMPT_ENABLED_KEY, true),
    promptVisible: false,

    async check(manual) {
        if (checking) return;
        // 下载/安装/等待授权时不重新检查：一次检查会把 update 换成新的，正在进行的下载就断了。
        const busy = get().status;
        if (busy === 'downloading' || busy === 'downloaded' || busy === 'installing' || busy === 'needs-permission') return;
        const endpoint = appUpdateEndpoint();
        const configured = isAppUpdateConfigured();
        noteAppUpdateDiagnostics({ endpoint, configured });
        if (!configured) {
            console.info('[AppUpdate] no update endpoint in this build');
            return;
        }
        checking = true;
        set({ status: 'checking', manualResult: null, error: null });
        try {
            // cordova.js 可能比页面晚到：先等桥，等不到就把「桥没有」写进诊断，而不是静默什么都不做。
            const ready = await waitForApkInstaller(8000);
            const installer = describeApkInstaller();
            noteAppUpdateDiagnostics({ installer });
            if (!ready) throw new Error('APK installer bridge is unavailable (' + installer + ')');
            const installed = await resolveInstalledVersion();
            noteAppUpdateDiagnostics({ installed });
            if (!installed) throw new Error('installed version unavailable');
            const info = await fetchAppUpdateInfo(installed.versionCode, { currentVersionName: installed.versionName });
            const skippedVersionCode = manual ? null : readSkippedVersion();
            const decision = decideAppUpdate(info, {
                currentVersionCode: installed.versionCode,
                currentVersionName: installed.versionName,
                skippedVersionCode,
            });
            noteAppUpdateDiagnostics({
                lastCheck: {
                    at: new Date().toISOString(),
                    status: 'ok',
                    availableVersionCode: info ? info.versionCode : null,
                    remoteVersionName: info ? info.versionName : null,
                    currentVersionCode: installed.versionCode,
                    currentVersionName: installed.versionName,
                    skippedVersionCode,
                    manual,
                    decision,
                    error: null,
                },
            });
            if (info && decision === 'offer') {
                console.info('[AppUpdate] update available', {
                    installed: installed.versionCode,
                    available: info.versionCode,
                    decision,
                });
                set({ status: 'available', update: info, decision, progress: 0, promptVisible: manual || get().promptEnabled });
                return;
            }
            set({ status: 'idle', update: null, decision: 'none', promptVisible: false, manualResult: manual ? 'up-to-date' : null });
        } catch (error) {
            console.warn('[AppUpdate] check failed', error);
            noteAppUpdateDiagnostics({
                lastCheck: {
                    at: new Date().toISOString(),
                    status: 'failed',
                    availableVersionCode: null,
                    remoteVersionName: null,
                    currentVersionCode: installedVersion?.versionCode ?? 0,
                    currentVersionName: installedVersion?.versionName ?? '',
                    skippedVersionCode: readSkippedVersion(),
                    manual,
                    decision: 'none',
                    error: error instanceof Error ? error.message : String(error),
                },
            });
            set({ status: 'failed', error: error instanceof Error ? error.message : String(error), manualResult: manual ? 'failed' : null });
        } finally {
            checking = false;
        }
    },

    dismiss() {
        const { update, decision } = get();
        if (update && decision === 'offer') writeSkippedVersion(update.versionCode);
        set({ status: 'idle', update: null, decision: 'none', promptVisible: false, progress: 0, error: null });
    },

    setPromptEnabled(enabled) {
        setStoredBoolean(PROMPT_ENABLED_KEY, enabled);
        set({ promptEnabled: enabled });
    },

    async download() {
        const { update, status } = get();
        if (!update || status === 'downloading') return;
        set({ status: 'downloading', progress: 0, error: null });
        try {
            try {
                await downloadApk(update.apkUrl, percent => set({ progress: percent }));
            } catch (proxyError) {
                if (!update.fallbackApkUrl) throw proxyError;
                console.warn('[AppUpdate] proxy download failed, retrying GitHub', proxyError);
                await downloadApk(update.fallbackApkUrl, percent => set({ progress: percent }));
            }
            set({ status: 'downloaded', progress: 100 });
            console.info('[AppUpdate] download finished', { versionCode: update.versionCode });
        } catch (error) {
            console.warn('[AppUpdate] download failed', error);
            set({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
    },

    async install() {
        const { update } = get();
        if (!update) return;
        const allowed = await canRequestPackageInstalls();
        if (!allowed) {
            set({ status: 'needs-permission' });
            return;
        }
        set({ status: 'installing', error: null });
        try {
            await installApk();
            console.info('[AppUpdate] install requested', { versionCode: update.versionCode });
            // 插件成功表示已调起系统安装器，不代表用户已经确认安装；保留下载结果，
            // 这样用户取消或返回时弹窗仍有可操作的“安装”按钮，而不会卡在安装中。
            set({ status: 'downloaded' });
        } catch (error) {
            console.warn('[AppUpdate] install failed', error);
            set({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
    },

    async openInstallSettings() {
        await openInstallSettings();
    },
}));

let scheduled = false;

/** 启动 5 秒后查一次，之后每 6 小时查一次；只在页面可见时查。 */
export const installAppUpdateSchedule = (): void => {
    if (scheduled || typeof window === 'undefined') return;
    if (!isAppUpdateConfigured()) {
        console.info('[AppUpdate] update check is not configured for this build');
        return;
    }
    scheduled = true;
    const run = (manual: boolean) => { void useAppUpdateStore.getState().check(manual); };
    window.setTimeout(() => run(false), START_DELAY_MS);
    window.setInterval(() => {
        if (document.visibilityState !== 'hidden') run(false);
    }, CHECK_INTERVAL_MS);
};
