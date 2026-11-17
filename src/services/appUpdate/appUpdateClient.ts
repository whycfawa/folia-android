import { IS_ANDROID_WEBVIEW } from '../../utils/platform';

// src/services/appUpdate/appUpdateClient.ts
// 自建更新服务的清单读取与判断：要不要提示、强制还是可选、跳过的是哪一个版本。
// 界面只拿结果，不碰请求细节。

export type AppUpdateInfo = {
    versionCode: number;
    versionName: string;
    notes: string;
    mandatory: boolean;
    minSupportedVersionCode: number;
    size: number;
    sha256?: string;
    apkUrl: string;
    publishedAt?: string;
};

export type AppUpdateDecision = 'none' | 'skip' | 'offer' | 'forced';

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

/** 构建期配置的更新服务地址；没配或不是安卓壳时整个功能不启用。 */
export const appUpdateEndpoint = (): string => {
    const raw = import.meta.env.VITE_UPDATE_ENDPOINT as string | undefined;
    return typeof raw === 'string' ? trimTrailingSlash(raw.trim()) : '';
};

export const isAppUpdateConfigured = (): boolean => appUpdateEndpoint() !== '' && IS_ANDROID_WEBVIEW;

const asNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/** 服务端给的字段不可信：缺 versionCode 或地址就整条丢掉。 */
export const normalizeAppUpdate = (raw: unknown): AppUpdateInfo | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const versionCode = asNumber(value.versionCode);
    const apkUrl = typeof value.apkUrl === 'string' ? value.apkUrl.trim() : '';
    if (!versionCode || versionCode <= 0 || !apkUrl) return null;
    return {
        versionCode,
        versionName: typeof value.versionName === 'string' && value.versionName.trim()
            ? value.versionName.trim() : String(versionCode),
        notes: typeof value.notes === 'string' ? value.notes : '',
        mandatory: value.mandatory === true,
        minSupportedVersionCode: asNumber(value.minSupportedVersionCode) ?? 0,
        size: asNumber(value.size) ?? 0,
        ...(typeof value.sha256 === 'string' && value.sha256 ? { sha256: value.sha256 } : {}),
        apkUrl,
        ...(typeof value.publishedAt === 'string' ? { publishedAt: value.publishedAt } : {}),
    };
};

/**
 * 判定：比本机旧的最小支持版本还低 = 强制；比本机新且标了强制 = 强制；
 * 比本机新但用户跳过了这一版 = 跳过；其余不提示。
 */
export const decideAppUpdate = (
    info: AppUpdateInfo | null,
    context: { currentVersionCode: number; skippedVersionCode: number | null },
): AppUpdateDecision => {
    if (!info) return 'none';
    const tooOld = context.currentVersionCode > 0 && context.currentVersionCode < info.minSupportedVersionCode;
    if (tooOld) return 'forced';
    if (info.versionCode <= context.currentVersionCode) return 'none';
    if (info.mandatory) return 'forced';
    if (context.skippedVersionCode === info.versionCode) return 'skip';
    return 'offer';
};

export const fetchAppUpdateInfo = async (
    currentVersionCode: number,
    options: { channel?: string; signal?: AbortSignal } = {},
): Promise<AppUpdateInfo | null> => {
    const endpoint = appUpdateEndpoint();
    if (!endpoint) return null;
    const params = new URLSearchParams({
        platform: 'android',
        channel: options.channel ?? 'stable',
        versionCode: String(Math.max(0, Math.trunc(currentVersionCode))),
    });
    const response = await fetch(endpoint + '/api/update?' + params.toString(), {
        credentials: 'omit',
        cache: 'no-store',
        signal: options.signal ?? AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Update check failed: HTTP ' + response.status);
    const body = await response.json() as { update?: unknown };
    return normalizeAppUpdate(body?.update);
};
