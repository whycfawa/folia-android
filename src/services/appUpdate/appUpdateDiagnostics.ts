import type { AppUpdateDecision } from './appUpdateClient';

// src/services/appUpdate/appUpdateDiagnostics.ts
// 更新的诊断现场：包里的地址、Cordova 桥的形态、读到的安装版本、最近一次检查的结果。
// 放在 services 而不是 store：诊断报告（utils）只读这里，不反过来依赖状态层。

export type AppUpdateDiagnostics = {
    endpoint: string;
    configured: boolean;
    installer: string;
    installed: { versionCode: number; versionName: string } | null;
    lastCheck: {
        at: string;
        status: string;
        availableVersionCode: number | null;
        remoteVersionName: string | null;
        currentVersionCode: number | null;
        currentVersionName: string | null;
        skippedVersionCode: number | null;
        manual: boolean;
        decision: AppUpdateDecision;
        error: string | null;
    } | null;
};

const state: AppUpdateDiagnostics = {
    endpoint: 'https://api.github.com/repos/whycfawa/folia-android/releases/latest',
    configured: false,
    installer: 'unchecked',
    installed: null,
    lastCheck: null,
};

export const noteAppUpdateDiagnostics = (patch: Partial<AppUpdateDiagnostics>): void => {
    Object.assign(state, patch);
};

export const readAppUpdateDiagnostics = (): AppUpdateDiagnostics => ({
    ...state,
    installed: state.installed,
    lastCheck: state.lastCheck,
});
