import { IS_ANDROID_WEBVIEW } from '../../utils/platform';

// src/services/appUpdate/appUpdateClient.ts
// GitHub Release 更新清单：公共镜像优先，GitHub 原地址兜底。

const REPOSITORY = 'whycfawa/folia-android';
const GITHUB_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const GITHUB_PROXY_PREFIX = 'https://gh-proxy.org/';
const RELEASE_TAG_PATTERN = /^v?(\d+\.\d+\.\d+)-android\.(\d+)$/;

export type AppUpdateInfo = {
    versionCode: number;
    versionName: string;
    notes: string;
    size: number;
    sha256?: string;
    apkUrl: string;
    fallbackApkUrl?: string;
    publishedAt?: string;
};

export type AppUpdateDecision = 'none' | 'skip' | 'offer';

const asNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const proxyUrl = (url: string): string => `${GITHUB_PROXY_PREFIX}${url}`;

export const appUpdateEndpoint = (): string => GITHUB_API_URL;

export const appUpdateSources = (): { metadata: string[] } => ({
    metadata: [proxyUrl(GITHUB_API_URL), GITHUB_API_URL],
});

export const isAppUpdateConfigured = (): boolean => IS_ANDROID_WEBVIEW;

const parseReleaseTag = (tag: unknown): { versionName: string; versionCode: number } | null => {
    if (typeof tag !== 'string') return null;
    const match = RELEASE_TAG_PATTERN.exec(tag.trim());
    if (!match) return null;
    return { versionName: `${match[1]}-android.${match[2]}`, versionCode: Number(match[2]) };
};

const normalizeAssetUrl = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** 将 GitHub Release API 响应转换成弹窗需要的最小字段。 */
export const normalizeGitHubRelease = (raw: unknown): AppUpdateInfo | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const parsed = parseReleaseTag(value.tag_name);
    if (!parsed || !Array.isArray(value.assets)) return null;
    const asset = value.assets.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const name = String((item as Record<string, unknown>).name || '').toLowerCase();
        return name.endsWith('.apk');
    }) as Record<string, unknown> | undefined;
    const directApkUrl = normalizeAssetUrl(asset?.browser_download_url);
    if (!directApkUrl) return null;
    return {
        ...parsed,
        notes: typeof value.body === 'string' ? value.body.trim() : '',
        size: asNumber(asset?.size) ?? 0,
        ...(typeof value.published_at === 'string' ? { publishedAt: value.published_at } : {}),
        apkUrl: proxyUrl(directApkUrl),
        fallbackApkUrl: directApkUrl,
    };
};

const versionParts = (value: string): [number, number, number, number] | null => {
    const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)-android\.(\d+)$/.exec(value.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
};

/**
 * 从安装包/Release 版本名提取安卓版迭代号。
 *
 * Android 的 versionCode 与 Release 迭代号不是同一个计数器（例如
 * 0.7.29-android.488 的 versionCode 是 526），所以更新判断不能拿两者
 * 直接比较。版本名里的 `android.N` 才是发布迭代号。
 */
export const extractAndroidIteration = (value: string | undefined | null): number | null => {
    if (typeof value !== 'string') return null;
    const match = /(?:^|-)android\.(\d+)(?:$|[-+])/i.exec(value.trim());
    if (!match) return null;
    const iteration = Number(match[1]);
    return Number.isSafeInteger(iteration) && iteration >= 0 ? iteration : null;
};

export const compareAppVersions = (left: string, right: string): number => {
    const a = versionParts(left);
    const b = versionParts(right);
    if (!a || !b) return 0;
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
    }
    return 0;
};

export const decideAppUpdate = (
    info: AppUpdateInfo | null,
    context: { currentVersionCode: number; currentVersionName?: string; skippedVersionCode: number | null },
): AppUpdateDecision => {
    if (!info) return 'none';
    const currentIteration = extractAndroidIteration(context.currentVersionName);
    const remoteIteration = extractAndroidIteration(info.versionName);
    // 优先比较 Release 迭代号。它与 APK 的 versionCode 独立，能正确处理
    // 已安装包 0.7.29-android.488 (versionCode 526) → Release 489。
    const isNewer = currentIteration !== null && remoteIteration !== null
        ? remoteIteration > currentIteration
        : info.versionCode > context.currentVersionCode;
    if (!isNewer) return 'none';
    if (context.skippedVersionCode === info.versionCode) return 'skip';
    return 'offer';
};

const readText = async (url: string, externalSignal?: AbortSignal): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const abortFromCaller = () => controller.abort();
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/vnd.github+json' },
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Update check failed: HTTP ${response.status}`);
        return response.text();
    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abortFromCaller);
    }
};

export const fetchAppUpdateInfo = async (
    _currentVersionCode: number,
    options: { currentVersionName?: string; signal?: AbortSignal } = {},
): Promise<AppUpdateInfo | null> => {
    if (!IS_ANDROID_WEBVIEW) return null;
    const sources = appUpdateSources().metadata;
    let lastError: unknown = null;
    for (const source of sources) {
        try {
            const body = await readText(source, options.signal);
            const info = normalizeGitHubRelease(JSON.parse(body));
            if (info) return info;
            lastError = new Error(`Update metadata from ${new URL(source).host} has no Android APK release.`);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Update check failed');
};
