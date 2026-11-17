import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';
import { isFoliaExtensionBridgeConfigured, requestFoliaExtension } from '../../foliaExtensionBridge';
import { IS_ANDROID_WEBVIEW } from '../../../utils/platform';
import type { QishuiBridgeResult, QishuiOperation, QishuiParams } from 'qishui-music-api';

// Typed renderer boundary for the car bridge; credentials and player models stay in the main process.
export type { QishuiOperation, QishuiParams, QishuiBridgeResult } from 'qishui-music-api';
// What a request fails with where this page has no desktop bridge (the web build), and where the bridge
// itself failed (the main process threw). qishuiFailure.ts tells both apart by them.
export const QISHUI_NEEDS_DESKTOP = 'Qishui requires the desktop app';
export const QISHUI_BRIDGE_FAILED = 'Qishui desktop request failed';
export const QISHUI_ANDROID_FAILED = 'Qishui Android bridge request failed';
const STAGES = ['access-code', 'ticket', 'account'] as const;
export type QishuiLoginStage = typeof STAGES[number];
// The last failure of a sign-in operation (login_*), for the sign-in diagnostics. Other requests made
// while signing in (lyrics, radio, covers) are not the sign-in's, and are not kept here. The platform's
// own words for a refusal are kept as they came; only the bridge knows which response they came from.
let lastFailure: { stage: QishuiLoginStage | null; code: ProviderErrorCode; upstreamCode?: string; message?: string } | null = null;
export const getQishuiLastFailure = () => lastFailure;
const isLoginOperation = (operation: QishuiOperation) => operation.startsWith('login_');
export class QishuiRequestError extends OnlineProviderError {
    constructor(code: ProviderErrorCode, message: string, public readonly stage: QishuiLoginStage | null,
        public readonly upstreamCode?: string, public readonly upstreamMessage?: string) {
        super(code, message, 'qishui');
    }
}
// The bridge answers with the package's fields plus the platform's own refusal sentence (Android bridge);
// the desktop bridge answers with the package's fields only, so the sentence stays optional.
type QishuiBridgeFailure = Extract<QishuiBridgeResult, { ok: false }>['error'] & { upstreamMessage?: string };
type QishuiBridgeAnswer<T = unknown> = { ok: true; data: T } | { ok: false; error: QishuiBridgeFailure };
const refusalSentence = (error: QishuiBridgeFailure): string | undefined => (
    typeof error.upstreamMessage === 'string' && error.upstreamMessage.trim() !== ''
        ? error.upstreamMessage.trim().slice(0, 200) : undefined
);
// 桌面走 Electron 主进程桥；安卓没有 Electron，走内置原生桥（nativeBridge/api/qishui.js）。
// 只认 electron 的话，安卓上汽水会被判成「运行时不可用」，整个平台在界面上就消失了。
export const getQishuiAvailability = () => (
    typeof window !== 'undefined'
    && (typeof window.electron?.qishuiRequest === 'function' || IS_ANDROID_WEBVIEW)
        ? { configured: true } as const : { configured: false, reason: 'runtime-unavailable' } as const
);
export async function requestQishui<T = unknown>(operation: QishuiOperation, params: QishuiParams = {}): Promise<T> {
    if (operation === 'login_qr_key') lastFailure = null;
    if (!getQishuiAvailability().configured) throw new OnlineProviderError('unavailable', QISHUI_NEEDS_DESKTOP, 'qishui');
    let result: QishuiBridgeAnswer;
    if (typeof window.electron?.qishuiRequest === 'function') {
        try { result = await window.electron.qishuiRequest(operation, params) as QishuiBridgeAnswer; }
        catch (error) { throw new OnlineProviderError('network', QISHUI_BRIDGE_FAILED, 'qishui', error); }
    } else {
        // Android：内置原生桥（nativeBridge/api/qishui.js 按同样的协议回答）。
        if (!isFoliaExtensionBridgeConfigured('extension')) {
            throw new OnlineProviderError('unavailable', QISHUI_NEEDS_DESKTOP, 'qishui');
        }
        try {
            result = await requestFoliaExtension<QishuiBridgeAnswer>({
                provider: 'qishui',
                operation,
                params,
            });
        } catch {
            throw new OnlineProviderError('network', QISHUI_ANDROID_FAILED, 'qishui');
        }
    }
    if (!result.ok) {
        const stage = STAGES.find(stage => stage === result.error.stage) ?? null;
        const upstreamCode = typeof result.error.upstreamCode === 'string' && /^\d{1,12}$/.test(result.error.upstreamCode) ? result.error.upstreamCode : undefined;
        const upstreamMessage = refusalSentence(result.error);
        if (isLoginOperation(operation)) lastFailure = { stage, code: result.error.code, upstreamCode, message: upstreamMessage };
        throw new QishuiRequestError(result.error.code, result.error.message, stage, upstreamCode, upstreamMessage);
    }
    return result.data as T;
}

// The image type the bytes themselves say, for the formats a scene icon comes in; null when they say none of them.
function sniffImageType(bytes: Uint8Array): string | null {
    const starts = (...head: number[]) => head.every((byte, index) => bytes[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

// Scene artwork is public CDN content; it is fetched without any account headers or cookies.
// The data URL carries the image's own type: the CDN's template decides the format, not the address.
export async function readQishuiSceneIcon(raw: string): Promise<string> {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(?:^|\.)douyinpic\.com$/.test(url.hostname) || url.username || url.password) {
        throw new Error('Invalid scene artwork URL');
    }
    const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    const declared = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!response.ok || !declared.startsWith('image/')) throw new Error('Scene artwork is unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 512 * 1024) throw new Error('Scene artwork is too large');
    const type = sniffImageType(bytes) ?? (RASTER_TYPES.has(declared) ? declared : null);
    if (!type) throw new Error('Scene artwork is not a raster image');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${type};base64,${btoa(binary)}`;
}
