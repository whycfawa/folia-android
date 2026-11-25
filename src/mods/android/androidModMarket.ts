import { unzipSync, strFromU8 } from 'fflate';
import shared from '../../../electron/modSystem/foliumShared.json';
import type { ModMarketCatalog, ModMarketCatalogResult, ModRuntimeInfo } from '../types';
import { getStoredString, setStoredString } from '../../stores/storagePrimitives';

// src/mods/android/androidModMarket.ts
// 桌面版的模组市场在 electron/modSystem/market.cjs（读目录、README、按 SHA-256 校验后安装）；
// 安卓没有主进程和 Node，这里按安卓专属替代规则实现同一份协议：网络走原生 httpRequest，
// 缓存落在 localStorage，目录字段与上游 market.cjs 的 normalizeCatalog/normalizeModEntry 同口径。

const MARKET_ORIGIN = shared.market.origin;
const CATALOG_URL = `${MARKET_ORIGIN}/catalog.json`;
const CACHE_KEY = 'mod_market_catalog';
const CATALOG_FORMAT = 'folium-market-catalog';
const CATALOG_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;
const CATALOG_MAX_BYTES = 8 * 1024 * 1024;
const README_MAX_BYTES = 256 * 1024;
const INSTALL_MAX_BYTES = 96 * 1024 * 1024;
const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

type RawCatalog = {
    format?: unknown;
    version?: unknown;
    commit?: unknown;
    mods?: unknown[];
    categories?: unknown[];
    awesome?: unknown[];
};

type CachedCatalog = { raw: RawCatalog; catalog: ModMarketCatalog; fetchedAt: number; etag: string | null };

type NativeHttpResponse = {
    status?: number;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    bodyBase64?: string;
};

const nativePlugin = (): { httpRequest?: (options: Record<string, unknown>) => Promise<NativeHttpResponse> } | null => {
    const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    return (capacitor?.Plugins?.FoliaNative as { httpRequest?: (options: Record<string, unknown>) => Promise<NativeHttpResponse> } | undefined) ?? null;
};

const text = (value: unknown, limit: number): string | null => (
    typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null
);

const stringList = (value: unknown, limit = 64): string[] => (Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, limit)
    : []);

// Same three checks as market.cjs's marketLink: it must be a file served by the market site.
const marketLink = (value: unknown, prefix: string): string | null => {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
        const url = new URL(value, MARKET_ORIGIN);
        return url.origin === MARKET_ORIGIN && url.pathname.startsWith(prefix) && !url.pathname.includes('..')
            ? url.href : null;
    } catch {
        return null;
    }
};

const normalizeCatalog = (raw: unknown): ModMarketCatalog | null => {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as RawCatalog;
    if (source.format !== CATALOG_FORMAT || !Array.isArray(source.mods)) return null;
    const seen = new Set<string>();
    const mods = source.mods.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const download = item.download && typeof item.download === 'object' ? item.download as Record<string, unknown> : {};
        const id = typeof item.id === 'string' && MOD_ID_PATTERN.test(item.id) ? item.id : null;
        const version = typeof item.version === 'string' && VERSION_PATTERN.test(item.version) ? item.version : null;
        const url = marketLink(download.url, '/downloads/');
        const sha256 = typeof download.sha256 === 'string' && SHA256_PATTERN.test(download.sha256) ? download.sha256 : null;
        const digest = typeof item.digest === 'string' && DIGEST_PATTERN.test(item.digest) ? item.digest : null;
        if (!id || !version || !url || !sha256 || !digest || seen.has(id)) return [];
        seen.add(id);
        return [{
            id,
            name: text(item.name, 120) ?? id,
            version,
            author: text(item.author, 120),
            description: text(item.description, 2000),
            origin: item.origin === 'official' ? 'official' as const : 'community' as const,
            channel: item.channel === 'beta' ? 'beta' as const : 'release' as const,
            kind: item.kind === 'source' ? 'source' as const : 'standard' as const,
            category: text(item.category, 40),
            tags: stringList(item.tags, 24),
            permissions: stringList(item.permissions),
            experimental: stringList(item.experimental),
            embedOrigins: stringList(item.embedOrigins),
            depends: stringList(item.depends),
            folia: text(item.folia, 80),
            hasMain: item.hasMain === true,
            owners: [],
            source: typeof item.source === 'string' ? item.source : null,
            repository: typeof item.repository === 'string' ? item.repository : null,
            bugs: typeof item.bugs === 'string' ? item.bugs : null,
            readmeUrl: marketLink(item.readme, '/readmes/'),
            keyLabel: text(item.keyLabel, 200),
            keyId: text(item.keyId, 200),
            signedAt: text(item.signedAt, 40),
            addedAt: text(item.addedAt, 40),
            updatedAt: text(item.updatedAt, 40) ?? text(item.signedAt, 40),
            digest,
            download: { url, sha256, size: Number(download.size) > 0 ? Number(download.size) : null },
            preview: null,
            page: `${MARKET_ORIGIN}/#mod-${id}`,
            hostRange: 'ok' as const,
            communityBlocked: false,
        }];
    });
    return {
        version: Number(source.version) || null,
        commit: text(source.commit, 64),
        origin: MARKET_ORIGIN,
        categories: [],
        mods,
        awesome: [],
    };
};

const httpGet = async (url: string, headers: Record<string, string>, timeoutMs: number): Promise<{
    status: number;
    headers: Record<string, string>;
    bytes: Uint8Array;
    ok: boolean;
}> => {
    const plugin = nativePlugin();
    if (!plugin?.httpRequest) throw new Error('native-http-unavailable');
    const response = await plugin.httpRequest({
        url,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
        redirect: 'error',
        timeoutMs,
    });
    const rawHeaders = response.headers ?? {};
    const normalized = Array.isArray(rawHeaders)
        ? Object.fromEntries(rawHeaders.filter(header => typeof header?.name === 'string').map(header => [String(header.name).toLowerCase(), String(header.value ?? '')]))
        : Object.fromEntries(Object.entries(rawHeaders).map(([name, value]) => [name.toLowerCase(), String(value)]));
    const binary = atob(response.bodyBase64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const status = Number(response.status || 0);
    return { status, headers: normalized, bytes, ok: status >= 200 && status < 300 };
};

const readCache = (): CachedCatalog | null => {
    try {
        const raw = getStoredString(CACHE_KEY, '');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedCatalog;
        const catalog = normalizeCatalog(parsed.raw);
        if (!catalog || !Number.isFinite(parsed.fetchedAt)) return null;
        return { ...parsed, catalog };
    } catch {
        return null;
    }
};

const writeCache = (value: CachedCatalog): void => {
    try { setStoredString(CACHE_KEY, JSON.stringify(value)); } catch (error) {
        console.warn('[ModMarket] Android cache write failed', error);
    }
};

let memory: CachedCatalog | null = null;
let catalogLoad: Promise<CachedCatalog> | null = null;

const fetchCatalog = async (): Promise<CachedCatalog> => {
    const cached = readCache();
    const response = await httpGet(CATALOG_URL, cached?.etag ? { 'if-none-match': cached.etag } : {}, FETCH_TIMEOUT_MS);
    if (response.status === 304 && cached) {
        const next = { ...cached, fetchedAt: Date.now() };
        memory = next;
        writeCache(next);
        return next;
    }
    if (!response.ok) throw new Error(`market-http:${response.status}`);
    if (response.bytes.length > CATALOG_MAX_BYTES) throw new Error('market-too-large');
    const raw = JSON.parse(new TextDecoder().decode(response.bytes)) as RawCatalog;
    const catalog = normalizeCatalog(raw);
    if (!catalog) throw new Error('market-catalog-format');
    const next: CachedCatalog = { raw, catalog, etag: response.headers.etag ?? null, fetchedAt: Date.now() };
    memory = next;
    writeCache(next);
    return next;
};

const getCatalog = async (options?: { force?: boolean }): Promise<ModMarketCatalogResult> => {
    const cached = memory ?? readCache();
    if (!options?.force && cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
        return { ok: true, catalog: cached.catalog, fetchedAt: cached.fetchedAt, stale: false };
    }
    if (!catalogLoad) catalogLoad = fetchCatalog().finally(() => { catalogLoad = null; });
    try {
        const fresh = await catalogLoad;
        return { ok: true, catalog: fresh.catalog, fetchedAt: fresh.fetchedAt, stale: false };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn('[ModMarket] Android catalog could not be read', error);
        return cached
            ? { ok: true, catalog: cached.catalog, fetchedAt: cached.fetchedAt, stale: true, error: reason }
            : { ok: false, error: reason };
    }
};

const getReadme = async (url: string): Promise<{ ok: boolean; text?: string; error?: string }> => {
    try {
        const link = marketLink(url, '/readmes/');
        if (!link) return { ok: false, error: 'market-readme-url' };
        const response = await httpGet(link, {}, FETCH_TIMEOUT_MS);
        if (!response.ok) return { ok: false, error: `market-http:${response.status}` };
        if (response.bytes.length > README_MAX_BYTES) return { ok: false, error: 'market-too-large' };
        return { ok: true, text: new TextDecoder().decode(response.bytes) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const installFromMarket = async (modId: string): Promise<{ ok: boolean; id?: string; mods?: ModRuntimeInfo[]; error?: string }> => {
    try {
        const current = await getCatalog();
        const entry = current.ok ? current.catalog.mods.find(mod => mod.id === modId) : null;
        if (!entry) return { ok: false, error: 'market-mod-not-found' };
        const response = await httpGet(entry.download.url, {}, DOWNLOAD_TIMEOUT_MS);
        if (!response.ok) return { ok: false, error: `market-http:${response.status}` };
        if (response.bytes.length > INSTALL_MAX_BYTES) return { ok: false, error: 'market-too-large' };
        if (await sha256Hex(response.bytes) !== entry.download.sha256) return { ok: false, error: 'market-checksum-mismatch' };

        const files = unzipSync(response.bytes);
        const total = Object.values(files).reduce((sum, file) => sum + file.byteLength, 0);
        if (Object.keys(files).length > 2000 || total > 96 * 1024 * 1024
            || Object.values(files).some(file => file.byteLength > 64 * 1024 * 1024)) {
            return { ok: false, error: 'market-too-large' };
        }
        const manifestPath = Object.keys(files).find(path => path.endsWith('mod.json'));
        if (!manifestPath) return { ok: false, error: 'market-invalid-mod' };
        const manifest = JSON.parse(strFromU8(files[manifestPath])) as Record<string, unknown>;
        if (manifest.id !== entry.id || manifest.version !== entry.version) return { ok: false, error: 'market-invalid-mod' };
        if (typeof manifest.main === 'string' && manifest.main) return { ok: false, error: 'market-main-unsupported' };

        // rust-zip 由原生 FoliaMods 插件安装：它负责路径检查与目录替换，渲染层只交出校验过的字节。
        const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
        const plugin = capacitor?.Plugins?.FoliaMods as {
            installZipFromBase64?: (options: { id: string; base64: string }) => Promise<{ imported?: string; error?: string }>;
        } | undefined;
        if (!plugin?.installZipFromBase64) return { ok: false, error: 'market-install-unsupported' };
        let binary = '';
        for (let index = 0; index < response.bytes.length; index += 1) binary += String.fromCharCode(response.bytes[index]);
        const result = await plugin.installZipFromBase64({ id: entry.id, base64: btoa(binary) });
        if (!result.imported) return { ok: false, error: result.error || 'market-install-failed' };
        const { listAndroidMods } = await import('./androidModsBridge');
        return { ok: true, id: result.imported, mods: (await listAndroidMods()).mods };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};

export const androidModMarketBridge = {
    getMarketCatalog: getCatalog,
    getMarketReadme: getReadme,
    installFromMarket,
    onMarketProgress: () => () => undefined,
};
