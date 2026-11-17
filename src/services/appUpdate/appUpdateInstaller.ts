// src/services/appUpdate/appUpdateInstaller.ts
// 调 cordova-plugin-apkupdater：读安装版本、下载、安装、引导「安装未知应用」授权。
// 插件没装上或不在安卓壳里时，每个入口都返回不可用，不抛到界面。

type DownloadProgressEvent = { progress: number; bytes: number; bytesWritten: number };

type ApkUpdaterPlugin = {
    getInstalledVersion?: (
        success?: (value: { version?: { name?: string; code?: number } }) => void,
        failure?: (error: unknown) => void,
    ) => Promise<{ version?: { name?: string; code?: number } }> | void;
    download?: (
        url: string,
        options?: { onDownloadProgress?: (event: DownloadProgressEvent) => void },
        success?: () => void,
        failure?: (error: unknown) => void,
    ) => Promise<unknown> | void;
    install?: (success?: () => void, failure?: (error: unknown) => void) => Promise<unknown> | void;
    canRequestPackageInstalls?: (success?: (value: boolean) => void, failure?: (error: unknown) => void) => Promise<boolean> | void;
    openInstallSetting?: (success?: () => void, failure?: (error: unknown) => void) => Promise<unknown> | void;
};

const plugin = (): ApkUpdaterPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    const fromCapacitor = capacitor?.Plugins?.ApkUpdater as ApkUpdaterPlugin | undefined;
    if (fromCapacitor) return fromCapacitor;
    return (window as unknown as { ApkUpdater?: ApkUpdaterPlugin }).ApkUpdater ?? null;
};

export const isApkInstallerAvailable = (): boolean => Boolean(plugin()?.download && plugin()?.install);

/**
 * 等 Cordova 桥就绪：window.ApkUpdater 是 cordova.js 注入的，页面刚起来时可能还没到。
 * 启动早期直接判「不可用」会让整套更新静默失效，所以先等一等，最多 timeoutMs。
 */
export const waitForApkInstaller = async (timeoutMs = 8000): Promise<boolean> => {
    if (isApkInstallerAvailable()) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (isApkInstallerAvailable()) return true;
    }
    return false;
};

/** 诊断用：桥到底以哪种形态出现，没有时返回 null。 */
export const describeApkInstaller = (): string => {
    if (typeof window === 'undefined') return 'no-window';
    const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    if (capacitor?.Plugins?.ApkUpdater) return 'capacitor-plugin';
    if ((window as unknown as { ApkUpdater?: unknown }).ApkUpdater) return 'window.ApkUpdater';
    return 'missing';
};

/** 插件同时支持 Promise 与回调两种调用：这里统一成 Promise，两种都兜住。 */
const invoke = <T>(
    run: (success: (value: T) => void, failure: (error: unknown) => void) => unknown,
): Promise<T> => new Promise<T>((resolve, reject) => {
    let settled = false;
    const succeed = (value: T) => { if (!settled) { settled = true; resolve(value); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error instanceof Error ? error : new Error(String(error))); } };
    try {
        const returned = run(succeed, fail);
        if (returned && typeof (returned as { then?: unknown }).then === 'function') {
            // Promise 形态的插件只回 resolve 值（可能是 undefined），成功与否由它自己表达。
            (returned as Promise<unknown>).then(() => succeed(undefined as T)).catch(fail);
        }
    } catch (error) {
        fail(error);
    }
});

export type InstalledAppVersion = { versionCode: number; versionName: string };

export const readInstalledAppVersion = async (): Promise<InstalledAppVersion | null> => {
    const api = plugin();
    if (!api?.getInstalledVersion) return null;
    try {
        const info = await invoke<{ version?: { name?: string; code?: number } }>((success, failure) => (
            api.getInstalledVersion!(success, failure)
        ));
        const code = Number(info?.version?.code);
        if (!Number.isFinite(code) || code <= 0) return null;
        return { versionCode: code, versionName: String(info?.version?.name || '') };
    } catch (error) {
        console.warn('[AppUpdate] read installed version failed', error);
        return null;
    }
};

export const canRequestPackageInstalls = async (): Promise<boolean> => {
    const api = plugin();
    if (!api?.canRequestPackageInstalls) return false;
    try {
        return Boolean(await invoke<boolean>((success, failure) => api.canRequestPackageInstalls!(success, failure)));
    } catch (error) {
        console.warn('[AppUpdate] install permission check failed', error);
        return false;
    }
};

export const openInstallSettings = async (): Promise<void> => {
    const api = plugin();
    if (!api?.openInstallSetting) return;
    try {
        await invoke<void>((success, failure) => api.openInstallSetting!(success as () => void, failure));
    } catch (error) {
        console.warn('[AppUpdate] open install settings failed', error);
    }
};

export const downloadApk = async (
    url: string,
    onProgress: (percent: number) => void,
): Promise<void> => {
    const api = plugin();
    if (!api?.download) throw new Error('APK installer is unavailable');
    await invoke<void>((success, failure) => (
        api.download!(url, {
            onDownloadProgress: (event) => {
                const percent = Number(event?.progress);
                if (Number.isFinite(percent)) onProgress(Math.min(100, Math.max(0, percent)));
            },
        }, () => success(undefined as void), failure)
    ));
};

export const installApk = async (): Promise<void> => {
    const api = plugin();
    if (!api?.install) throw new Error('APK installer is unavailable');
    await invoke<void>((success, failure) => api.install!(() => success(undefined as void), failure));
};
