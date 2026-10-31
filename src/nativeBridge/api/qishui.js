// Browser/Android port of qishui-music-api@0.2.2. The desktop package runs in the Electron main
// process and uses node:crypto; this implementation keeps the same operations, strings and
// response shapes, but signs with WebCrypto (crypto.subtle) and stores its account in localStorage.
// HTTP goes through the WebView's fetch, which the Android shell answers through FoliaNative.httpRequest.
import { noteLibraryStep } from './libraryTrace.js';

export const QISHUI_UA = 'LunaOpenSDK/1.0.10';
export const QISHUI_PREFIX = '/api/luna/v1/platform';
export const QISHUI_CLIENT_KEY = 'aw4bbxfujo741d09';
// md5('com.luna.music.car'), the app_identity the car SDK sends with its QR parameters.
export const QISHUI_APP_IDENTITY = '82a0737a3f8d93d9958c8a7938bbc365';
export const QISHUI_COMMON = {
  aid: '765213',
  app_id: '765213',
  app_name: 'byte_autoservice_lite',
  version_code: '100010',
  version_name: '1.0.10',
  channel: 'bydSong',
  sdk_aid: '753999',
  caller_name: 'luna_open_sdk',
  sdk_version_code: '100000100',
  sdk_version_name: '0.0.1',
  sdk_channel: 'Test',
  vehicle_type: 'BYD',
  device_brand: 'BYD',
  device_type: 'BYD',
  device_platform: 'android',
  resolution: '1920x1080',
  os_version: '13',
  ac: 'wifi',
};
export const SESSION_KEY = 'qishuiSessionV1';
export const DEVICE_KEY = 'qishuiDeviceId';

const REQUEST_TIMEOUT_MS = 25000;
const QR_TTL_MS = 5 * 60 * 1000;
const CURSOR_TTL_MS = 5 * 60 * 1000;
const CURSOR_PLAYLISTS = 32;
const PAGE_SIZE = 100;
const PAGE_LIMIT = 500;
const MAX_BATCH = 100;
const RETRYABLE_READS = new Set(['/search/', '/playlist/detail/', '/media/mget/', '/media/mcheck/',
  '/artist/detail/', '/artist/tracks/', '/feed/mode/', '/feed/song-tab/']);
const AUTH_CODES = [28001003, 28001007, 28001008, 10007];
const QISHUI_HOSTS = ['365yg.com', 'douyinvod.com', 'douyinscdn.com', 'bytefcdn.com', 'bytecdn.cn', 'byteicdn.com', 'ibytedtos.com',
  'pstatp.com', 'snssdk.com', 'bytedance.com', 'bytetos.com', 'volcvideo.com', 'volccdn.com', 'volces.com',
  'volcengineapi.com', 'douyin.com', 'qishui.com', 'zijieapi.com', 'zjcdn.com'];

// ── bytes and base64 ─────────────────────────────────────────────────────────

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const utf8Bytes = value => textEncoder.encode(String(value));

const concatBytes = (...chunks) => {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

const bytesToBase64 = (bytes) => {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const utf8ToBase64 = value => bytesToBase64(utf8Bytes(value));
const base64ToUtf8 = value => textDecoder.decode(base64ToBytes(value));

const hexToBytes = (value) => {
  const text = String(value || '');
  if (text.length % 2 !== 0) throw new Error('Invalid hex');
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

const randomBytes = (length) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const randomHex = length => Array.from(randomBytes(length), byte => byte.toString(16).padStart(2, '0')).join('');

const randomUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// ── DER / ECDSA ──────────────────────────────────────────────────────────────

/** One DER TLV: tag, a length (short, 0x81 or 0x82 form) and the concatenated values. */
export function der(tag, ...values) {
  const value = concatBytes(...values);
  const length = value.length < 128 ? Uint8Array.of(value.length)
    : value.length < 256 ? Uint8Array.of(0x81, value.length)
      : Uint8Array.of(0x82, value.length >> 8, value.length & 0xff);
  return concatBytes(Uint8Array.of(tag), length, value);
}

const derInteger = (bytes) => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  let body = bytes.subarray(start);
  if (body.length === 0) body = Uint8Array.of(0);
  // ASN.1 integers are signed: a leading bit set needs a 0x00 so it stays positive.
  if (body[0] & 0x80) body = concatBytes(Uint8Array.of(0), body);
  return der(0x02, body);
};

/** WebCrypto ECDSA answers raw r||s; PKCS#10 (and node:crypto) want a DER SEQUENCE of integers. */
export function ecdsaRawToDer(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== 64) {
    throw new QishuiError('invalid-response', 'Invalid Qishui signature');
  }
  return der(0x30, derInteger(raw.subarray(0, 32)), derInteger(raw.subarray(32)));
}

const guardAttribute = (id, value) => der(0x31, der(0x30,
  der(0x06, Uint8Array.of(0x55, 0x04, Number(id))),
  der(0x0c, utf8Bytes(value))));

/** subject = SEQUENCE of the three Attributes the car SDK sends (OID 2.5.4.x). */
export function buildGuardSubject() {
  return der(0x30, ...[
    [3, 'bd-ticket-guard'],
    [11, ''],
    [10, ''],
  ].map(([id, value]) => guardAttribute(id, value)));
}

/** CertificationRequestInfo: version, subject, SubjectPublicKeyInfo, empty attributes [0]. */
export function buildGuardInfo(spkiDer) {
  return der(0x30, der(0x02, Uint8Array.of(0)), buildGuardSubject(), spkiDer, der(0xa0));
}

/** Full CertificationRequest: info, ecdsa-with-SHA256 AlgorithmIdentifier, BIT STRING signature. */
export function buildCsrRequest(info, signatureDer) {
  const algorithm = der(0x30, der(0x06, hexToBytes('2a8648ce3d040302')));
  return der(0x30, info, algorithm, der(0x03, Uint8Array.of(0), signatureDer));
}

const pemFromBytes = (bytes, label) => {
  const base64 = bytesToBase64(bytes);
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
};

const guardKeyCache = new Map();

const importGuardKey = async (pem) => {
  const kept = guardKeyCache.get(pem);
  if (kept) return kept;
  const body = String(pem).replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', base64ToBytes(body).buffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  if (guardKeyCache.size >= 4) guardKeyCache.delete(guardKeyCache.keys().next().value);
  guardKeyCache.set(pem, key);
  return key;
};

/** A fresh P-256 key and PKCS#10 request for this Folia authorization (never a saved identity). */
export async function createQishuiGuard() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const info = buildGuardInfo(spki);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, info));
  const request = buildCsrRequest(info, ecdsaRawToDer(raw));
  return {
    guardKey: pemFromBytes(pkcs8, 'PRIVATE KEY'),
    // The service wants the CSR as base64(PEM), exactly like the package sends it.
    csr: utf8ToBase64(pemFromBytes(request, 'CERTIFICATE REQUEST')),
  };
}

export async function qishuiGuardHeaders(credential, path = '/me/info/') {
  for (const key of ['ticket', 'guardKey', 'guardCert', 'guardTsSign']) {
    if (typeof credential[key] !== 'string' || !credential[key] || credential[key].length > 16384) {
      throw new QishuiError('invalid-response', 'invalid guard credential');
    }
  }
  const key = await importGuardKey(credential.guardKey);
  const timestamp = Math.floor(Date.now() / 1000);
  const content = `ticket=${credential.ticket}&path=${QISHUI_PREFIX}${path}&timestamp=${timestamp}`;
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8Bytes(content)));
  return {
    'access-token': credential.ticket,
    'bd-ticket-guard-version': '1',
    'bd-ticket-guard-client-cert': credential.guardCert,
    'bd-ticket-guard-client-data': utf8ToBase64(JSON.stringify({
      ts_sign: credential.guardTsSign,
      req_content: 'ticket,path,timestamp',
      req_sign: bytesToBase64(ecdsaRawToDer(raw)),
      timestamp,
    })),
  };
}

export function readQishuiGuard(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 65536) throw new QishuiError('invalid-response', 'invalid guard response');
  const data = JSON.parse(base64ToUtf8(raw));
  for (const key of ['ticket', 'ts_sign', 'client_cert']) {
    if (typeof data[key] !== 'string' || !data[key] || data[key].length > 16384) {
      throw new QishuiError('invalid-response', 'invalid guard response');
    }
  }
  const cert = data.client_cert;
  return {
    ticket: data.ticket,
    guardTsSign: data.ts_sign,
    guardCert: cert.includes('-----BEGIN') ? utf8ToBase64(cert) : cert,
  };
}

export function qishuiCredentialExpiry(raw) {
  const value = Number(raw || 0);
  const expires = value > 1e12 ? value : value > 1e9 ? value * 1000 : value > 0 ? Date.now() + value * 1000 : Date.now() + 6 * 3600000;
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new QishuiError('invalid-response', 'invalid credential expiry');
  return new Date(expires);
}

// ── protocol parameters ──────────────────────────────────────────────────────

export const isAccountId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\x00-\x1f\x7f]/u.test(value);
export const isQishuiDeviceId = value => typeof value === 'string' && /^\d{19}$/.test(value);

export function createQishuiDeviceId() {
  const bytes = randomBytes(8);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return (value % 9000000000000000000n + 1000000000000000000n).toString();
}

export function qishuiParams(deviceId) {
  const nonce = randomBytes(2);
  return new URLSearchParams({
    ...QISHUI_COMMON,
    device_id: deviceId,
    did: deviceId,
    iid: deviceId,
    vehicle_id: `qishui-${deviceId}`,
    _timestamp: String(Math.floor(Date.now() / 1000)),
    _nonce: String((nonce[0] << 8) | nonce[1]),
  }).toString();
}

// ── session storage ──────────────────────────────────────────────────────────

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* memory only */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* memory only */ } },
};

/** The stored record, or null when it is not a complete car account. */
export function readSessionRecord(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.version !== 1 || !isAccountId(value.userId) || typeof value.ticket !== 'string' || !value.ticket
      || typeof value.guardKey !== 'string' || !value.guardKey || typeof value.guardCert !== 'string' || !value.guardCert
      || typeof value.guardTsSign !== 'string' || !value.guardTsSign || typeof value.accessCode !== 'string' || !value.accessCode
      || !Number.isFinite(value.expiresAt)) return null;
    return value;
  } catch {
    return null;
  }
}

export const serializeSession = value => JSON.stringify({ ...value, version: 1 });

function createSessionRepository() {
  let loaded = false;
  let current = null;
  let revision = 0;
  let deviceId = storage.get(DEVICE_KEY);
  if (!isQishuiDeviceId(deviceId)) {
    deviceId = createQishuiDeviceId();
    storage.set(DEVICE_KEY, deviceId);
  }
  return {
    deviceId,
    get revision() { return revision; },
    get() {
      if (!loaded) {
        loaded = true;
        current = readSessionRecord(storage.get(SESSION_KEY));
      }
      return current;
    },
    set(value) {
      loaded = true;
      current = { ...value, version: 1 };
      revision += 1;
      storage.set(SESSION_KEY, serializeSession(current));
    },
    clear() {
      loaded = true;
      current = null;
      revision += 1;
      storage.remove(SESSION_KEY);
    },
  };
}

// ── errors ───────────────────────────────────────────────────────────────────

export class QishuiError extends Error {
  constructor(code, message, upstreamCode, options) {
    super(message, options);
    this.name = 'QishuiError';
    this.code = code;
    this.upstreamCode = upstreamCode;
    /** @type {string | undefined} */
    this.stage = undefined;
  }
}

/** The error fields the renderer may see; anything else stays here. */
export function toBridgeError(error) {
  if (error instanceof QishuiError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.upstreamCode === undefined ? {} : { upstreamCode: error.upstreamCode }),
      ...(error.stage === undefined ? {} : { stage: error.stage }),
    };
  }
  return { code: 'invalid-response', message: 'Qishui operation failed' };
}

const log = message => console.info(message);
const warn = message => console.warn(message);

// ── HTTP client ──────────────────────────────────────────────────────────────

const timeoutSignal = () => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return controller.signal;
};

function checked(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new QishuiError('invalid-response', 'Invalid Qishui response');
  const code = Number(data.err_no ?? data.data?.error_code ?? 0);
  if (code) throw new QishuiError(AUTH_CODES.includes(code) ? 'auth-required' : 'unavailable', 'Qishui rejected the request', String(code));
  return data;
}

const mediaUrl = (raw) => {
  let url;
  try { url = new URL(raw); } catch { throw new QishuiError('invalid-response', 'Invalid Qishui media URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !QISHUI_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new QishuiError('invalid-response', 'Untrusted Qishui media host');
  }
  return url.href;
};

const mediaHost = (raw) => {
  try { return new URL(raw).hostname || 'unknown host'; } catch { return 'invalid URL'; }
};

function createClient({ sessions }) {
  let tokenEntry;

  async function http(url, { body, headers = {}, form = false } = {}) {
    let response;
    try {
      response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'user-agent': QISHUI_UA,
          ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }),
        credentials: 'omit',
        redirect: 'error',
        signal: timeoutSignal(),
        // The Android shell answers through FoliaNative.httpRequest; it otherwise stops at 15s.
        foliaTimeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (cause) {
      throw new QishuiError('network', 'Qishui service could not be reached', undefined, { cause });
    }
    if (!response.ok) {
      throw new QishuiError(response.status === 429 ? 'unavailable' : [401, 403].includes(response.status) ? 'auth-required' : 'network',
        `Qishui HTTP ${response.status}`);
    }
    try {
      return { data: checked(await response.json()), headers: response.headers };
    } catch (error) {
      if (error instanceof QishuiError) throw error;
      throw new QishuiError('invalid-response', 'Qishui response is not JSON', undefined, { cause: error });
    }
  }

  const query = (path, extras = {}, deviceId = sessions.deviceId) => {
    const values = new URLSearchParams(qishuiParams(deviceId));
    Object.entries(extras).forEach(([key, value]) => values.set(key, String(value)));
    return `${path}?${values}`;
  };

  const clientToken = () => {
    if (!tokenEntry) {
      const entry = {};
      entry.task = http(query(`https://open.qishui.com${QISHUI_PREFIX}/client/token/get/`, { trigger_type: 'cold_start' }))
        .then(({ data }) => {
          if (typeof data.client_token !== 'string' || !data.client_token) throw new QishuiError('invalid-response', 'Client token is missing');
          return data.client_token;
        })
        .catch((error) => {
          if (tokenEntry === entry) tokenEntry = undefined;
          throw error;
        });
      tokenEntry = entry;
    }
    return tokenEntry;
  };

  async function platform(path, body = {}, credential) {
    if (credential === true) {
      credential = sessions.get();
      if (!credential) throw new QishuiError('auth-required', 'Sign in to Qishui first');
    }
    const account = credential || sessions.get();
    const revision = sessions.revision;
    const request = async (headers) => {
      const { data } = await http(query(`https://open.douyin.com${QISHUI_PREFIX}${path}`, {}, account?.deviceId), {
        body: { ...body, common_params: { ...(account?.userId ? { user_id: account.userId } : {}) } },
        headers,
      });
      if (!data.data || typeof data.data !== 'object') throw new QishuiError('invalid-response', 'Qishui data is missing');
      return data.data;
    };
    // Ticket-guard failures belong to the account flow, not the public client token.
    if (credential) return request(await qishuiGuardHeaders(credential, path));
    let token = clientToken();
    for (let attempt = 0; ; attempt += 1) {
      const headers = { 'access-token': await token.task };
      if (attempt && revision !== sessions.revision) throw new QishuiError('unavailable', 'Qishui account changed during the request');
      try {
        return await request(headers);
      } catch (error) {
        if (!(error instanceof QishuiError) || error.upstreamCode !== '28001008') throw error;
        if (tokenEntry === token) tokenEntry = undefined;
        if (attempt || !RETRYABLE_READS.has(path)) throw error;
        token = tokenEntry || (token.replacement ||= clientToken());
      }
    }
  }

  // Account writes (collect/playlist/dislike) use the ticket-guard credential and may answer without data.
  async function command(path, body = {}) {
    const credential = sessions.get();
    if (!credential) throw new QishuiError('auth-required', 'Sign in to Qishui first');
    const { data } = await http(query(`https://open.douyin.com${QISHUI_PREFIX}${path}`, {}, credential.deviceId), {
      body: { ...body, common_params: { ...(credential.userId ? { user_id: credential.userId } : {}) } },
      headers: await qishuiGuardHeaders(credential, path),
    });
    return data.data && typeof data.data === 'object' ? data.data : {};
  }

  return { http, query, platform, command, sessions, log, warn };
}

// ── catalogue ────────────────────────────────────────────────────────────────

const arrayOf = (value, field) => {
  if (!Array.isArray(value)) throw new QishuiError('invalid-response', `Qishui ${field} is missing`);
  return value;
};

const publicTrack = (raw) => {
  const track = raw?.track_entity || raw?.entity?.media?.track_entity || raw?.entity?.track || raw?.track || raw;
  if (!track?.base_info?.id && !track?.id) throw new QishuiError('invalid-response', 'Qishui track identity is missing');
  // Player models may carry encryption material. Only catalogue and lyric data cross the bridge.
  return {
    id: String(track.base_info?.id || track.id),
    base_info: track.base_info,
    related_info: track.related_info,
    display_info: track.display_info,
    commerce_info: track.commerce_info,
  };
};

async function search(platform, query, type, limit, offset) {
  const items = [];
  const searchId = randomUuid();
  let cursor = offset;
  let more = false;
  while (items.length < limit) {
    const data = await platform('/search/', {
      q: query,
      cursor: String(cursor),
      search_id: searchId,
      from_search_id: searchId,
      search_method: 'input',
      search_type: type,
      search_scene: 'normal',
      scene_name: 'search',
      ab_param: '',
      last_viewed_media: {},
    });
    const groups = arrayOf(data.result_groups, 'search groups');
    const group = groups.find(value => value.id === `${type}s`) || groups[0];
    if (!group) break;
    const batch = arrayOf(group.data, 'search items').map(value => value.entity?.[type]).filter(Boolean);
    const remaining = limit - items.length;
    items.push(...batch.slice(0, remaining));
    more = batch.length > remaining || group.has_more === true;
    if (!batch.length || !more || items.length === limit) break;
    const next = Number(group.next_cursor);
    if (!Number.isSafeInteger(next) || next <= cursor) throw new QishuiError('invalid-response', 'Search cursor did not advance');
    cursor = next;
  }
  return { items: type === 'track' ? items.map(publicTrack) : items, hasMore: more && items.length > 0, nextOffset: offset + items.length };
}

// Playlist cursors are not row numbers, so an offset is reached by walking from the beginning.
async function playlistPage(platform, id, ownerId, limit, offset, marks, types = null) {
  let lineage = { cursor: '0' };
  let consumed = 0;
  for (const [position, mark] of marks?.positions || []) {
    if (position <= offset && position > consumed) { consumed = position; lineage = mark; }
  }
  let cursor = lineage.cursor;
  const seen = new Set();
  for (let ancestor = lineage; ancestor; ancestor = ancestor.previous) seen.add(ancestor.cursor);
  const items = [];
  let collection = consumed ? marks.collection : undefined;
  let hasMore = false;
  let pages = 0;
  while (items.length < limit && pages < PAGE_LIMIT) {
    pages += 1;
    seen.add(cursor);
    const data = await platform('/playlist/detail/', { playlist_id: id, owner_id: ownerId || '', count: PAGE_SIZE, cursor, type: types });
    collection ||= data.playlist;
    if (marks && cursor === '0') marks.collection = data.playlist;
    const batch = arrayOf(data.media_entities, 'playlist tracks');
    const start = Math.max(0, offset - consumed);
    const remaining = limit - items.length;
    items.push(...batch.slice(start, start + remaining).map(publicTrack));
    consumed += batch.length;
    const next = String(data.next_cursor ?? '');
    const upstreamMore = data.has_more === true;
    const unused = consumed > offset + items.length;
    hasMore = unused || upstreamMore;
    if (upstreamMore && seen.has(next)) throw new QishuiError('invalid-response', 'Playlist cursor did not advance');
    if (marks && upstreamMore && batch.length && next) {
      lineage = { cursor: next, previous: lineage };
      marks.positions.set(consumed, lineage);
    }
    if (!upstreamMore || items.length === limit) break;
    if (!batch.length || !next || seen.has(next)) throw new QishuiError('invalid-response', 'Playlist cursor did not advance');
    cursor = next;
  }
  if (pages >= PAGE_LIMIT && items.length < limit && hasMore) throw new QishuiError('invalid-response', 'Playlist page limit reached');
  return { items, collection, hasMore: hasMore && items.length > 0, nextOffset: offset + items.length };
}

function createPlaylistCursors(sessions, now = Date.now) {
  const entries = new Map();
  let account = null;
  const keyOf = (id, ownerId, types) => `${id}:${ownerId || ''}:${types ?? ''}`;
  return {
    get(id, ownerId, types) {
      const user = sessions?.get()?.userId || '';
      if (user !== account) { entries.clear(); account = user; }
      const key = keyOf(id, ownerId, types);
      let entry = entries.get(key);
      if (entry && now() - entry.at > CURSOR_TTL_MS) entry = undefined;
      entries.delete(key);
      entry ||= { at: now(), positions: new Map(), collection: undefined };
      entries.set(key, entry);
      while (entries.size > CURSOR_PLAYLISTS) entries.delete(entries.keys().next().value);
      return entry;
    },
    forget(id) { for (const key of [...entries.keys()]) if (id == null || key.startsWith(`${id}:`)) entries.delete(key); },
  };
}

function createCatalog({ platform, sessions }, { now } = {}) {
  const cursors = createPlaylistCursors(sessions, now);
  return {
    forgetPlaylist: id => cursors.forget(id),
    search: ({ query, limit, offset }) => search(platform, query, 'track', limit, offset),
    search_playlists: ({ query, limit, offset }) => search(platform, query, 'playlist', limit, offset),
    async track(id) {
      const data = await platform('/media/mget/', { media_list: [{ id, type: 'track' }], card_context: {} });
      const media = arrayOf(data.media_list, 'media list').find(item => String(item.media_id || item.track_entity?.base_info?.id) === id);
      if (!media?.track_entity) throw new QishuiError('not-playable', 'Qishui did not return the track');
      return media.track_entity;
    },
    async playlist_tracks({ id, ownerId, limit, offset, liked }) {
      const types = liked === true ? 1 : null;
      try { return await playlistPage(platform, id, ownerId, limit, offset, cursors.get(id, ownerId, types), types); }
      catch (error) { cursors.forget(id); throw error; }
    },
    async user_playlists({ limit, offset }) {
      const items = [];
      for (const [path, field, owned] of [['/me/playlist/', 'playlists', true], ['/me/collection/mixed/', 'mixed_collections', false]]) {
        let cursor = '';
        const seen = new Set();
        for (let page = 0; page < PAGE_LIMIT; page += 1) {
          seen.add(cursor);
          const data = await platform(path, { count: PAGE_SIZE, cursor, item_types: ['playlist'] }, true);
          const rows = data[field] ?? (path === '/me/playlist/' ? data.playlist_list : undefined);
          for (const row of arrayOf(rows, field)) {
            const playlist = row.playlist || row;
            if (playlist.base_info?.id) items.push({ ...playlist, isOwned: owned });
          }
          if (!data.has_more) break;
          const next = String(data.next_cursor ?? '');
          if (!next || seen.has(next) || !rows.length || page === PAGE_LIMIT - 1) throw new QishuiError('invalid-response', 'Account playlist cursor did not advance');
          cursor = next;
        }
      }
      const unique = [...new Map(items.map(item => [String(item.base_info.id), item])).values()];
      noteLibraryStep('qishui', 'playlists:read', { lists: unique.length,
        baseKeys: Object.keys(unique[0]?.base_info || {}).join(','),
        sample: unique.slice(0, 8).map(item => `${item.base_info?.name || ''}#${item.base_info?.type ?? ''}:${item.base_info?.track_count ?? item.base_info?.track_cnt ?? item.base_info?.media_count ?? ''}`).join(' | ') });
      return {
        items: unique.slice(offset, offset + limit),
        total: unique.length,
        nextOffset: offset + Math.min(limit, Math.max(0, unique.length - offset)),
        hasMore: offset + limit < unique.length,
      };
    },
    async artist_detail({ id }) { const data = await platform('/artist/detail/', { artist_id: id }); return data.artist_info; },
    async artist_songs({ id, limit, offset }) {
      const data = await platform('/artist/tracks/', { artist_id: id, count: 50, cursor: '0' });
      const tracks = arrayOf(data.tracks, 'artist tracks').map(publicTrack);
      return {
        items: tracks.slice(offset, offset + limit),
        total: tracks.length,
        nextOffset: Math.min(offset + limit, tracks.length),
        hasMore: offset + limit < tracks.length,
      };
    },
  };
}

// ── recommendation stream ────────────────────────────────────────────────────

function createFeed({ platform }) {
  const queues = new Map();
  let total = 0;
  let generation = 0;
  const activeKeys = new Map();
  let pending = Promise.resolve();
  return {
    clear() { generation += 1; queues.clear(); activeKeys.clear(); total = 0; },
    async modes() {
      const data = await platform('/feed/mode/');
      if (!Array.isArray(data.feed_mode_block)) throw new QishuiError('invalid-response', 'Qishui feed modes are missing');
      return data.feed_mode_block.flatMap(block => (block.feed_mode || []).flatMap((item) => {
        const mode = item.entity?.feed_mode;
        const id = mode?.scene_mode?.scene_mode_id;
        return id == null ? [] : [{ id: String(id), name: String(mode.text || ''), group: String(block.title || ''), coverUrl: mode.url_info }];
      }));
    },
    songs(options = {}) {
      const mine = generation;
      const run = async () => {
        if (mine !== generation) throw new QishuiError('unavailable', 'Qishui account changed');
        const { scene, preference, queue = 'fm', first = false, count = 20 } = options;
        if (preference != null && (typeof preference !== 'string' || !/^[a-z][a-z_]{0,31}$/.test(preference))) throw new QishuiError('invalid-response', 'Invalid preference');
        if (scene != null && preference) throw new QishuiError('invalid-response', 'Scene and preference are mutually exclusive');
        if (scene != null && (!/^\d+$/.test(String(scene)) || !Number.isSafeInteger(Number(scene)))) throw new QishuiError('invalid-response', 'Invalid scene');
        const key = `${queue}:${scene ?? preference ?? 'default'}`;
        if (queues.size > 100) queues.clear();
        const previous = queues.get(key);
        const state = first || !previous || activeKeys.get(queue) !== key ? { count: 0, selectedAt: Date.now() } : previous;
        const data = await platform('/feed/song-tab/', {
          played_media: [],
          is_first_request: state.count === 0,
          with_client_cache: state.count !== 0,
          is_did_first_request: false,
          count,
          feed_preference: {
            scene_mode_id: scene == null ? null : Number(scene),
            scene_mode_select_time: scene == null ? null : state.selectedAt,
            preference_mode: preference || null,
            total_request_count: ++total,
            preference_mode_request_count: state.count + 1,
            current_mode_request_count: state.count + 1,
          },
        });
        if (!Array.isArray(data.items)) throw new QishuiError('invalid-response', 'Qishui feed items are missing');
        if (mine !== generation) throw new QishuiError('unavailable', 'Qishui account changed');
        activeKeys.set(queue, key);
        state.count += 1;
        queues.set(key, state);
        return { items: data.items.filter(item => !item.type || item.type === 'track').map(publicTrack), hasMore: data.has_more === true };
      };
      const result = pending.then(run, run);
      pending = result.catch(() => {});
      return result;
    },
  };
}

// ── account library ──────────────────────────────────────────────────────────

const mediaId = (value) => {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new QishuiError('invalid-response', 'Invalid Qishui media ID');
  return value;
};

const mediaIds = (value) => {
  if (!Array.isArray(value) || value.length === 0) throw new QishuiError('invalid-response', 'Qishui media IDs are required');
  if (value.length > MAX_BATCH) throw new QishuiError('unsupported', `Select at most ${MAX_BATCH} tracks per operation`);
  return [...new Set(value.map(mediaId))];
};

const trackRef = id => ({ id, type: 'track' });
const pageOf = (items, hasMore, nextOffset) => ({ items, hasMore, nextOffset });

const boolean = (value) => {
  if (typeof value !== 'boolean') throw new QishuiError('invalid-response', 'Invalid Qishui boolean');
  return value;
};

const requiredList = (data, fields, label) => {
  const rows = fields.map(field => data?.[field]).find(Array.isArray);
  if (!rows) throw new QishuiError('invalid-response', `Qishui ${label} is missing`);
  return rows;
};

async function likedPlaylist(platform) {
  let cursor = '';
  const seen = new Set();
  for (let count = 0; count < 20; count += 1) {
    seen.add(cursor);
    const data = await platform('/me/playlist/', { count: PAGE_SIZE, cursor }, true);
    const rows = requiredList(data, ['playlists', 'playlist_list'], 'account playlists');
    for (const row of rows) {
      const playlist = row?.playlist || row || {};
      const base = playlist.base_info || {};
      if (Number(base.type) === 1 && base.id) {
        return { id: String(base.id), ownerId: String(base.owner_id || ''), type: Number(base.type),
          name: String(base.name || ''), tracks: Number(base.track_count ?? base.track_cnt ?? base.media_count ?? -1) };
      }
    }
    if (data.has_more !== true) return null;
    const next = String(data.next_cursor ?? '');
    if (!next || seen.has(next)) throw new QishuiError('invalid-response', 'Account playlist cursor did not advance');
    cursor = next;
  }
  throw new QishuiError('invalid-response', 'Account playlist page limit reached');
}

async function likedSongs(platform) {
  const liked = await likedPlaylist(platform);
  if (!liked) throw new QishuiError('invalid-response', 'Qishui liked playlist was not found');
  // 车机的「我喜欢」可能与消费端 App 不是同一份；留痕告诉报告取的是哪个歌单、它自称多少首。
  noteLibraryStep('qishui', 'liked:playlist', { id: liked.id, type: liked.type, name: liked.name,
    tracks: liked.tracks, owner: Boolean(liked.ownerId) });
  const ids = new Set();
  let cursor = '';
  let whole = false;
  const seen = new Set();
  for (let count = 0; count < PAGE_LIMIT; count += 1) {
    seen.add(cursor);
    const data = await platform('/playlist/detail/', {
      playlist_id: liked.id, owner_id: liked.ownerId, count: PAGE_SIZE, cursor, type: 1,
    });
    const media = requiredList(data, ['media_entities', 'media_list'], 'liked playlist tracks');
    for (const item of media) {
      const id = publicTrack(item).id;
      if (id) ids.add(id);
    }
    if (data.has_more !== true) { whole = true; break; }
    const next = String(data.next_cursor ?? '');
    if (!next || seen.has(next)) throw new QishuiError('invalid-response', 'Liked playlist cursor did not advance');
    cursor = next;
  }
  noteLibraryStep('qishui', 'liked:read', { ids: ids.size, whole, playlistTracks: liked.tracks });
  return { ids: [...ids], whole, total: ids.size };
}

async function recentPlayed(platform, limit, offset) {
  const items = [];
  let cursor = '';
  let consumed = 0;
  let hasMore = false;
  for (let count = 0; count < PAGE_LIMIT; count += 1) {
    const data = await platform('/me/recent-played/', {
      count: PAGE_SIZE, cursor, media_type: 'track', scene: 'me_tab',
    }, true);
    if (!Array.isArray(data.media) && data.has_more === true) throw new QishuiError('invalid-response', 'Qishui recent tracks are missing');
    const rows = Array.isArray(data.media) ? data.media : [];
    for (const row of rows) {
      const media = row?.media;
      if (!media?.track_entity) continue;
      const track = publicTrack(media);
      const rawPlayedAt = Number(row.play_start_timestamp);
      const playedAt = rawPlayedAt > 1e12 ? rawPlayedAt : rawPlayedAt * 1000;
      if (consumed >= offset && items.length < limit) {
        items.push({ ...track, ...(Number.isFinite(playedAt) && playedAt > 0 ? { playedAt } : {}) });
      }
      consumed += 1;
    }
    const upstreamMore = data.has_more === true;
    hasMore = consumed > offset + items.length || upstreamMore;
    if (!upstreamMore || items.length >= limit) break;
    const next = String(data.next_cursor ?? '');
    if (!next || next === cursor) throw new QishuiError('invalid-response', 'Recent-played cursor did not advance');
    cursor = next;
  }
  return pageOf(items, hasMore && items.length > 0, offset + items.length);
}

async function checkTracks(platform, ids) {
  const data = await platform('/media/mcheck/', { media_list: ids.map(trackRef) });
  const rows = Array.isArray(data.media_status_list) ? data.media_status_list : [];
  return {
    statuses: rows.map(row => ({
      id: String(row.id ?? ''),
      riskResult: Number(row.risk_info?.risk_result ?? -1),
      status: Number(row.risk_info?.status ?? 0),
    })),
  };
}

function createLibrary(client) {
  const { platform, command } = client;
  return {
    likedSongs: () => likedSongs(platform),
    recentPlayed: ({ limit = 30, offset = 0 }) => recentPlayed(platform, limit, offset),
    async checkTracks({ ids }) {
      return checkTracks(platform, mediaIds(ids));
    },
    async likeSong({ id, liked }) {
      const trackId = mediaId(id);
      if (boolean(liked)) {
        await command('/media/collect/', { media: [trackRef(trackId)], scene: '', collect_action: 1 });
      } else {
        await command('/media/cancel/collect/', { media: [trackRef(trackId)] });
      }
    },
    async editPlaylist({ operation, id, ids }) {
      const playlistId = mediaId(id);
      const tracks = mediaIds(ids);
      const path = operation === 'add' ? '/playlist/append/' : '/playlist/delete/';
      if (operation !== 'add' && operation !== 'remove') throw new QishuiError('unsupported', 'Unsupported playlist operation');
      await command(path, { playlist_id: playlistId, media: tracks.map(trackRef) });
    },
    async dislikeSong({ id, disliked }) {
      const trackId = mediaId(id);
      await command('/dislike/', {
        item_id: trackId, author_ids: [], dislike_item_type: 'track', action_type: boolean(disliked) ? 0 : 1,
      });
    },
  };
}

// ── playback ─────────────────────────────────────────────────────────────────

const LEVELS = { medium: 'standard', higher: 'high', highest: 'high', lossless: 'lossless', hi_res: 'hires' };
const rank = value => ['standard', 'high', 'lossless', 'hires'].indexOf(value);
const encrypted = item => Boolean(item.encrypt_info?.encrypt || item.encrypt_info?.spade_a || item.PlayAuth || Number(item.Encrypt || 0));
const encryptedAuth = item => String(
  item?.encrypt_info?.spade_a || item?.encrypt_info?.SpadeA
  || item?.PlayAuth || item?.play_auth || item?.spade_a || item?.SpadeA || '',
).trim();
const proxyEncryptedAudio = async (url, auth) => {
  const plugin = typeof window !== 'undefined' ? window.Capacitor?.Plugins?.FoliaQishuiAudio : null;
  if (!plugin || typeof plugin.proxy !== 'function' || !auth) return '';
  try {
    const result = await plugin.proxy({ url, auth });
    return result && result.url ? String(result.url) : '';
  } catch (error) {
    console.warn('[Qishui] encrypted audio proxy failed', error);
    return '';
  }
};

async function resolveAudio(client, track, requested) {
  const player = track.player_info;
  if (!player) throw new QishuiError('not-playable', 'Qishui returned no player information');
  const refused = new Set();
  const trusted = (raw) => {
    try { return mediaUrl(raw); } catch { refused.add(mediaHost(raw)); return null; }
  };
  const report = () => {
    if (refused.size) (client.warn || console.warn)(`[Qishui] Skipped untrusted media hosts: ${[...refused].join(', ')}`);
  };
  for (const variant of ['full', 'preview']) {
    const info = player[variant]?.video_model_info;
    if (!info) continue;
    const candidates = [];
    let encryptedCandidate = null;
    let skipped = false;
    const add = (raw, quality, bitrate) => {
      const url = trusted(raw);
      if (url) candidates.push({ url, quality: LEVELS[quality] || 'standard', bitrate: Number(bitrate || 0) });
      else skipped = true;
    };
    const addEncrypted = (raw, item, quality, bitrate) => {
      if (encryptedCandidate) return;
      const auth = encryptedAuth(item);
      if (!auth) return;
      const url = trusted(raw);
      if (url) encryptedCandidate = { url, auth, quality: LEVELS[quality] || 'standard', bitrate: Number(bitrate || 0) };
    };
    if (info.video_model) {
      let model;
      try { model = typeof info.video_model === 'string' ? JSON.parse(info.video_model) : info.video_model; }
      catch { throw new QishuiError('invalid-response', 'Invalid Qishui player model'); }
      for (const item of model.video_list || []) {
        if (!item.main_url) continue;
        if (encrypted(item)) {
          addEncrypted(item.main_url, item, item.video_meta?.quality, item.video_meta?.bitrate);
          continue;
        }
        add(item.main_url, item.video_meta?.quality, item.video_meta?.bitrate);
      }
    }
    if (!candidates.length && info.url_player_info) {
      const playInfo = trusted(info.url_player_info);
      if (playInfo) {
        const { data } = await client.http(playInfo);
        const list = data.Result?.Data?.PlayInfoList || data.data?.PlayInfoList || data.PlayInfoList;
        if (!Array.isArray(list)) throw new QishuiError('invalid-response', 'Qishui PlayInfoList is missing');
        for (const item of list) {
          if (!item.MainPlayUrl) continue;
          if (encrypted(item)) {
            addEncrypted(item.MainPlayUrl, item, item.Quality, item.Bitrate);
            continue;
          }
          add(item.MainPlayUrl, item.Quality, item.Bitrate);
        }
      } else skipped = true;
    }
    if (!candidates.length) {
      if (variant === 'full' && encryptedCandidate) {
        const proxyUrl = await proxyEncryptedAudio(encryptedCandidate.url, encryptedCandidate.auth);
        if (proxyUrl) {
          (client.log || console.info)(`[Qishui] Decrypted audio issued: quality=${encryptedCandidate.quality}`);
          return {
            url: proxyUrl,
            quality: encryptedCandidate.quality,
            fetchedAt: Date.now(),
            preview: false,
            decrypted: true,
          };
        }
      }
      if (skipped) { report(); throw new QishuiError('invalid-response', 'Untrusted Qishui media host'); }
      continue;
    }
    report();
    const allowed = candidates.filter(item => rank(item.quality) <= rank(requested));
    const source = (allowed.length ? allowed : candidates).sort((a, b) => rank(b.quality) - rank(a.quality) || b.bitrate - a.bitrate)[0];
    (client.log || console.info)(`[Qishui] Plaintext audio issued: quality=${source.quality} preview=${variant === 'preview'}`);
    const clipStartMs = variant === 'preview' ? Number(player.preview?.duration?.start_ms) : 0;
    return {
      url: source.url,
      quality: source.quality,
      fetchedAt: Date.now(),
      ...(Number(info.expire_at) > Date.now() / 1000 ? { expiresAt: Number(info.expire_at) * 1000 } : {}),
      preview: variant === 'preview',
      ...(Number.isFinite(clipStartMs) && clipStartMs > 0 ? { clipStartMs } : {}),
    };
  }
  // Only encrypted audio came back: there is no address Folia can play, and decryption is disabled.
  throw new QishuiError('unsupported', 'Qishui returned protected audio only; decryption is disabled');
}

// ── QR sign-in ───────────────────────────────────────────────────────────────

const qrParams = () => ({
  aid: '1128',
  client_key: QISHUI_CLIENT_KEY,
  scope: 'user_info,luna.openapi.platform.interaction,luna.openapi.platform.me_tab,luna.commerce.openapi_platform.vip_info',
  state: '',
  next: '',
  jump_type: 'native',
  optional_scope_check: '',
  optional_scope_uncheck: '',
  customize_params: '{"source":"pc_auth","not_skip_confirm":"true"}',
  source_from: 'native',
  device_platform: 'android',
  app_identity: QISHUI_APP_IDENTITY,
  signature: 'cf9024ea72d9c71813238b13ea107a3d',
});

function createAuth(client, { onSignOut = () => {} } = {}) {
  const pending = new Map();
  let generation = 0;
  let refreshing;
  const { http, query, platform, sessions } = client;
  const clean = () => { for (const [key, value] of pending) if (value.expires <= Date.now()) pending.delete(key); };
  const step = async (stage, run) => {
    try {
      return await run();
    } catch (error) {
      const failure = error instanceof QishuiError ? error : new QishuiError('invalid-response', 'Qishui sign-in response could not be read', undefined, { cause: error });
      failure.stage ||= stage;
      throw failure;
    }
  };
  const getUser = credential => step('account', async () => {
    const { my_info: user } = await platform('/me/info/', {}, credential);
    if (!isAccountId(user?.id)) throw new QishuiError('invalid-response', 'Qishui did not identify the account');
    return {
      id: String(user.id),
      nickname: String(user.nickname || ''),
      avatar: user.medium_avatar_url || user.avatar_url || user.thumb_avatar_url,
      isVip: user.is_vip === true,
    };
  });
  async function ticket(access, guard, deviceId) {
    if (!access.access_code) throw new QishuiError('invalid-response', 'Access code is missing');
    const response = await http(`https://open-client.douyin.com/passport/open/get_access_ticket/?${new URLSearchParams({ aid: '1128', client_key: QISHUI_CLIENT_KEY, device_platform: 'android' })}`, {
      body: { access_code: access.access_code, open_id: String(access.open_id || access.open_uid || '') },
      form: true,
      headers: { 'bd-ticket-guard-version': '1', ...(guard.csr ? { 'bd-ticket-guard-client-csr': guard.csr } : { 'bd-ticket-guard-client-cert': guard.guardCert }) },
    });
    return {
      deviceId,
      guardKey: guard.guardKey,
      ...readQishuiGuard(response.headers.get('bd-ticket-guard-server-data')),
      accessCode: access.access_code,
      openId: String(access.open_id || access.open_uid || ''),
      expiresAt: qishuiCredentialExpiry(access.expires_time).getTime(),
    };
  }
  async function renew() {
    const old = sessions.get();
    if (!old) return null;
    const revision = sessions.revision;
    const signOut = () => {
      if (revision !== sessions.revision) return;
      sessions.clear();
      onSignOut();
      log('[Qishui] Stored account was rejected; signed out');
    };
    try {
      let candidate = old;
      if (old.expiresAt < Date.now() + 3600000) {
        const result = await http(query(`https://open.qishui.com${QISHUI_PREFIX}/access/code/refresh/`, { access_code: old.accessCode }, old.deviceId));
        const access = result.data.data || result.data;
        candidate = await ticket({ ...access, open_id: access.open_id || access.open_uid || old.openId }, old, old.deviceId);
      }
      const user = await getUser(candidate);
      if (user.id !== old.userId) { signOut(); throw new QishuiError('auth-required', 'Qishui account identity changed'); }
      if (revision !== sessions.revision) return null;
      sessions.set({ ...candidate, userId: user.id, user });
      return user;
    } catch (error) {
      if (error instanceof QishuiError && error.code === 'auth-required' && error.upstreamCode) signOut();
      throw error;
    }
  }
  return {
    async start() {
      clean(); pending.clear();
      const mine = ++generation;
      const result = await http(`https://open.douyin.com/oauth/get_qrcode/?${new URLSearchParams(qrParams())}`);
      const data = result.data.data;
      if (!data?.token || !data.qrcode) throw new QishuiError('invalid-response', 'QR code is missing');
      if (mine !== generation) throw new QishuiError('unavailable', 'Sign-in was cancelled');
      const key = randomHex(16);
      pending.set(key, { token: data.token, qr: `data:image/png;base64,${data.qrcode}`, expires: Date.now() + QR_TTL_MS });
      log('[Qishui] Sign-in QR created');
      return { key };
    },
    qr(key) {
      clean();
      const value = pending.get(key);
      if (!value) throw new QishuiError('unavailable', 'QR session expired');
      return { imageUrl: value.qr };
    },
    async check(key) {
      clean();
      const value = pending.get(key);
      if (!value) return { state: 'expired' };
      if (value.task) return value.task;
      const revision = sessions.revision;
      const run = async () => {
        const result = await http(`https://open.douyin.com/oauth/check_qrcode/?${new URLSearchParams({ ...qrParams(), token: value.token, timestamp: String(Date.now()) })}`);
        const data = result.data.data;
        if (!data || !['new', 'scanned', 'confirmed', 'expired', 'refused'].includes(data.status)) throw new QishuiError('invalid-response', 'Invalid QR status');
        if (data.status !== 'confirmed') {
          if (['expired', 'refused'].includes(data.status)) pending.delete(key);
          return data.status === 'refused' ? { state: 'error', failure: { case: 'refused' } } : { state: data.status === 'new' ? 'waiting' : data.status };
        }
        const code = data.code || data.auth_code;
        if (!code) throw new QishuiError('invalid-response', 'QR authorization code is missing');
        const access = await step('access-code', () => http(query(`https://open.qishui.com${QISHUI_PREFIX}/access/code/get/`, { auth_code: code })));
        const credential = await step('ticket', async () => ticket(access.data.data || access.data, await createQishuiGuard(), sessions.deviceId));
        const user = await getUser(credential);
        if (pending.get(key) !== value || sessions.revision !== revision) return { state: 'expired' };
        sessions.set({ ...credential, userId: user.id, user });
        pending.delete(key);
        log('[Qishui] Sign-in confirmed; account stored');
        return { state: 'confirmed' };
      };
      value.task = run().finally(() => { value.task = undefined; });
      return value.task;
    },
    cancel(key) { pending.delete(key); },
    logout() { generation += 1; pending.clear(); sessions.clear(); log('[Qishui] Signed out'); },
    status() {
      if (!refreshing) refreshing = renew().finally(() => { refreshing = undefined; });
      return refreshing;
    },
  };
}

// ── public operations ────────────────────────────────────────────────────────

export const QISHUI_OPERATIONS = Object.freeze([
  'login_status', 'logout', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'login_qr_cancel',
  'search', 'search_playlists', 'song_detail', 'audio', 'lyrics', 'user_playlists', 'playlist_detail', 'playlist_tracks',
  'artist_detail', 'artist_songs', 'feed', 'feed_modes',
  'liked_songs', 'like_song', 'playlist_add_tracks', 'playlist_remove_tracks', 'recent_played', 'check_tracks', 'dislike_song',
]);

const idOf = (value) => {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new QishuiError('invalid-response', 'Invalid Qishui media ID');
  return value;
};

// 诊断留痕：安卓上汽水走的是车机协议，搜索/喜欢/歌单各返回多少条只有这里能看到。
const noteQishuiTrace = (operation, data) => {
  if (operation.startsWith('search')) {
    noteLibraryStep('qishui', 'bridge:result', { operation, items: Array.isArray(data?.items) ? data.items.length : 0, hasMore: Boolean(data?.hasMore) });
    return;
  }
  if (operation === 'liked_songs') {
    noteLibraryStep('qishui', 'bridge:result', { operation, ids: Array.isArray(data?.ids) ? data.ids.length : 0, whole: Boolean(data?.whole) });
    return;
  }
  if (operation === 'playlist_tracks' || operation === 'recent_played') {
    noteLibraryStep('qishui', 'bridge:result', { operation, items: Array.isArray(data?.items) ? data.items.length : 0, hasMore: Boolean(data?.hasMore) });
    return;
  }
  if (operation === 'playlist_detail') {
    const base = data?.base_info || data || {};
    noteLibraryStep('qishui', 'bridge:result', { operation, name: String(base.name || ''),
      tracks: Number(base.track_count ?? base.track_cnt ?? data?.trackCount ?? -1), type: Number(base.type ?? -1) });
    return;
  }
  if (operation === 'audio') {
    let host = '';
    try { host = new URL(String(data?.url || '')).host; } catch (_) { /* not a URL */ }
    noteLibraryStep('qishui', 'bridge:result', { operation, host, preview: Boolean(data?.preview) });
    return;
  }
  if (operation === 'login_status') {
    // 诊断：确认车机扫码登的是不是官方 App 同一个账号（昵称/尾部 id/会员），
    // 车机接口的喜欢/歌单可能属于另一个访问域，账号一致才能排除登错号。
    noteLibraryStep('qishui', 'bridge:result', { operation, signedIn: Boolean(data),
      nickname: String(data?.nickname || ''), idTail: String(data?.id || '').slice(-6), vip: data?.isVip === true });
  }
};

function createQishuiApi(sessions) {
  const client = createClient({ sessions });
  const catalog = createCatalog(client);
  const feed = createFeed(client);
  const auth = createAuth(client, { onSignOut: () => feed.clear() });
  const library = createLibrary(client);
  let observedRevision = sessions.revision;
  const nowUser = () => sessions.get()?.userId || null;
  // An account switch invalidates every queue and remembered page cursor of the account before it.
  const syncCaches = () => {
    if (sessions.revision === observedRevision) return;
    observedRevision = sessions.revision;
    feed.clear();
    catalog.forgetPlaylist();
  };
  return {
    async request(operation, raw = {}) {
      try {
        syncCaches();
        noteLibraryStep('qishui', 'bridge:request', { operation });
        if (!QISHUI_OPERATIONS.includes(operation)) throw new QishuiError('unsupported', 'Unsupported Qishui operation');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new QishuiError('invalid-response', 'Invalid Qishui parameters');
        const limit = Math.min(raw.limit ?? 30, 100);
        const offset = raw.offset ?? 0;
        if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0 || offset > 50000) throw new QishuiError('invalid-response', 'Invalid Qishui page');
        const p = { limit, offset };
        if (['song_detail', 'audio', 'lyrics', 'playlist_detail', 'playlist_tracks', 'artist_detail', 'artist_songs'].includes(operation)) p.id = idOf(raw.id);
        if (raw.ownerId && !isAccountId(raw.ownerId)) throw new QishuiError('invalid-response', 'Invalid Qishui owner ID');
        if (operation.startsWith('search')) {
          if (typeof raw.query !== 'string' || raw.query.length > 500) throw new QishuiError('invalid-response', 'Invalid Qishui search');
          p.query = raw.query.trim();
        }
        if (operation.startsWith('login_qr_') && operation !== 'login_qr_key'
          && (typeof raw.key !== 'string' || !/^[a-f0-9]{32}$/.test(raw.key))) throw new QishuiError('invalid-response', 'Invalid QR key');
        let data;
        const userId = nowUser();
        switch (operation) {
          case 'login_qr_key': data = await auth.start(); break;
          case 'login_qr_create': data = auth.qr(raw.key); break;
          case 'login_qr_check':
            data = await auth.check(raw.key);
            // A newly authorized account starts a fresh stream and invalidates guest reads in flight.
            if (data.state === 'confirmed') feed.clear();
            break;
          case 'login_qr_cancel': auth.cancel(raw.key); data = null; break;
          case 'login_status': data = await auth.status(); break;
          case 'logout': auth.logout(); feed.clear(); data = null; break;
          case 'song_detail': data = publicTrack(await catalog.track(p.id)); break;
          case 'lyrics': data = (await catalog.track(p.id)).display_info?.lyric_info || {}; break;
          case 'audio': {
            if (!['standard', 'high', 'lossless', 'hires'].includes(raw.quality)) throw new QishuiError('invalid-response', 'Invalid Qishui audio quality');
            data = await resolveAudio(client, await catalog.track(p.id), raw.quality);
            break;
          }
          case 'playlist_detail': case 'playlist_tracks':
            data = await catalog.playlist_tracks({ ...p, ownerId: raw.ownerId || '', liked: raw.liked === true });
            if (operation === 'playlist_detail') data = data.collection || null;
            break;
          case 'feed_modes': data = await feed.modes(); break;
          case 'feed':
            data = await feed.songs({
              scene: raw.scene,
              preference: raw.preference,
              queue: raw.queue === 'explore' ? 'explore' : 'fm',
              first: raw.first === true,
              count: limit,
            });
            break;
          case 'liked_songs': data = await library.likedSongs(); break;
          // Edits shift playlist rows, so remembered page cursors are dropped even if the edit fails.
          case 'like_song':
            try { await library.likeSong({ id: idOf(raw.id), liked: raw.liked }); } finally { catalog.forgetPlaylist(); }
            data = null;
            break;
          case 'playlist_add_tracks': case 'playlist_remove_tracks': {
            const id = idOf(raw.id);
            try { await library.editPlaylist({ operation: operation === 'playlist_add_tracks' ? 'add' : 'remove', id, ids: raw.ids }); }
            finally { catalog.forgetPlaylist(id); }
            data = null;
            break;
          }
          case 'recent_played': data = await library.recentPlayed({ limit, offset }); break;
          case 'check_tracks': data = await library.checkTracks({ ids: raw.ids }); break;
          case 'dislike_song':
            if (typeof raw.disliked !== 'boolean') throw new QishuiError('invalid-response', 'Invalid Qishui dislike');
            await library.dislikeSong({ id: idOf(raw.id), disliked: raw.disliked });
            data = null;
            break;
          default:
            data = p.query === '' ? { items: [], hasMore: false, nextOffset: offset } : await catalog[operation](p);
        }
        noteQishuiTrace(operation, data);
        if (!['logout', 'login_status', 'login_qr_check'].includes(operation) && nowUser() !== userId) {
          throw new QishuiError('unavailable', 'Qishui account changed during the request');
        }
        return { ok: true, data };
      } catch (error) {
        // Only safe protocol errors cross the bridge. Fetch exceptions may embed credential-bearing URLs.
        if (error instanceof QishuiError && typeof operation === 'string' && operation.startsWith('login')) {
          warn(`[Qishui] Sign-in operation failed: ${[error.code, error.stage, error.upstreamCode].filter(Boolean).join(' ')}`);
        }
        return { ok: false, error: toBridgeError(error) };
      }
    },
  };
}

let api = null;
const getApi = () => {
  if (!api) api = createQishuiApi(createSessionRepository());
  return api;
};

export async function handleQishuiRequest(operation, params = {}) {
  try {
    if (!QISHUI_OPERATIONS.includes(operation)) {
      return { ok: false, error: { code: 'unsupported', message: 'Unsupported Qishui operation' } };
    }
    return await getApi().request(operation, params);
  } catch (error) {
    // The error stays here; the renderer gets only the fixed sentence.
    warn(`[Qishui] Bridge request failed: ${operation} ${error instanceof QishuiError ? error.code : 'invalid-response'}`);
    return { ok: false, error: { code: 'invalid-response', message: 'Qishui operation failed' } };
  }
}
