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

// src/stores/useAppUpdateStore.ts
// 应用内更新：启动后查一次、之后每 6 小时查一次；弹窗的打开与下载安装状态都在这。
// 版本号取自安装包本身（原生插件），不解析界面上的版本名。

const SKIPPED_KEY = 'app_update_skipped_version';
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
    check: (manual: boolean) => Promise<void>;
    dismiss: () => void;
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
            const info = await fetchAppUpdateInfo(installed.versionCode);
            noteAppUpdateDiagnostics({
                lastCheck: {
                    at: new Date().toISOString(),
                    status: 'ok',
                    availableVersionCode: info ? info.versionCode : null,
                    decision: decideAppUpdate(info, { currentVersionCode: installed.versionCode, skippedVersionCode: manual ? null : readSkippedVersion() }),
                    error: null,
                },
            });
            const decision = decideAppUpdate(info, {
                currentVersionCode: installed.versionCode,
                // 手动检查时不受「以后再说」影响。
                skippedVersionCode: manual ? null : readSkippedVersion(),
            });
            if (info && (decision === 'offer' || decision === 'forced')) {
                console.info('[AppUpdate] update available', {
                    installed: installed.versionCode,
                    available: info.versionCode,
                    decision,
                });
                set({ status: 'available', update: info, decision, progress: 0 });
                return;
            }
            set({ status: 'idle', update: null, decision: 'none', manualResult: manual ? 'up-to-date' : null });
        } catch (error) {
            console.warn('[AppUpdate] check failed', error);
            noteAppUpdateDiagnostics({
                lastCheck: {
                    at: new Date().toISOString(),
                    status: 'failed',
                    availableVersionCode: null,
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
        set({ status: 'idle', update: null, decision: 'none', progress: 0, error: null });
    },

    async download() {
        const { update, status } = get();
        if (!update || status === 'downloading') return;
        set({ status: 'downloading', progress: 0, error: null });
        try {
            await downloadApk(update.apkUrl, percent => set({ progress: percent }));
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
