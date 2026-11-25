import type { FoliumSourceAudioQuality, FoliumSourceSong } from '@folia/folium';
import { CatalogError, createCatalog, parseSongId } from '../../../../../sources/lxmusic/main/catalog';
import { hostnameBlockReason } from '../../../../../sources/lxmusic/main/egressGuard';
import { buildMusicInfo, LX_TO_QUALITY, pickLxQuality, QUALITY_TO_LX } from '../../../../../sources/lxmusic/main/musicInfo';
import {
    createScriptLibrary, isLxPlatform, LxImportError, MAX_SCRIPT_BYTES, normalizeLxScript, parseLxHeader,
    sanitizeDeclaredSources, validateLxScript,
} from '../../../../../sources/lxmusic/main/scripts';
import type { LxScriptRecord } from '../../../../../sources/lxmusic/main/scripts';
import { FoliaLxSandbox, nativeFetchText, randomId, registerRemoteAudio } from './native';
import { createLocalScriptStorage } from './storage';

// src/services/onlineMusic/web/androidLx/backend.ts
// sources/lxmusic/main/index.ts 的安卓版：同一批 rpc 名字、同一套回答形状（{ ok, data } / { ok, code, message }），
// 逻辑尽量原样搬过来，只把三件桌面专属的事换成安卓的：
//   - 受控出口（egress.ts 用 Node 的 http 自己解析地址）→ 原生隐藏窗口的 shouldInterceptRequest + LxEgress（Java）；
//   - 隐藏窗口（api.windows.hidden 给 Electron 的 BrowserWindow）→ FoliaLxSandbox 插件里的 WebView；
//   - 音频转发（api.media.serve 的 Readable）→ 原生本地 Range 服务（registerRemoteAudio）。
// 曲库、脚本库、头注释解析、声明的清洗都直接用上游那份代码，没有第二套实现。

/** scripts.ts 用 Buffer.byteLength 量脚本大小；网页里没有 Buffer（它只在调用时才用，所以这里补上就够了）。 */
const globalScope = globalThis as unknown as { Buffer?: { byteLength(value: string, encoding?: string): number } };
globalScope.Buffer ??= {
    byteLength: (value: string) => new TextEncoder().encode(value).byteLength,
};

const CATALOG_TIMEOUT_MS = 12_000;
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_PAGE = 100;
/** 签发出去的音频地址多久之内有效（和桌面一致）。 */
const STREAM_TTL_MS = 6 * 60 * 60 * 1000;

type RpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** 脚本给的地址被拦下（本机、内网、非 http(s)）。桌面对应 egress.ts 的 EgressBlockedError。 */
class EgressBlockedError extends Error {
    readonly reason: string;
    constructor(reason: string, target = '') {
        super(`the address is not allowed (${reason})${target ? `: ${target}` : ''}`);
        this.name = 'EgressBlockedError';
        this.reason = reason;
    }
}

const failure = (error: unknown): RpcResult<never> => {
    if (error instanceof LxImportError) return { ok: false, code: `import:${error.code}`, message: error.message };
    if (error instanceof CatalogError) return { ok: false, code: error.code, message: error.message };
    if (error instanceof EgressBlockedError) return { ok: false, code: 'blocked', message: error.message };
    return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) };
};

const idOf = (song: unknown): string => {
    const id = song && typeof song === 'object' ? (song as { id?: unknown }).id : undefined;
    return typeof id === 'string' ? id : '';
};

/** 脚本给的地址：只收 http(s)，字面上就是本机或内网的当场拒掉。 */
const checkedMediaUrl = (value: unknown): string => {
    const raw = typeof value === 'string' ? value : (value as { url?: unknown } | null)?.url;
    if (typeof raw !== 'string' || raw.length > 4096) throw new CatalogError('invalid-response', 'the script returned no address');
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw new CatalogError('invalid-response', 'the script returned something that is not an address');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new EgressBlockedError('protocol', url.protocol);
    return url.href;
};

/** `catalog.ts` 要的那种 fetch：一个地址的回答文本，非 2xx 算失败，带上限。 */
const fetchText = async (url: string, options: { referer?: string; timeoutMs?: number } = {}): Promise<string> => {
    const answer = await nativeFetchText(url, { referer: options.referer, timeoutMs: options.timeoutMs ?? CATALOG_TIMEOUT_MS });
    if (answer.status < 200 || answer.status >= 300) {
        throw new CatalogError('unavailable', `the platform answered HTTP ${answer.status}`);
    }
    const declared = Number(answer.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) throw new CatalogError('invalid-response', 'the answer is too large');
    if (answer.text.length > MAX_CATALOG_BYTES) throw new CatalogError('invalid-response', 'the answer is too large');
    return answer.text;
};

export interface LxBackend {
    /** 和桌面 rpc 同一组名字与参数，回答同样包成 { ok, data } / { ok, code, message }。 */
    call(name: string, ...args: unknown[]): Promise<unknown>;
    /** 脚本库变了（导入、切换、移除）之后把沙箱窗口关掉，和桌面一样。 */
    destroySandbox(): void;
}

export const createLxBackend = (): LxBackend => {
    const library = createScriptLibrary(createLocalScriptStorage());
    const catalog = createCatalog(fetchText);
    let current: { scriptId: string; code: string; info: Record<string, unknown> } | null = null;

    const publicState = async () => {
        const state = await library.state();
        return {
            scripts: state.scripts.map(record => ({
                id: record.id,
                name: record.info.name,
                version: record.info.version ?? '',
                author: record.info.author ?? '',
                fileName: record.fileName,
                platforms: Object.keys(record.sources),
            })),
            activeId: state.active?.id ?? null,
            platform: state.platform,
            platforms: state.platforms,
        };
    };

    /** 当前脚本的原文与信息；原生侧按 scriptId 判断窗口里跑的是不是它。 */
    const activeScript = async () => {
        const { active } = await library.state();
        const code = active ? await library.code(active.id) : null;
        if (!active || code === null) throw new CatalogError('unavailable', 'no script is imported');
        const info = { ...active.info } as unknown as Record<string, unknown>;
        current = { scriptId: active.id, code, info };
        return current;
    };

    const loadInto = async (script: { scriptId: string; code: string; info: Record<string, unknown> }) => {
        const answer = await FoliaLxSandbox.load({ scriptId: script.scriptId, code: script.code, info: script.info });
        return answer?.sources ?? null;
    };

    const handlers: Record<string, (...args: never[]) => Promise<unknown>> = {
        state: () => publicState(),

        async importScript() {
            const picked = await FoliaLxSandbox.pickScript();
            if (picked?.canceled || typeof picked?.text !== 'string') return null;
            const raw = picked.text;
            if (new TextEncoder().encode(raw).byteLength > MAX_SCRIPT_BYTES * 2) throw new LxImportError('too-large');
            const code = normalizeLxScript(raw);
            validateLxScript(code);
            const fileName = (picked.name || 'script.js').slice(0, 120);
            const record: LxScriptRecord = {
                id: randomId(),
                info: parseLxHeader(code, fileName.replace(/\.[^.]+$/, '')),
                sources: {},
                importedAt: Date.now(),
                fileName,
            };
            // 先在沙箱里跑一遍：它得声明自己支持哪几家，才算一个能用的脚本。
            let declared: unknown;
            try {
                declared = await loadInto({ scriptId: record.id, code, info: { ...record.info } as unknown as Record<string, unknown> });
            } catch (error) {
                FoliaLxSandbox.destroy().catch(() => undefined);
                throw new LxImportError('load-failed', error instanceof Error ? error.message : String(error));
            }
            record.sources = sanitizeDeclaredSources(declared);
            if (Object.keys(record.sources).length === 0) {
                FoliaLxSandbox.destroy().catch(() => undefined);
                throw new LxImportError('no-platform');
            }
            try {
                await library.add(record, code);
            } catch (error) {
                FoliaLxSandbox.destroy().catch(() => undefined);
                throw error;
            }
            return publicState();
        },

        async selectScript(id: unknown) {
            if (await library.select(String(id))) {
                current = null;
                FoliaLxSandbox.destroy().catch(() => undefined);
            }
            return publicState();
        },

        async removeScript(id: unknown) {
            if (await library.remove(String(id))) {
                current = null;
                FoliaLxSandbox.destroy().catch(() => undefined);
            }
            return publicState();
        },

        async setPlatform(platform: unknown) {
            if (isLxPlatform(platform)) await library.setPlatform(platform);
            return publicState();
        },

        async catalog(operation: unknown, params: unknown) {
            const input = params && typeof params === 'object' ? params as Record<string, unknown> : {};
            const limit = Math.min(Math.max(Math.trunc(Number(input.limit)) || 30, 1), MAX_PAGE);
            const offset = Math.max(Math.trunc(Number(input.offset)) || 0, 0);
            const id = typeof input.id === 'string' ? input.id : '';
            // 没导入脚本时什么都不请求（桌面的同一条守则）。
            const { platform, active } = await library.state();
            if (!active || !platform) throw new CatalogError('unavailable', 'no script is imported');
            if (operation === 'tracks') return catalog.tracks(id, limit, offset);
            if (operation === 'song') return catalog.song(id);
            const query = typeof input.query === 'string' ? input.query.trim().slice(0, 200) : '';
            if (operation === 'charts') return catalog.charts(platform);
            if (!query) return { items: [], hasMore: false };
            if (operation === 'searchSongs') return catalog.searchSongs(platform, query, limit, offset);
            if (operation === 'searchPlaylists') return catalog.searchPlaylists(platform, query, limit, offset);
            if (operation === 'searchAlbums') return catalog.searchAlbums(platform, query, limit, offset);
            throw new CatalogError('unsupported', `unknown operation ${String(operation)}`);
        },

        async audio(song: FoliumSourceSong, quality: FoliumSourceAudioQuality) {
            const parsed = parseSongId(idOf(song));
            if (!parsed) throw new CatalogError('unsupported', 'not a song of this source');
            const { active } = await library.state();
            const support = active?.sources[parsed.platform];
            if (!support) throw new CatalogError('unsupported', `the script does not serve ${parsed.platform}`);
            const lxQuality = pickLxQuality(QUALITY_TO_LX[quality] ?? '320k', support.qualities);
            if (!lxQuality) throw new CatalogError('unsupported', 'the script names no quality');
            const script = await activeScript();
            const answer = await FoliaLxSandbox.call({
                scriptId: script.scriptId,
                code: script.code,
                info: script.info,
                payload: {
                    source: parsed.platform,
                    action: 'musicUrl',
                    info: { type: lxQuality, musicInfo: buildMusicInfo(parsed.platform, parsed.nativeId, song) },
                },
            });
            const url = checkedMediaUrl(answer?.result);
            // 字面上就是本机或内网的当场报出来，不等到播放器来取流才失败。
            const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
            const reason = hostnameBlockReason(host);
            if (reason) throw new EgressBlockedError(reason, host);
            // 桌面把地址存进 streams 表、交 folia-mod://lxmusic/_media/stream/… 给播放器；安卓交给本地 Range 服务。
            // 空的 referer 是「别发 Referer」：脚本给的主机哪家都有，乱带一个会被别的 CDN 回成 HTML（桌面版也不带）。
            const local = await registerRemoteAudio(url, { 'accept-encoding': 'identity', referer: '' });
            return { url: local, quality: LX_TO_QUALITY[lxQuality], expiresAt: Date.now() + STREAM_TTL_MS };
        },

        async lyric(song: FoliumSourceSong) {
            const parsed = parseSongId(idOf(song));
            if (!parsed) return null;
            const state = await library.state();
            // 没导入脚本时不联网，公开接口的歌词也不取。
            if (!state.active) return null;
            // 脚本声明了 lyric 的用脚本的（酷狗、QQ 只有这条路），否则用公开接口的；脚本答不上也退回公开接口。
            if (state.active.sources[parsed.platform]?.actions.includes('lyric')) {
                try {
                    const script = await activeScript();
                    const answer = await FoliaLxSandbox.call({
                        scriptId: script.scriptId,
                        code: script.code,
                        info: script.info,
                        payload: {
                            source: parsed.platform,
                            action: 'lyric',
                            info: { type: null, musicInfo: buildMusicInfo(parsed.platform, parsed.nativeId, song) },
                        },
                    });
                    const lyric = answer?.result as { lyric?: unknown; tlyric?: unknown; rlyric?: unknown } | null;
                    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.slice(0, 1_000_000) : '');
                    const main = text(lyric?.lyric);
                    if (main) {
                        return {
                            lyric: main,
                            ...(text(lyric?.tlyric) ? { translation: text(lyric?.tlyric) } : {}),
                            ...(text(lyric?.rlyric) ? { romanization: text(lyric?.rlyric) } : {}),
                        };
                    }
                } catch (error) {
                    console.warn('[LxMusic] the script gave no lyric', error);
                }
            }
            return catalog.lyric(song.id);
        },
    };

    return {
        async call(name, ...args) {
            const handler = handlers[name];
            if (!handler) return { ok: false, code: 'unsupported', message: `unknown operation ${name}` } as RpcResult<never>;
            try {
                return { ok: true, data: await handler(...args as never[]) } as RpcResult<unknown>;
            } catch (error) {
                return failure(error);
            }
        },
        destroySandbox() {
            current = null;
            FoliaLxSandbox.destroy().catch(() => undefined);
        },
    };
};
