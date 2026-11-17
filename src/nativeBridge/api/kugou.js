import CryptoJS from '../vendor/crypto-es.mjs';
import { noteLibraryStep } from './libraryTrace.js';
import { buildQrDataUrl } from './qrImage.js';
import { krcDecrypt } from '../../services/onlineMusic/kugou/krcDecrypt';
import {
  clearCookieCache,
  getKGCookie as readKGCookie,
  parseCookieString,
  parseKGCookieObject,
  saveProviderCookie,
  setBrowserCookies,
  kgCookieUserId,
  kgCookieToken,
  kgCookieWebToken,
  kgCookieNickname,
  kgCookieAvatar,
  kgCookieDfid,
  kgCookieVipType,
  kgCookieLoginPwd,
  kgCookieVipToken,
  kgCookieHasVipSession,
  analyzeKGCookieSession,
} from './cookies.js';

const KG_UA_MOBILE = 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Mobile Safari/537.36';
const KG_UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const KG_DEMO_UA = 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 KGMusic/9.3.0';
const KG_ANDROID_UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';
const KG_LITE_APPID = 3116;
const KG_LITE_CLIENTVER = 11440;
const KG_ANDROID_APPID = KG_LITE_APPID;
const KG_ANDROID_CLIENTVER = KG_LITE_CLIENTVER;
const KG_PLATFORM = 'lite';
const KG_PLATFORM_MIGRATION_KEY = 'kgPlatformMigration';
const KG_PLATFORM_MIGRATION_VERSION = 'lite-v1';
const KG_DEVICE_STORAGE_KEY = 'kgLiteDevice';
const KG_LOGIN_STORAGE_KEY = 'kgLoginPersist';

function buildKuGooCookieValue(patch) {
  const userId = String(patch.KugooID || patch.userid || '').trim();
  const token = String(patch.token || patch.t || '').trim();
  if (!userId || !token) return '';
  const parts = [`KugooID=${userId}`, `t=${token}`];
  if (patch.NickName) parts.push(`NickName=${patch.NickName}`);
  if (patch.pic) parts.push(`Pic=${patch.pic}`);
  if (patch.vip_type) parts.push(`vip_type=${patch.vip_type}`);
  if (patch.vip_token) parts.push(`vip_token=${patch.vip_token}`);
  return parts.join('&');
}

async function saveKGLoginPersist(patch) {
  const userId = String(patch.userid || patch.KugooID || '').trim();
  const token = String(patch.token || patch.t || '').trim();
  if (!userId || !token) return;
  const kuGoo = buildKuGooCookieValue(patch);
  const payload = {
    userid: userId,
    KugooID: userId,
    token,
    t: token,
    savedAt: Date.now(),
  };
  if (patch.NickName) payload.NickName = patch.NickName;
  if (patch.pic) payload.pic = patch.pic;
  if (patch.vip_type) payload.vip_type = String(patch.vip_type);
  if (patch.vip_token) payload.vip_token = String(patch.vip_token);
  if (patch.t1) payload.t1 = String(patch.t1);
  if (patch.KUGOU_API_PLATFORM) payload.KUGOU_API_PLATFORM = String(patch.KUGOU_API_PLATFORM);
  if (patch.KUGOU_API_GUID) payload.KUGOU_API_GUID = String(patch.KUGOU_API_GUID);
  if (patch.KUGOU_API_MID) payload.KUGOU_API_MID = String(patch.KUGOU_API_MID);
  if (patch.KUGOU_API_DEV) payload.KUGOU_API_DEV = String(patch.KUGOU_API_DEV);
  if (patch.KUGOU_API_MAC) payload.KUGOU_API_MAC = String(patch.KUGOU_API_MAC);
  if (patch.KUGOU_API_WEBGL) payload.KUGOU_API_WEBGL = String(patch.KUGOU_API_WEBGL);
  if (kuGoo) payload.KuGoo = kuGoo;
  try { await chrome.storage.local.set({ [KG_LOGIN_STORAGE_KEY]: payload }); } catch (_) {}
}

async function restoreKGLoginPersistIfNeeded() {
  let header = '';
  try { header = await getKGCookie(); } catch (_) {}
  if (kgCookieUserId(header) && kgCookieToken(header)) return false;
  let stored = null;
  try {
    const hit = await chrome.storage.local.get([KG_LOGIN_STORAGE_KEY]);
    stored = hit && hit[KG_LOGIN_STORAGE_KEY];
  } catch (_) {}
  const userId = String(stored && (stored.userid || stored.KugooID) || '').trim();
  const token = String(stored && (stored.token || stored.t) || '').trim();
  if (!userId || !token) return false;
  const cookiePatch = {
    ...buildKGDeviceCookiePatch(await getKGDeviceIdentity()),
    userid: userId,
    KugooID: userId,
    token,
    t: token,
  };
  if (stored.NickName) cookiePatch.NickName = stored.NickName;
  if (stored.pic) cookiePatch.pic = stored.pic;
  if (stored.vip_type) cookiePatch.vip_type = String(stored.vip_type);
  if (stored.vip_token) cookiePatch.vip_token = String(stored.vip_token);
  if (stored.t1) cookiePatch.t1 = String(stored.t1);
  if (stored.KUGOU_API_PLATFORM) cookiePatch.KUGOU_API_PLATFORM = String(stored.KUGOU_API_PLATFORM);
  if (stored.KUGOU_API_GUID) cookiePatch.KUGOU_API_GUID = String(stored.KUGOU_API_GUID);
  if (stored.KUGOU_API_MID) cookiePatch.KUGOU_API_MID = String(stored.KUGOU_API_MID);
  if (stored.KUGOU_API_DEV) cookiePatch.KUGOU_API_DEV = String(stored.KUGOU_API_DEV);
  if (stored.KUGOU_API_MAC) cookiePatch.KUGOU_API_MAC = String(stored.KUGOU_API_MAC);
  if (stored.KUGOU_API_WEBGL) cookiePatch.KUGOU_API_WEBGL = String(stored.KUGOU_API_WEBGL);
  const kuGoo = stored.KuGoo || buildKuGooCookieValue(cookiePatch);
  if (kuGoo) cookiePatch.KuGoo = kuGoo;
  try {
    await setBrowserCookies('https://www.kugou.com/', cookiePatch);
    await setBrowserCookies('https://m.kugou.com/', cookiePatch);
  } catch (_) {
    return false;
  }
  clearCookieCache();
  return true;
}

export async function ensureKGCookie() {
  clearCookieCache();
  let header = await getKGCookie();
  if (kgCookieUserId(header) && kgCookieToken(header)) return header;
  const restored = await restoreKGLoginPersistIfNeeded();
  if (!restored) return header;
  clearCookieCache();
  return getKGCookie();
}

async function persistKGLoginCookies(patch) {
  const kuGoo = buildKuGooCookieValue(patch);
  const cookiePatch = Object.assign(
    {},
    buildKGDeviceCookiePatch(await getKGDeviceIdentity()),
    patch || {},
  );
  if (kuGoo && !cookiePatch.KuGoo) cookiePatch.KuGoo = kuGoo;
  try {
    await setBrowserCookies('https://www.kugou.com/', cookiePatch);
    await setBrowserCookies('https://m.kugou.com/', cookiePatch);
  } catch (_) {}
  await saveProviderCookie('kg', cookiePatch);
  await saveKGLoginPersist(cookiePatch);
}
/** Official KuGouMusicApi song_url hardcoded clientver for /v5/url */
const KG_TRACKER_CLIENTVER = 11430;
const KG_SONG_PAGE_ID = 967177915;
const KG_SONG_PPID = '356753938,823673182,967485191';
const KG_SONG_PID = 411;
const KG_WEB_CLIENTVER = KG_ANDROID_CLIENTVER;
const KG_SRCAPPID = 2919;
const KG_QR_KEY_APPID = 1001;
const KG_ANDROID_SIGN_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
/**
 * 云盘 / 歌单服务的网关基址。
 *
 * 必须是**裸域名**：路由靠 `x-router: cloudlist.service.kugou.com` 这个头完成。
 * 以前这里带了 `/cloudlist.service` 前缀，而调用同时又发 router 头 —— 两个路由机制叠加，
 * 网关直接回 `404 openresty`（本机实测：带前缀 + router 头 → 404；裸路径 + router 头 → 200）。
 * 读接口侥幸没暴露，是因为它的候选列表里先试了裸域名。
 */
const KG_CLOUDLIST_GATEWAY = 'https://gateway.kugou.com';
const KG_CLOUDLIST_ROUTER = { 'x-router': 'cloudlist.service.kugou.com' };
const KG_PRODUCT_VIP_TYPE = { tvip: 6, vip: 6, svip: 33, qvip: 6, dvip: 6, mvip: 3 };
const KG_TRACKER_SECRET = '185672dd44712f60bb1736df5a377e82';
const KG_TRACKER_HOSTS = [
  'https://trackercdn.kugou.com',
  'https://trackercdnbj.kugou.com',
  'http://trackercdn.kugou.com',
  'http://trackercdnbj.kugou.com',
];
const KG_TRACKER_FAST_HOSTS = ['https://trackercdn.kugou.com', 'https://trackercdnbj.kugou.com'];
const KG_SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
const KG_PLAY_URL_CACHE_TTL_MS = 4 * 60 * 1000;
const KG_VIP_STORAGE_TTL_MS = 6 * 60 * 60 * 1000;
const KG_AUTH_REFRESH_TTL_MS = 50 * 60 * 1000;
// 缺 vip_token 时的重试间隔：取不到就每 5 分钟再试一次，而不是每一首都打一次登录接口。
const KG_VIP_TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let kgVipTokenRefreshAt = 0;
// 会员详情（/user/vip/detail）探测的限流：它比单次 login_by_token 更全，能同时认出标准版与概念版会员，
// 但不能每首歌都打一次。
const KG_USER_VIP_PROBE_INTERVAL_MS = 5 * 60 * 1000;
let kgUserVipProbeAt = 0;
// 取链失败时现场补领概念版每日 VIP 的限流：失败/被拒的日子不要每首歌都打一次领取接口。
const KG_CONCEPT_CLAIM_INTERVAL_MS = 10 * 60 * 1000;
let kgConceptClaimAt = 0;
// 单个登录网关的上限：一条不响应的线路不能把换取 vip_token 这件事整体拖住。
const KG_AUTH_REFRESH_BASE_DEADLINE_MS = 8000;
const KG_LOGIN_AES_KEY = 'c24f74ca2820225badc01946dba4fdf7';
const KG_LOGIN_AES_IV = 'adc01946dba4fdf7';
const KG_LITE_T2_KEY = 'fd14b35e3f81af3817a20ae7adae7020';
const KG_LITE_T2_IV = '17a20ae7adae7020';
const KG_LITE_T1_KEY = '5e4ef500e9597fe004bd09a46d8add98';
const KG_LITE_T1_IV = '04bd09a46d8add98';
const KG_RSA_MODULUS = BigInt(
  '0xc40a2d0da76511f3bb1cc2bbd3afbd8bea83b4d6b05b6c13eb8920c53f1af7679b32ba0d0edb843240ef1b836efed3ee240734c14c1399fd6594d16af22f52525d14d72e0155c6dcc8638d4f7bb94f3a0b1f4c29f991972f2a160a25eb0a9e724336be7f69bbd319ffab1c6dd8470b021dc434f3faba89f4a2a01b33bdbdd08b',
);
const KG_RSA_EXP = BigInt(65537);
const KG_RSA_KEY_BYTES = 128;
let kgMidCache = '';
let kgDeviceCache = null;
let kgPlatformMigrationPromise = null;
let kgSessionCache = { key: '', at: 0, session: null };
let kgVipSessionCache = {
  userId: '', vipType: 0, vipToken: '', vipLabel: '', expireTime: '', isVip: false,
  appToken: '', sourceToken: '', authAt: 0, at: 0,
};
let kgAuthRefreshPromise = null;
const kgPlayUrlCache = new Map();

function md5(text) {
  return CryptoJS.MD5(String(text || '')).toString();
}

function kgRandomString(len) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < (len || 16); i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function kgRandomHex(len) {
  const alphabet = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < (len || 16); i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function buildKGLiteDeviceIdentity() {
  const guid = (() => {
    try {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '').toUpperCase();
    } catch (_) {}
    return `${kgRandomHex(8)}-${kgRandomHex(4)}-4${kgRandomHex(3)}-${kgRandomHex(4)}-${kgRandomHex(12)}`.replace(/-/g, '');
  })();
  const mid = BigInt(`0x${md5(guid)}`).toString(10);
  const mac = Array.from({ length: 6 }, () => kgRandomHex(2)).join(':');
  return {
    platform: KG_PLATFORM,
    guid,
    mid,
    dev: kgRandomHex(10),
    mac,
    webgl: BigInt(`0x${kgRandomHex(16)}`).toString(10),
  };
}

async function loadKGDeviceIdentity() {
  if (kgDeviceCache) return kgDeviceCache;
  try {
    const stored = await chrome.storage.local.get([KG_DEVICE_STORAGE_KEY]);
    const candidate = stored && stored[KG_DEVICE_STORAGE_KEY];
    if (candidate && candidate.guid && candidate.mid && candidate.dev && candidate.mac && candidate.webgl) {
      kgDeviceCache = { ...candidate, platform: KG_PLATFORM };
      return kgDeviceCache;
    }
  } catch (_) {}
  kgDeviceCache = buildKGLiteDeviceIdentity();
  try { await chrome.storage.local.set({ [KG_DEVICE_STORAGE_KEY]: kgDeviceCache }); } catch (_) {}
  return kgDeviceCache;
}

async function getKGDeviceIdentity(cookieHeader) {
  await ensureKGLitePlatformMigration();
  const device = await loadKGDeviceIdentity();
  const parsed = parseCookieString(cookieHeader || '');
  return {
    platform: KG_PLATFORM,
    guid: String(parsed.KUGOU_API_GUID || device.guid),
    mid: String(parsed.KUGOU_API_MID || device.mid),
    dev: String(parsed.KUGOU_API_DEV || device.dev),
    mac: String(parsed.KUGOU_API_MAC || device.mac),
    webgl: String(parsed.KUGOU_API_WEBGL || device.webgl),
  };
}

function buildKGDeviceCookiePatch(device) {
  return {
    KUGOU_API_PLATFORM: device.platform,
    KUGOU_API_GUID: device.guid,
    KUGOU_API_MID: device.mid,
    KUGOU_API_DEV: device.dev,
    KUGOU_API_MAC: device.mac,
    KUGOU_API_WEBGL: device.webgl,
  };
}

const KG_COOKIE_URLS = ['https://www.kugou.com/', 'https://m.kugou.com/', 'https://kugou.com/'];
const KG_LEGACY_COOKIE_KEYS = [
  'userid', 'token', 'KugooID', 'KuGoo', 'Kugoo', 'NickName', 'nickname', 'dfid', 'DFID',
  'KToken', 't', 't1', 'KugooPwd', 'vip_type', 'vip_token', 'VIPType', 'VipType', 'musicvip',
  'MusicPack', 'musicpack', 'is_vip', 'IsVIP', 'isVIP', 'su_vip', 'm_type', 'y_type', 'music_vip',
  'VipLevel', 'vip_level', 'vip_endtime', 'vip_end_time', 'su_vip_end_time', 'm_end_time',
];

async function clearLegacyKugouPlatformSession() {
  try {
    await Promise.all(KG_COOKIE_URLS.flatMap(url => KG_LEGACY_COOKIE_KEYS.map(name => (
      chrome.cookies.remove({ url, name }).catch(() => null)
    ))));
  } catch (_) {}
  try {
    await chrome.storage.local.remove([
      KG_LOGIN_STORAGE_KEY,
      KG_DEVICE_STORAGE_KEY,
      'kgMid',
      'kgVipSession',
      'foliaBridgeKgCookie',
    ]);
  } catch (_) {}
  try {
    [
      'online_provider:kugou:cookie',
      'online_provider:kugou:token',
      'online_provider:kugou:userid',
      'online_provider:kugou:dfid',
      'online_provider:kugou:vip_token',
      'online_provider:kugou:vip_type',
    ].forEach(key => localStorage.removeItem(key));
  } catch (_) {}
  clearCookieCache();
  kgMidCache = '';
  kgDeviceCache = null;
  kgSessionCache = { key: '', at: 0, session: null };
  kgVipSessionCache = {
    userId: '', vipType: 0, vipToken: '', vipLabel: '', expireTime: '', isVip: false,
    appToken: '', sourceToken: '', authAt: 0, at: 0,
  };
  kgAuthRefreshPromise = null;
  kgVipTokenRefreshAt = 0;
  kgPlayUrlCache.clear();
}

async function ensureKGLitePlatformMigration() {
  if (kgPlatformMigrationPromise) return kgPlatformMigrationPromise;
  kgPlatformMigrationPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get([KG_PLATFORM_MIGRATION_KEY]);
      if (stored && stored[KG_PLATFORM_MIGRATION_KEY] === KG_PLATFORM_MIGRATION_VERSION) return;
    } catch (_) {
      try {
        if (localStorage.getItem(KG_PLATFORM_MIGRATION_KEY) === KG_PLATFORM_MIGRATION_VERSION) return;
      } catch (_) {}
    }
    noteLibraryStep('kugou', 'platform:migration:start', { from: 'legacy', to: KG_PLATFORM });
    await clearLegacyKugouPlatformSession();
    try {
      await chrome.storage.local.set({ [KG_PLATFORM_MIGRATION_KEY]: KG_PLATFORM_MIGRATION_VERSION });
    } catch (_) {
      try { localStorage.setItem(KG_PLATFORM_MIGRATION_KEY, KG_PLATFORM_MIGRATION_VERSION); } catch (_) {}
    }
    noteLibraryStep('kugou', 'platform:migration:done', { platform: KG_PLATFORM });
  })().finally(() => {
    kgPlatformMigrationPromise = null;
  });
  return kgPlatformMigrationPromise;
}

async function getKGCookie() {
  await ensureKGLitePlatformMigration();
  return readKGCookie();
}

function kgModPow(base, exp, mod) {
  let result = BigInt(1);
  let b = base % mod;
  let e = exp;
  while (e > BigInt(0)) {
    if (e % BigInt(2) === BigInt(1)) result = (result * b) % mod;
    b = (b * b) % mod;
    e /= BigInt(2);
  }
  return result;
}

function kgAesEncryptHex(data, key, iv) {
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data || '');
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(key),
    { iv: CryptoJS.enc.Utf8.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  );
  return CryptoJS.enc.Hex.stringify(encrypted.ciphertext);
}

function kgAesEncryptParams(data) {
  const tempKey = kgRandomString(16);
  const key = md5(tempKey).substring(0, 32);
  const iv = key.substring(16);
  return { str: kgAesEncryptHex(data == null ? {} : data, key, iv), key: tempKey };
}

function kgAesDecryptParams(hex, tempKey) {
  const key = md5(String(tempKey || '')).substring(0, 32);
  const iv = key.substring(16);
  const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(String(hex || '')) });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, CryptoJS.enc.Utf8.parse(key), {
    iv: CryptoJS.enc.Utf8.parse(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const text = decrypted.toString(CryptoJS.enc.Utf8);
  try { return JSON.parse(text); } catch (_) { return text; }
}

function kgRsaEncryptRaw(data) {
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data || '');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > KG_RSA_KEY_BYTES) throw new Error('KG_RSA_OVERFLOW');
  const padded = new Uint8Array(KG_RSA_KEY_BYTES);
  padded.set(bytes);
  let x = BigInt(0);
  for (let i = 0; i < padded.length; i++) x = (x << BigInt(8)) + BigInt(padded[i]);
  const y = kgModPow(x, KG_RSA_EXP, KG_RSA_MODULUS);
  return y.toString(16).padStart(KG_RSA_KEY_BYTES * 2, '0');
}

function buildKGAuthHeaders(token) {
  token = String(token || '').trim();
  if (!token) return {};
  return { Authorization: `KugooToken ${token}` };
}

async function loadKGVipSessionCache(userId) {
  userId = String(userId || '').trim();
  if (!userId) return null;
  if (kgVipSessionCache.userId === userId && (Date.now() - kgVipSessionCache.at) < KG_VIP_STORAGE_TTL_MS) {
    return kgVipSessionCache;
  }
  try {
    const stored = await chrome.storage.local.get(['kgVipSession']);
    const data = stored && stored.kgVipSession;
    if (data && String(data.userId || '') === userId && (Date.now() - Number(data.at || 0)) < KG_VIP_STORAGE_TTL_MS) {
      kgVipSessionCache = {
        userId,
        vipType: Number(data.vipType) || 0,
        vipToken: String(data.vipToken || ''),
        vipLabel: String(data.vipLabel || ''),
        expireTime: String(data.expireTime || ''),
        appToken: String(data.appToken || ''),
        sourceToken: String(data.sourceToken || ''),
        authAt: Number(data.authAt) || 0,
        isVip: !!data.isVip,
        at: Number(data.at) || Date.now(),
      };
      return kgVipSessionCache;
    }
  } catch (_) {}
  return null;
}

async function clearKGVipAppToken(userId) {
  userId = String(userId || '').trim();
  if (!userId) return;
  const prev = await loadKGVipSessionCache(userId);
  if (!prev || !prev.appToken) return;
  const next = Object.assign({}, prev, { appToken: '', sourceToken: '', authAt: 0, at: Date.now() });
  kgVipSessionCache = next;
  try { await chrome.storage.local.set({ kgVipSession: next }); } catch (_) {}
}

async function saveKGVipSessionCache(userId, patch) {
  userId = String(userId || '').trim();
  if (!userId || !patch) return;
  const prev = (await loadKGVipSessionCache(userId)) || {
    userId, vipType: 0, vipToken: '', vipLabel: '', expireTime: '', isVip: false, appToken: '', sourceToken: '', authAt: 0, at: 0,
  };
  const next = {
    userId,
    vipType: Number(patch.vipType) || prev.vipType || 0,
    vipToken: String(patch.vipToken != null && patch.vipToken !== '' ? patch.vipToken : (prev.vipToken || '')),
    vipLabel: String(patch.vipLabel || prev.vipLabel || ''),
    expireTime: String(patch.expireTime || prev.expireTime || ''),
    appToken: String(patch.appToken != null && patch.appToken !== '' ? patch.appToken : (prev.appToken || '')),
    sourceToken: String(patch.sourceToken != null ? patch.sourceToken : (prev.sourceToken || '')),
    authAt: Number(patch.authAt) || prev.authAt || 0,
    isVip: !!(patch.isVip || prev.isVip || Number(patch.vipType) > 0 || prev.vipToken || patch.vipToken),
    at: Date.now(),
  };
  if (!next.isVip && next.vipToken) next.isVip = true;
  if (next.isVip && !next.vipType) next.vipType = 6;
  if (next.isVip && !next.vipLabel) next.vipLabel = 'VIP';
  kgVipSessionCache = next;
  try { await chrome.storage.local.set({ kgVipSession: next }); } catch (_) {}
  return next;
}

/** Drop cached android token when web cookie was re-login'd / changed. */
async function syncKGVipCacheWithCookie(cookieHeader) {
  const userId = kgCookieUserId(cookieHeader);
  const cookieToken = kgCookieWebToken(cookieHeader) || kgCookieToken(cookieHeader);
  if (!userId || !cookieToken) return null;
  const cached = await loadKGVipSessionCache(userId);
  if (!cached) return null;
  if (cached.sourceToken && cached.sourceToken !== cookieToken && cached.appToken && cached.appToken !== cookieToken) {
    await clearKGVipAppToken(userId);
    return loadKGVipSessionCache(userId);
  }
  return cached;
}

function harvestKGVipToken(payload, depth) {
  if (!payload || depth > 4) return '';
  if (typeof payload === 'string') return '';
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const hit = harvestKGVipToken(item, (depth || 0) + 1);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof payload !== 'object') return '';
  const direct = String(
    payload.vip_token || payload.vipToken || payload.VipToken || payload.viptoken ||
    payload.VIPToken || payload.vip_key || '',
  ).trim();
  if (direct) return direct;
  for (const key of ['data', 'info', 'user_vip', 'userVip', 'vip', 'detail', 'result']) {
    if (payload[key]) {
      const hit = harvestKGVipToken(payload[key], (depth || 0) + 1);
      if (hit) return hit;
    }
  }
  return '';
}

async function enrichKGCookieHeader(cookieHeader, opts) {
  opts = opts || {};
  cookieHeader = String(cookieHeader || '');
  const userId = kgCookieUserId(cookieHeader);
  const fromCookieToken = kgCookieWebToken(cookieHeader) || kgCookieToken(cookieHeader);
  const fromCookieVipToken = kgCookieVipToken(cookieHeader);
  const fromCookieVipType = kgCookieVipType(cookieHeader);
  const cached = userId ? await syncKGVipCacheWithCookie(cookieHeader) : null;
  const appToken = (cached && cached.appToken) || '';
  // Default: keep web cookie token. Android cloudlist/VIP need preferAppToken + appToken.
  const preferApp = !!opts.preferAppToken;
  const token = (preferApp && appToken) ? appToken : fromCookieToken;
  const vipToken = fromCookieVipToken || (cached && cached.vipToken) || '';
  const vipType = fromCookieVipType || (cached && cached.vipType) || 0;
  const parts = [];
  const devicePatch = buildKGDeviceCookiePatch(await getKGDeviceIdentity(cookieHeader));
  Object.entries(devicePatch).forEach(([key, value]) => {
    if (!new RegExp(`(?:^|;)\\s*${key}=`, 'i').test(cookieHeader)) parts.push(`${key}=${value}`);
  });
  if (userId && !/(?:^|;\s*)userid=/i.test(cookieHeader)) parts.push(`userid=${userId}`);
  if (userId && !/(?:^|;\s*)KugooID=/i.test(cookieHeader)) parts.push(`KugooID=${userId}`);
  // Append last so kgCookieToken (tail-scan) prefers chosen token / vip_token.
  if (token) {
    parts.push(`token=${token}`);
    parts.push(`t=${token}`);
  }
  if (vipToken) parts.push(`vip_token=${vipToken}`);
  if (vipType > 0) parts.push(`vip_type=${vipType}`);
  return parts.length ? `${cookieHeader}${cookieHeader ? '; ' : ''}${parts.join('; ')}` : cookieHeader;
}

async function refreshKGLoginByToken(cookieHeader) {
  cookieHeader = String(cookieHeader || '');
  const userId = kgCookieUserId(cookieHeader);
  // Always use raw web/KuGoo token as refresh input (never use cached android appToken).
  const token = kgCookieWebToken(cookieHeader) || kgCookieToken(cookieHeader);
  if (!userId || !token) return null;
  const dateNow = Date.now();
  const clienttime = Math.floor(dateNow / 1000);
  let encryptParams;
  let bodyData;
  try {
    encryptParams = kgAesEncryptParams({});
    const device = await getKGDeviceIdentity(cookieHeader);
    const cookie = parseCookieString(cookieHeader);
    const t2 = kgAesEncryptHex(
      `${device.guid}|0f607264fc6318a92b9e13c65db7cd3c|${device.mac}|${device.dev}|${dateNow}`,
      KG_LITE_T2_KEY,
      KG_LITE_T2_IV,
    );
    const t1 = kgAesEncryptHex(
      `${cookie.t1 || ''}|${dateNow}`,
      KG_LITE_T1_KEY,
      KG_LITE_T1_IV,
    );
    bodyData = {
      dfid: kgCookieDfid(cookieHeader) || '-',
      p3: kgAesEncryptHex({ clienttime, token }, KG_LOGIN_AES_KEY, KG_LOGIN_AES_IV),
      plat: 1,
      t1,
      t2,
      t3: 'MCwwLDAsMCwwLDAsMCwwLDA=',
      pk: kgRsaEncryptRaw({ clienttime_ms: dateNow, key: encryptParams.key }),
      params: encryptParams.str,
      userid: userId,
      clienttime_ms: dateNow,
      dev: device.dev,
    };
  } catch (_) {
    return null;
  }
  // 走 gateway 而不是明文 http://login.user.kugou.com：后者在部分移动网络上会一直不响应
  //（报告里表现为 auth:vip-token:refresh 之后就没有下文），而 gateway.kugou.com 证书正常，
  // 带上 x-router 指向 login.user.kugou.com 就等价，实测 0.3s 返回。
  // https://login.user.kugou.com 的证书只覆盖 *.kugou.com，三层域名必然校验失败，只留作兜底。
  const bases = [
    { base: 'https://gateway.kugou.com', headers: { 'x-router': 'login.user.kugou.com' } },
    { base: 'http://login.user.kugou.com', headers: {} },
  ];
  for (const entry of bases) {
    const base = entry.base;
    const refreshStartedAt = Date.now();
    const refreshHost = (() => { try { return new URL(base).host; } catch (_) { return base; } })();
    noteLibraryStep('kugou', 'auth:refresh:request', { host: refreshHost });
    try {
      // Prefer web cookie — do not inject stale appToken into login_by_token.
      const body = await Promise.race([
        kgPostAndroidSigned(base, '/v5/login_by_token', cookieHeader, bodyData, {}, entry.headers, { preferAppToken: false }),
        new Promise((resolve) => setTimeout(() => resolve(null), KG_AUTH_REFRESH_BASE_DEADLINE_MS)),
      ]);
      if (!body) {
        noteLibraryStep('kugou', 'auth:refresh:timeout', { host: refreshHost, ms: Date.now() - refreshStartedAt });
        continue;
      }
      const bodyStatus = Number(body && body.status) || 0;
      noteLibraryStep('kugou', 'auth:refresh:attempt', {
        host: refreshHost,
        ms: Date.now() - refreshStartedAt,
        status: bodyStatus,
        errCode: Number(body && (body.error_code || body.errcode)) || undefined,
      });
      if (!body || bodyStatus !== 1) continue;
      let data = body.data || {};
      // 会员字段(VIP token / vip_type)在 secu_params 里加密下发，解密失败会看着像「账号没有会员」，
      // 所以把解密形态与字段名记进报告——只记字段名，不记值。
      if (data.secu_params) {
        const decrypted = kgAesDecryptParams(data.secu_params, encryptParams.key);
        if (decrypted && typeof decrypted === 'object') {
          data = Object.assign({}, data, decrypted);
          noteLibraryStep('kugou', 'auth:refresh:secu', { kind: 'object', keys: Object.keys(decrypted).slice(0, 16).join(',') });
        } else if (typeof decrypted === 'string' && decrypted) {
          data.token = decrypted;
          noteLibraryStep('kugou', 'auth:refresh:secu', { kind: 'string' });
        } else {
          noteLibraryStep('kugou', 'auth:refresh:secu', { kind: 'failed' });
        }
      } else {
        noteLibraryStep('kugou', 'auth:refresh:secu', {
          kind: 'absent',
          keys: Object.keys(data).slice(0, 16).join(','),
        });
      }
      const nextToken = String(data.token || data.t || '').trim();
      const vipToken = String(data.vip_token || data.vipToken || '').trim();
      const vipType = Number(data.vip_type || data.vipType || 0) || 0;
      // 概念版会员不一定下发 vip_token / vip_type：同一份 data 里的 is_vip、svip_level、到期时间
      // 同样能说明是不是会员；认不出来就会把概念版会员当免费账号，高音质和 VIP 曲目取不到链。
      const isVipFlag = data.is_vip === true || Number(data.is_vip) === 1
        || Number(data.svip_level) > 0
        || Number(data.su_vip_end_time) > Date.now()
        || (Number(data.vip_begin_time) > 0
          && Number(data.m_end_time || data.vip_end_time || data.su_vip_end_time || 0) > Date.now());
      const effectiveVipType = vipType || (vipToken ? 6 : (isVipFlag ? 6 : 0));
      // 标准版刷新拿不到会员字段时，再问一次概念版的畅听 VIP：概念版会员只在这里能认出来。
      let conceptVipType = 0;
      if (!vipToken && effectiveVipType === 0) {
        try {
          conceptVipType = kgConceptVipTypeOf(await getKGYouthUnionVip(cookieHeader));
        } catch (error) {
          noteLibraryStep('kugou', 'auth:refresh:concept-vip:error', { message: error instanceof Error ? error.message : String(error) });
        }
      }
      const resolvedVipType = effectiveVipType || conceptVipType;
      if (!resolvedVipType && !vipToken) {
        noteLibraryStep('kugou', 'auth:refresh:concept-vip:miss', {
          hasVipToken: !!vipToken,
          vipFlag: isVipFlag,
          conceptVipType,
        });
      }
      if (!nextToken && !vipToken) continue;
      // Never overwrite browser web token with android token — only persist vip fields.
      try {
        const cookiePatch = {};
        if (data.t1) cookiePatch.t1 = String(data.t1);
        if (vipToken) cookiePatch.vip_token = vipToken;
        if (vipType) cookiePatch.vip_type = String(vipType);
        if (Object.keys(cookiePatch).length) await setBrowserCookies('https://www.kugou.com/', cookiePatch);
      } catch (_) {}
      await saveKGVipSessionCache(userId, {
        appToken: nextToken || '',
        sourceToken: token,
        vipToken,
        vipType: resolvedVipType,
        isVip: !!(resolvedVipType > 0 || vipToken || isVipFlag),
        vipLabel: resolvedVipType === 33 || resolvedVipType === 4 ? '超级VIP' : (resolvedVipType ? 'VIP' : ''),
        authAt: Date.now(),
      });
      noteLibraryStep('kugou', 'auth:refresh:ok', {
        host: refreshHost,
        hasVipToken: !!vipToken,
        vipType: resolvedVipType,
        vipFlag: isVipFlag,
        conceptVipType,
        dataKeys: Object.keys(data || {}).slice(0, 20).join(','),
      });
      return {
        token: nextToken || token,
        vipToken,
        vipType,
        userId: String(data.userid || userId),
        raw: data,
      };
    } catch (error) {
      noteLibraryStep('kugou', 'auth:refresh:error', {
        host: refreshHost,
        ms: Date.now() - refreshStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  noteLibraryStep('kugou', 'auth:refresh:fail');
  return null;
}

async function ensureKGAndroidAuth(cookieHeader, opts) {
  opts = opts || {};
  cookieHeader = String(cookieHeader || '');
  const userId = kgCookieUserId(cookieHeader);
  const cookieToken = kgCookieWebToken(cookieHeader) || kgCookieToken(cookieHeader);
  if (!userId || !cookieToken) {
    return { cookieHeader, vipToken: '', token: '', refreshed: false, hasAppToken: false };
  }
  await syncKGVipCacheWithCookie(cookieHeader);
  const cached = await loadKGVipSessionCache(userId);
  const vipToken = resolveKGEffectiveVipToken(cookieHeader, cached);
  const appToken = (cached && cached.appToken) || '';
  const sourceOk = !cached || !cached.sourceToken || cached.sourceToken === cookieToken;
  const authFresh = cached && cached.authAt && (Date.now() - Number(cached.authAt)) < KG_AUTH_REFRESH_TTL_MS;
  const preferApp = !!opts.requireAppToken || !!opts.preferAppToken;
  // Reuse android token for same web session (playlists + VIP both need it for appid=1005 APIs).
  if (!opts.force && preferApp && appToken && sourceOk && (authFresh || !!vipToken)) {
    const enriched = await enrichKGCookieHeader(cookieHeader, { preferAppToken: true });
    return {
      cookieHeader: enriched,
      vipToken,
      token: appToken,
      refreshed: false,
      hasAppToken: true,
    };
  }
  if (!opts.force && !preferApp) {
    const enriched = await enrichKGCookieHeader(cookieHeader, { preferAppToken: false });
    return { cookieHeader: enriched, vipToken, token: cookieToken, refreshed: false, hasAppToken: !!appToken };
  }
  if (!kgAuthRefreshPromise) {
    kgAuthRefreshPromise = refreshKGLoginByToken(cookieHeader)
      .finally(() => { kgAuthRefreshPromise = null; });
  }
  const refreshed = await kgAuthRefreshPromise;
  const nextCached = await loadKGVipSessionCache(userId);
  const nextApp = (nextCached && nextCached.appToken) || '';
  const enriched = await enrichKGCookieHeader(cookieHeader, {
    preferAppToken: !!nextApp,
  });
  return {
    cookieHeader: enriched,
    vipToken: resolveKGEffectiveVipToken(enriched, nextCached),
    token: nextApp || cookieToken,
    refreshed: !!refreshed,
    hasAppToken: !!nextApp,
    auth: refreshed,
  };
}

export function resolveKGEffectiveVipToken(cookieHeader, cached) {
  return kgCookieVipToken(cookieHeader) || (cached && cached.vipToken) || '';
}

function buildKGRequestHeaders(cookieHeader, token) {
  return Object.assign(
    { Cookie: cookieHeader || '' },
    buildKGAuthHeaders(token || kgCookieToken(cookieHeader)),
  );
}

function mapKGUserCenterVipType(vipTypeRaw) {
  const t = Number(vipTypeRaw) || 0;
  if (t === 4) return 33;
  if (t === 7) return 3;
  if (t === 2) return 6;
  return t;
}
/**
 * 概念版会员探测（/v1/get_union_vip，busi_type=concept）的答复里读出会员档位。
 * 标准版看 vip_token/vip_type，概念版的畅听 VIP 只在这里能认出来；认不出来就按免费账号取链。
 */
export function kgConceptVipTypeOf(body) {
  const data = (body && body.data) || body || {};
  const direct = Number(data.vip_type || data.vipType || 0) || 0;
  if (direct > 0) return mapKGUserCenterVipType(direct);
  if (data.is_vip === true || Number(data.is_vip) === 1) return 6;
  const business = Array.isArray(data.busi_vip) ? data.busi_vip : [];
  return business.some((entry) => Number(entry && (entry.is_vip || entry.vip_type)) > 0) ? 6 : 0;
}

function kgApiBodyOk(body) {
  if (!body || typeof body !== 'object') return false;
  if (Number(body.status) === 1) return true;
  if (Number(body.error_code) === 0 && body.data) return true;
  if (Number(body.errcode) === 0 && body.data) return true;
  return !!(body.data && typeof body.data === 'object' && (body.userid || body.data.userid || body.data.vip_type != null));
}

function parseKGUserCenterVipEnd(data) {
  const raw = data.vip_endtime || data.vip_end_time || data.su_vip_end_time || data.m_end_time || '';
  if (!raw) return { endMs: 0, hasEnd: false };
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    return { endMs: num > 1e11 ? num : num * 1000, hasEnd: true };
  }
  const endMs = Date.parse(String(raw).replace(/-/g, '/'));
  return { endMs: Number.isFinite(endMs) ? endMs : 0, hasEnd: Number.isFinite(endMs) };
}

function formatKGExpireTime(endMs) {
  if (!endMs || endMs <= 0) return '';
  return new Date(endMs).toISOString().slice(0, 19).replace('T', ' ');
}

function parseKGUserCenterVip(data) {
  if (!data || typeof data !== 'object') {
    return { vipType: 0, isVip: false, vipLabel: '', expireTime: '' };
  }
  // Official responses often keep vip_type=0 and put real membership in busi_vip / m_type / su_vip.
  const extracted = extractKGVipFromPayload(data);
  const meta = resolveKGVipMeta(data);
  let vipType = Number(extracted.vipType) || 0;
  let isVip = !!(extracted.isVip || meta.vipLabel);
  let vipLabel = meta.vipLabel || '';
  let expireTime = meta.expireTime || '';

  if (!isVip) {
    let vipTypeRaw = Number(data.vip_type || data.vipType || 0) || 0;
    if (!vipTypeRaw) {
      if (Number(data.su_vip) > 0) vipTypeRaw = 4;
      else if (Number(data.m_type) > 0) vipTypeRaw = 7;
      else if (Number(data.y_type) > 0 || Number(data.music_vip) > 0) vipTypeRaw = 2;
      else if (Number(data.is_vip) === 1 || Number(data.MusicPack) === 1) vipTypeRaw = 2;
    }
    const mapped = mapKGUserCenterVipType(vipTypeRaw);
    const { endMs, hasEnd } = parseKGUserCenterVipEnd(data);
    if (vipTypeRaw > 0 && (!hasEnd || endMs > Date.now())) {
      isVip = true;
      vipType = Math.max(vipType, mapped || 6);
      expireTime = expireTime || formatKGExpireTime(endMs);
      if (!vipLabel) {
        if (vipTypeRaw === 4) vipLabel = '超级VIP';
        else if (vipTypeRaw === 7) vipLabel = '音乐包';
        else if (vipTypeRaw === 2) vipLabel = '豪华VIP';
        else vipLabel = 'VIP';
      }
    }
  }

  if (isVip && !vipType) vipType = 6;
  if (isVip && !vipLabel) vipLabel = 'VIP';
  return { vipType, isVip, vipLabel, expireTime };
}

function parseKGUserCenterBody(body) {
  if (!kgApiBodyOk(body)) return null;
  const data = body.data || body;
  if (!data || typeof data !== 'object') return null;
  const vip = parseKGUserCenterVip(data);
  return {
    ...vip,
    nickname: stripKGHighlightHtml(data.nickname || data.nick_name || data.username || ''),
    avatar: normalizeKGCover(data.pic || data.user_pic || data.avatar || '', 180),
    detail: data,
  };
}

function signatureKGAndroidParams(params, data) {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('');
  return md5(`${KG_ANDROID_SIGN_SALT}${paramsString}${data || ''}${KG_ANDROID_SIGN_SALT}`);
}

const KG_WEB_SIGN_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

function signatureKGWebParams(params) {
  const paramsString = Object.keys(params)
    .map((key) => `${key}=${params[key]}`)
    .sort()
    .join('');
  return md5(`${KG_WEB_SIGN_SALT}${paramsString}${KG_WEB_SIGN_SALT}`);
}

/** Lean cookie for signed android APIs — avoid huge KuGoo blob breaking gateway requests. */
function buildKGLeanCookie(cookieHeader) {
  const parsed = parseCookieString(cookieHeader);
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader) || '-';
  const vipToken = kgCookieVipToken(cookieHeader);
  const parts = [];
  if (userId) {
    parts.push(`userid=${userId}`);
    parts.push(`KugooID=${userId}`);
  }
  if (token) {
    parts.push(`token=${token}`);
    parts.push(`t=${token}`);
  }
  if (dfid && dfid !== '-') parts.push(`dfid=${dfid}`);
  if (vipToken) parts.push(`vip_token=${vipToken}`);
  if (parsed.t1) parts.push(`t1=${parsed.t1}`);
  ['KUGOU_API_PLATFORM', 'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC', 'KUGOU_API_WEBGL']
    .forEach(key => {
      if (parsed[key]) parts.push(`${key}=${parsed[key]}`);
    });
  return parts.join('; ');
}

async function kgFetchAndroidSigned(baseURL, urlPath, cookieHeader, extraParams, extraHeaders, opts) {
  opts = opts || {};
  extraParams = extraParams || {};
  extraHeaders = extraHeaders || {};
  cookieHeader = await enrichKGCookieHeader(cookieHeader, opts);
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) return null;
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader) || '-';
  const clienttime = Math.floor(Date.now() / 1000);
  const leanCookie = buildKGLeanCookie(cookieHeader);
  const params = Object.assign({
    dfid,
    mid,
    uuid: '-',
    appid: KG_ANDROID_APPID,
    clientver: KG_ANDROID_CLIENTVER,
    clienttime,
    token,
    userid: userId,
  }, extraParams);
  params.signature = signatureKGAndroidParams(params);
  const qs = Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const url = `${String(baseURL || '').replace(/\/$/, '')}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}?${qs}`;
  return kgFetchJSON(url, {
    mobile: true,
    referer: 'https://www.kugou.com/',
    headers: Object.assign({
      Cookie: leanCookie,
      'User-Agent': KG_ANDROID_UA,
      dfid: String(dfid),
      clienttime: String(clienttime),
      mid: String(mid),
      'kg-rc': '1',
      'kg-thash': '5d816a0',
      'kg-rec': '1',
      'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    }, buildKGAuthHeaders(token), extraHeaders),
  });
}

async function kgPostAndroidSigned(baseURL, urlPath, cookieHeader, bodyData, extraParams, extraHeaders, opts) {
  opts = opts || {};
  extraParams = extraParams || {};
  extraHeaders = extraHeaders || {};
  cookieHeader = await enrichKGCookieHeader(cookieHeader, opts);
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) return null;
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader) || '-';
  const clienttime = Math.floor(Date.now() / 1000);
  const leanCookie = buildKGLeanCookie(cookieHeader);
  // rawBody：加密体（AES 串）要按原样发出去、也按原样进签名（JSON.stringify 会多一层引号）。
  const bodyJson = bodyData === undefined
    ? ''
    : (opts.rawBody ? String(bodyData) : JSON.stringify(bodyData || {}));
  const params = Object.assign({
    dfid,
    mid,
    uuid: '-',
    appid: KG_ANDROID_APPID,
    clientver: KG_ANDROID_CLIENTVER,
    clienttime,
    token,
    userid: userId,
  }, extraParams);
  params.signature = signatureKGAndroidParams(params, bodyJson);
  const qs = Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const url = `${String(baseURL || '').replace(/\/$/, '')}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}?${qs}`;
  const request = {
    mobile: true,
    method: 'POST',
    referer: 'https://www.kugou.com/',
    headers: Object.assign({
      Cookie: leanCookie,
      'User-Agent': KG_ANDROID_UA,
      'Content-Type': 'application/json',
      dfid: String(dfid),
      clienttime: String(clienttime),
      mid: String(mid),
      'kg-rc': '1',
      'kg-thash': '5d816a0',
      'kg-rec': '1',
      'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    }, buildKGAuthHeaders(token), extraHeaders),
    body: bodyJson,
  };
  // 云盘系列的响应体是 AES 加密的二进制（responseType: arraybuffer），要按字节取再解密。
  if (opts.responseBytes) return await kgFetchBytes(url, request);
  // trace 透传下去：kgFetchJSON 在响应不是 JSON 时会把状态码与原文头部记进留痕。
  return kgFetchJSON(url, Object.assign({ trace: opts.trace }, request));
}

/**
 * KuGouMusicApi `/youth/union/vip`.
 *
 * This is the concept-client VIP probe used by the upstream PC build before it attempts the
 * daily listen-song reward. The response itself may report either an existing VIP or no VIP.
 */
export async function getKGYouthUnionVip(cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  noteLibraryStep('kugou', 'youth:union:start');
  const body = await kgFetchAndroidSigned(
    'https://kugouvip.kugou.com',
    '/v1/get_union_vip',
    cookieHeader,
    {
      appid: KG_LITE_APPID,
      clientver: KG_LITE_CLIENTVER,
      busi_type: 'concept',
      opt_product_types: 'dvip,qvip',
      product_type: 'svip',
    },
    {},
  );
  const unionData = (body && body.data) || {};
  noteLibraryStep('kugou', 'youth:union:done', {
    status: body && body.status,
    errorCode: body && body.error_code,
    // 只记字段名不记值：概念版会员字段在不同版本里换过名字，报告要能看出实际下发的是哪些。
    dataKeys: Object.keys(unionData).slice(0, 20).join(','),
    busiVip: Array.isArray(unionData.busi_vip) ? unionData.busi_vip.length : 0,
  });
  return body || { status: 0, error_code: 401, data: {} };
}

/**
 * KuGouMusicApi `/youth/day/vip`.
 *
 * Claims the one-day listen-song VIP reward. `receive_day` is the China-calendar date used by
 * the official client; the server rejects a second claim for the same day.
 */
export async function claimKGYouthDayVip(cookieHeader, receiveDay) {
  cookieHeader = cookieHeader || await getKGCookie();
  noteLibraryStep('kugou', 'youth:day:start', { receiveDay: String(receiveDay || '') });
  const body = await kgPostAndroidSigned(
    'https://gateway.kugou.com',
    '/youth/v1/recharge/receive_vip_listen_song',
    cookieHeader,
    undefined,
    {
      appid: KG_LITE_APPID,
      clientver: KG_LITE_CLIENTVER,
      source_id: 90139,
      receive_day: String(receiveDay || ''),
    },
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );
  noteLibraryStep('kugou', 'youth:day:done', {
    status: body && body.status,
    errorCode: body && body.error_code,
  });
  return body || { status: 0, error_code: 401, data: {} };
}

/**
 * KuGouMusicApi `/youth/day/vip/upgrade`.
 *
 * The upstream PC build sends `ad_type=1` after the listen-song reward. This is the server-side
 * step that promotes the temporary listen entitlement so the normal playback endpoints accept it.
 */
export async function upgradeKGYouthDayVip(cookieHeader, userId) {
  cookieHeader = cookieHeader || await getKGCookie();
  const resolvedUserId = String(userId || kgCookieUserId(cookieHeader) || '').trim();
  if (!resolvedUserId) return { status: 0, error_code: 401, data: {} };
  noteLibraryStep('kugou', 'youth:upgrade:start', { userId: resolvedUserId.slice(0, 6) });
  const body = await kgPostAndroidSigned(
    'https://gateway.kugou.com',
    '/youth/v1/listen_song/upgrade_vip_reward',
    cookieHeader,
    undefined,
    {
      appid: KG_LITE_APPID,
      clientver: KG_LITE_CLIENTVER,
      kugouid: Number(resolvedUserId) || resolvedUserId,
      ad_type: 1,
    },
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );
  noteLibraryStep('kugou', 'youth:upgrade:done', {
    status: body && body.status,
    errorCode: body && body.error_code,
  });
  return body || { status: 0, error_code: 401, data: {} };
}

let kgFavoriteListIdCache = { key: '', listId: '', at: 0 };

function kgCloudlistOk(body) {
  if (!body || typeof body !== 'object') return false;
  const status = Number(body.status);
  const err = Number(body.error_code);
  if (status === 1) return true;
  if (err === 0 && status !== 0) return true;
  return false;
}

function extractKGCloudLists(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.data)) return body.data;
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const candidates = [
    data && data.info,
    data && data.files,
    data && data.songs,
    data && data.list,
    data && data.lists,
    data && data.playlist,
    data && data.playlists,
    data && data.list_info,
    data && data.listInfo,
    data && data.info_list,
    data && data.collection_list,
    data && data.collections,
    data && data.data && data.data.info,
    data && data.data && data.data.list,
    data && data.data && data.data.files,
    body.info,
    body.list,
    body.lists,
    body.files,
  ];
  for (const item of candidates) {
    if (Array.isArray(item) && item.length) return item;
  }
  for (const item of candidates) {
    if (Array.isArray(item)) return item;
  }
  return [];
}

function kgPlaylistSongCount(item) {
  item = item || {};
  return Number(item.count || item.song_count || item.songcount || item.count_total || item.total
    || item.song_num || item.trackCount || item.track_count || 0) || 0;
}

function isKGFavoriteName(name) {
  return /我喜欢|默认收藏|红心|^favorite$/i.test(String(name || ''));
}

/** Prefer 「我喜欢」 with songs over empty legacy 「默认收藏」. */
function scoreKGFavoriteList(item) {
  if (!item) return -1;
  const name = String(item.name || item.listname || item.specialname || item.list_name || '');
  const count = kgPlaylistSongCount(item);
  let score = 0;
  if (/^我喜欢$/i.test(name.trim())) score += 1000;
  else if (/我喜欢/.test(name)) score += 800;
  else if (Number(item.is_favorite) === 1) score += 700;
  else if (Number(item.is_default) === 1) score += 500;
  else if (/默认收藏|红心|^favorite$/i.test(name)) score += 300;
  else if (String(kgPlaylistListId(item)) === '2' && Number(item.type) !== 1) score += 200;
  else return -1;
  score += Math.min(500, count);
  return score;
}

function pickKGFavoriteList(lists) {
  const arr = Array.isArray(lists) ? lists : [];
  let best = null;
  let bestScore = -1;
  arr.forEach((item) => {
    const score = scoreKGFavoriteList(item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });
  return best;
}

function kgPlaylistListId(item) {
  item = item || {};
  const direct = item.listid ?? item.list_id ?? item.global_list_id ?? item.listId;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  const globalId = String(item.global_collection_id || item.globalCollectionId || item.gid || '').trim();
  // collection_{type}_{userid}_{listid}_{x}
  const m = globalId.match(/^collection_\d+_\d+_(\d+)_\d+$/i);
  if (m) return m[1];
  return '';
}

function kgPlaylistGlobalId(item) {
  item = item || {};
  return String(item.global_collection_id || item.globalCollectionId || item.gid || '').trim();
}

async function resolveKGSongMetaForFavorite(hash, albumId, albumAudioId, name, cookieHeader) {
  hash = String(hash || '').trim().toLowerCase();
  albumId = String(albumId || '').trim();
  albumAudioId = String(albumAudioId || '').trim();
  name = String(name || '').trim();
  if (!hash) return null;
  if (albumAudioId && name) return { hash, albumId, albumAudioId, name };
  try {
    const info = await fetchKGPlayInfo(hash, albumAudioId, cookieHeader);
    if (info && typeof info === 'object') {
      if (!name) name = String(info.songName || info.songname || info.filename || '').trim();
      if (!albumId) albumId = String(info.albumid || info.album_id || info.albumId || '').trim();
      if (!albumAudioId) albumAudioId = String(info.mixsongid || info.album_audio_id || info.audio_id || info.albumAudioId || '').trim();
    }
  } catch (_) {}
  if (!name) name = hash;
  return { hash, albumId, albumAudioId, name };
}

async function fetchKGFavoriteListId(cookieHeader, forceRefresh) {
  const cacheKey = buildKGSessionCacheKey(cookieHeader);
  if (!forceRefresh && kgFavoriteListIdCache.key === cacheKey && kgFavoriteListIdCache.listId && (Date.now() - kgFavoriteListIdCache.at) < KG_SESSION_CACHE_TTL_MS) {
    return kgFavoriteListIdCache.listId;
  }
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) return '';
  let listId = '';
  try {
    const fetched = await fetchKGUserPlaylistOfficial(cookieHeader, 1, 100);
    const fav = pickKGFavoriteList(fetched.lists || []);
    listId = String(kgPlaylistListId(fav) || '').trim();
  } catch (_) {}
  if (!listId) {
    for (const listType of [2, 0]) {
      try {
        const body = await kgPostAndroidSigned(
          'https://gateway.kugou.com',
          '/v7/get_all_list',
          cookieHeader,
          { userid: userId, token, total_ver: 979, type: listType, page: 1, pagesize: 50 },
          { plat: 1, userid: Number(userId) || userId, token },
          KG_CLOUDLIST_ROUTER,
        );
        const fav = pickKGFavoriteList(extractKGCloudLists(body));
        listId = String(kgPlaylistListId(fav) || '').trim();
        if (listId) break;
      } catch (_) {}
    }
  }
  if (!listId) return '';
  kgFavoriteListIdCache = { key: cacheKey, listId, at: Date.now() };
  return listId;
}

async function fetchKGFavoriteFileId(cookieHeader, hash, albumAudioId) {
  hash = String(hash || '').trim().toLowerCase();
  if (!hash) return '';
  const listId = await fetchKGFavoriteListId(cookieHeader);
  if (!listId) return '';
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY,
    '/v2/get_list_all_file',
    cookieHeader,
    { listid: Number(listId) || listId, page: 1, pagesize: 300, type: 0 },
    {},
    KG_CLOUDLIST_ROUTER,
  );
  const tracks = extractKGCloudLists(body);
  const hit = (Array.isArray(tracks) ? tracks : []).find((item) => {
    const itemHash = String(item.hash || item.FileHash || item.HASH || '').trim().toLowerCase();
    const mixId = String(item.mixsongid || item.album_audio_id || item.AlbumAudioID || item.MixSongID || '');
    if (itemHash && itemHash === hash) return true;
    return albumAudioId && mixId && mixId === String(albumAudioId);
  });
  return String((hit && (hit.fileid || hit.file_id || hit.id)) || '');
}

export async function handleKGSongLikeCheck(ids, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const liked = {};
  const login = await getKGPlayContext(cookieHeader);
  if (!login.loggedIn) return { provider: 'kg', error: 'LOGIN_REQUIRED', loggedIn: false, liked, ids };
  const listId = await fetchKGFavoriteListId(cookieHeader);
  if (!listId) {
    (ids || []).forEach((id) => { liked[id] = false; });
    return { provider: 'kg', loggedIn: true, ids, liked };
  }
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY,
    '/v2/get_list_all_file',
    cookieHeader,
    { listid: Number(listId) || listId, page: 1, pagesize: 500, type: 0 },
    {},
    KG_CLOUDLIST_ROUTER,
  );
  const tracks = extractKGCloudLists(body);
  const hashSet = new Set((Array.isArray(tracks) ? tracks : []).map((item) => String(item.hash || item.FileHash || item.HASH || '').trim().toLowerCase()).filter(Boolean));
  const mixSet = new Set((Array.isArray(tracks) ? tracks : []).map((item) => String(item.mixsongid || item.album_audio_id || item.MixSongID || '')).filter(Boolean));
  (ids || []).forEach((id) => {
    const raw = String(id || '').trim();
    const lower = raw.toLowerCase();
    liked[id] = hashSet.has(lower) || mixSet.has(raw);
  });
  return { provider: 'kg', loggedIn: true, ids, liked };
}

export async function handleKGSongLike(hash, albumId, albumAudioId, name, like, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const login = await getKGPlayContext(cookieHeader);
  if (!login.loggedIn) return { provider: 'kg', error: 'LOGIN_REQUIRED', loggedIn: false };
  const meta = await resolveKGSongMetaForFavorite(hash, albumId, albumAudioId, name, cookieHeader);
  if (!meta || !meta.hash) return { provider: 'kg', error: 'MISSING_HASH', loggedIn: true };
  hash = meta.hash;
  albumId = meta.albumId;
  albumAudioId = meta.albumAudioId;
  name = meta.name;
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  let listId = await fetchKGFavoriteListId(cookieHeader);
  if (!listId) return { provider: 'kg', error: 'FAVORITE_LIST_UNAVAILABLE', loggedIn: true, hash };
  if (like === false) {
    const fileId = await fetchKGFavoriteFileId(cookieHeader, hash, albumAudioId);
    if (!fileId) return { provider: 'kg', error: 'FAVORITE_ITEM_NOT_FOUND', loggedIn: true, hash, liked: true };
    const body = await kgPostAndroidSigned(
      KG_CLOUDLIST_GATEWAY,
      '/v4/delete_songs',
      cookieHeader,
      { listid: Number(listId) || listId, userid: userId, token, data: [{ fileid: Number(fileId) || fileId }], type: 0, list_ver: 0 },
      {},
      KG_CLOUDLIST_ROUTER,
    );
    if (!kgCloudlistOk(body)) return { provider: 'kg', error: 'KG_UNLIKE_FAILED', loggedIn: true, hash, liked: true, body };
    return { provider: 'kg', loggedIn: true, hash, liked: false };
  }
  const resource = [{
    number: 1,
    name,
    hash,
    size: 0,
    sort: 0,
    timelen: 0,
    bitrate: 0,
    album_id: Number(albumId) || 0,
    mixsongid: Number(albumAudioId) || 0,
  }];
  let body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY,
    '/v6/add_song',
    cookieHeader,
    {
      userid: userId,
      token,
      listid: Number(listId) || listId,
      list_ver: 0,
      type: 0,
      slow_upload: 1,
      scene: 'false;null',
      data: resource,
    },
    { last_time: Math.floor(Date.now() / 1000), last_area: 'gztx' },
    KG_CLOUDLIST_ROUTER,
  );
  if (!kgCloudlistOk(body)) {
    kgFavoriteListIdCache = { key: '', listId: '', at: 0 };
    listId = await fetchKGFavoriteListId(cookieHeader, true);
    if (listId) {
      body = await kgPostAndroidSigned(
        KG_CLOUDLIST_GATEWAY,
        '/v6/add_song',
        cookieHeader,
        {
          userid: userId,
          token,
          listid: Number(listId) || listId,
          list_ver: 0,
          type: 0,
          slow_upload: 1,
          scene: 'false;null',
          data: resource,
        },
        { last_time: Math.floor(Date.now() / 1000), last_area: 'gztx' },
        KG_CLOUDLIST_ROUTER,
      );
    }
  }
  if (!kgCloudlistOk(body)) return { provider: 'kg', error: 'KG_LIKE_FAILED', loggedIn: true, hash, liked: false, body };
  return { provider: 'kg', loggedIn: true, hash, liked: true };
}

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(String(value || '').replace(/\+/g, '%20')).trim();
  } catch (_) {
    return String(value || '').trim();
  }
}

function normalizeKGCover(url, size) {
  url = String(url || '').trim();
  if (!url || /^null$/i.test(url) || url === '0' || url === 'undefined') return '';
  // Drop KuGou placeholder / empty softhead stubs
  if (/\/softhead\/(?:\{size\}\/)?(?:0+|default)/i.test(url) && !/\/[a-f0-9]{16,}/i.test(url)) return '';
  url = url.replace(/\{size\}/gi, String(size || 240));
  if (url.startsWith('//')) url = `https:${url}`;
  if (url.startsWith('http://')) url = `https://${url.slice(7)}`;
  return url;
}

function extractKGPlaylistCover(item, size) {
  item = item || {};
  const candidates = [
    item.pic,
    item.pic_cover,
    item.cover,
    item.imgurl,
    item.img,
    item.flexible_cover,
    item.list_pic,
    item.list_pic_url,
    item.pic_url,
    item.cover_url,
    item.heats_pic,
    item.sound,
    item.ico,
    item.icon,
    item.list_cover,
    item.collect_pic,
    item.user_cover,
  ];
  for (const raw of candidates) {
    const cover = normalizeKGCover(raw, size || 240);
    if (cover) return cover;
  }
  return '';
}

function normalizeKGDuration(value, fromSearch) {
  const n = Number(value) || 0;
  if (!n) return 0;
  if (fromSearch || n < 10000) return Math.round(n * 1000);
  return Math.round(n);
}

function stripKGHighlightHtml(value) {
  return String(value || '')
    .replace(/<\/?em>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractKGFee(item) {
  item = item || {};
  const payType = Number(item.PayType ?? item.pay_type ?? 0);
  const privilege = Number(item.Privilege ?? item.privilege ?? 0);
  if (payType === 1 || payType === 2 || payType === 4) return 1;
  if ((privilege & 2) === 2) return 1;
  return 0;
}

function extractKGCover(item, size) {
  item = item || {};
  const trans = item.trans_param || item.TransParam || {};
  return normalizeKGCover(
    item.Image || item.img || item.album_img || item.album_sizable_cover || item.albumimg ||
    trans.union_cover || trans.unionCover || trans.album_img || trans.imgurl || '',
    size || 240,
  );
}

function stripKGAudioExt(text) {
  return String(text || '').replace(/\.(mp3|flac|m4a|ape|wav|ogg|aac|wma|mp4|mkv)(\?.*)?$/i, '').trim();
}

function mapKGSong(item, fromSearch) {
  item = item || {};
  const audio = item.audio_info || item.audioInfo || item.base || item.base_info || {};
  const goods = Array.isArray(item.relate_goods) ? item.relate_goods[0] : null;
  const nested = goods && typeof goods === 'object' ? goods : {};
  const hash128 = String(
    item['128hash'] || item.FileHash || item.hash || item.HASH || item.filehash
    || audio.hash || audio.FileHash || nested.hash || nested.FileHash || '',
  ).trim().toLowerCase();
  const hash320 = String(
    item['320hash'] || item.HQFileHash || item.h320hash || item.hash_320
    || audio.hash_320 || audio['320hash'] || nested.hash_320 || '',
  ).trim().toLowerCase();
  const hashSq = String(
    item.sqhash || item.SQFileHash || item.hash_flac || item.hash_sq
    || audio.sqhash || nested.sqhash || '',
  ).trim().toLowerCase();
  const hash = hash128 || hash320 || hashSq;
  const albumId = String(
    item.AlbumID || item.album_id || item.albumid || item.AlbumId
    || audio.album_id || nested.album_id || '',
  ).trim();
  const albumAudioId = String(
    item.MixSongID || item.mixsongid || item.mixSongId || item.album_audio_id || item.AlbumAudioID
    || item.audio_id || audio.album_audio_id || audio.mixsongid || nested.album_audio_id
    || item.ID || '',
  ).trim();
  const fee = extractKGFee(item);
  const authors = item.authors || item.singerinfo || item.SingerList || item.singers || [];
  const authorNames = Array.isArray(authors)
    ? authors.map((a) => stripKGHighlightHtml(a && (a.author_name || a.singername || a.name || a.AuthorName || ''))).filter(Boolean)
    : [];
  const authorIds = Array.isArray(authors)
    ? authors.map((a) => String((a && (a.author_id || a.singerid || a.singer_id || a.id)) || '').trim()).filter(Boolean)
    : [];
  let rawName = stripKGHighlightHtml(item.SongName || item.songname || item.song_name || '');
  let name = stripKGAudioExt(rawName);
  let artist = stripKGHighlightHtml(
    item.SingerName || item.singername || item.author_name || item.singer || authorNames.join(' / ') || '',
  );
  const filename = stripKGAudioExt(stripKGHighlightHtml(item.filename || item.FileName || item.name || item.file_name || ''));
  // Cloudlist rows often put "歌手 - 歌名.mp3" into name/filename only.
  if ((!name || name === filename) && filename) {
    if (filename.includes(' - ')) {
      const parts = filename.split(' - ');
      if (!artist) artist = parts[0].trim();
      name = stripKGAudioExt(parts.slice(1).join(' - ').trim() || filename);
    } else if (!name) {
      name = filename;
    }
  }
  if (!artist && (rawName.includes(' - ') || filename.includes(' - '))) {
    const parts = (rawName.includes(' - ') ? rawName : filename).split(' - ');
    artist = parts[0].trim();
    name = stripKGAudioExt(parts.slice(1).join(' - ').trim() || name || rawName);
  }
  name = stripKGAudioExt(name);
  const singerId = String(
    item.SingerId || item.singerid || item.singer_id || item.SingerID || item.author_id || authorIds[0] || '',
  ).trim();
  return {
    provider: 'kg',
    source: 'kg',
    type: 'kg',
    id: hash,
    hash,
    hash128,
    hash320,
    hashSq,
    albumId,
    albumAudioId,
    singerId,
    artistId: singerId,
    name,
    artist,
    album: stripKGHighlightHtml(item.AlbumName || item.album_name || item.album || ''),
    cover: extractKGCover(item, 240),
    duration: normalizeKGDuration(
      item.Duration || item.duration || item.timelength || item.timelen || item.time_length
      || audio.timelength || audio.duration || nested.timelength,
      fromSearch,
    ),
    fee,
    privilege: Number(item.Privilege ?? item.privilege ?? 0) || 0,
    payType: Number(item.PayType ?? item.pay_type ?? 0) || 0,
    playable: fee === 0,
  };
}

function mapKGPlaylist(item, userId) {
  item = item || {};
  const listId = kgPlaylistListId(item);
  const globalId = kgPlaylistGlobalId(item);
  const id = listId || globalId || String(item.specialid || item.special_id || item.id || '').trim();
  const name = stripKGHighlightHtml(
    item.name || item.list_name || item.listname || item.specialname || item.special_name || '',
  );
  const typeNum = Number(item.type);
  const ownerId = String(
    item.list_create_userid || item.create_userid || item.userid || item.uid || item.ownerid || '',
  ).trim();
  const isFavorite = isKGFavoriteName(name)
    || Number(item.is_default) === 1
    || Number(item.is_favorite) === 1;
  // Official cloudlist: type 0 = created/default, type 1 = collected
  const subscribed = !isFavorite && (
    typeNum === 1
    || Number(item.is_collect) === 1
    || Number(item.collected) === 1
  );
  return {
    provider: 'kg',
    source: 'kg',
    type: 'playlist',
    id,
    listId: listId || id,
    globalCollectionId: globalId,
    name: name || (isFavorite ? '我喜欢' : '未命名歌单'),
    cover: extractKGPlaylistCover(item, 240),
    trackCount: Number(item.count || item.song_count || item.songcount || item.count_total || item.total || item.song_num || 0) || 0,
    creator: item.nickname || item.username || item.create_username || item.list_create_username || '酷狗音乐',
    ownerId,
    subscribed,
    isFavorite,
    listType: Number.isFinite(typeNum) ? typeNum : (subscribed ? 1 : 0),
    ownedByMe: !ownerId || !userId || String(ownerId) === String(userId) || subscribed || isFavorite,
  };
}

function keepKGUserPlaylist(pl, userId) {
  if (!pl || !pl.id) return false;
  if (pl.isFavorite || pl.subscribed) return true;
  if (!userId) return true;
  if (pl.ownerId) return String(pl.ownerId) === String(userId);
  // No owner field: keep numeric cloudlist ids only (drop foreign special/album rows)
  return /^\d+$/.test(String(pl.listId || '')) && Number(pl.listType) !== 1;
}

async function kgFetchText(url, opts) {
  return (await kgFetchResponse(url, opts)).text();
}

/** 原始 Response：云盘系列的响应体是二进制（AES 加密），要按字节取，不能走 text()。 */
function kgFetchResponse(url, opts) {
  opts = opts || {};
  return fetch(url, {
    method: opts.method || 'GET',
    headers: Object.assign({
      'User-Agent': opts.mobile ? KG_UA_MOBILE : KG_UA_PC,
      Referer: opts.referer || 'https://www.kugou.com/',
      Accept: 'application/json, text/plain, */*',
    }, opts.headers || {}),
    body: opts.body,
    // 长轮询端点要单独放宽安卓桥的 15 秒上限（见 nativeAndroidBridge 的 foliaTimeoutMs）。
    ...(Number(opts.timeoutMs) > 0 ? { foliaTimeoutMs: Number(opts.timeoutMs) } : {}),
  });
}

async function kgFetchBytes(url, opts) {
  return new Uint8Array(await (await kgFetchResponse(url, opts)).arrayBuffer());
}

async function kgFetchJSON(url, opts) {
  opts = opts || {};
  const resp = await kgFetchResponse(url, opts);
  const text = await resp.text();
  const cleaned = String(text || '').replace(/<!--[\s\S]*?-->/g, '').trim();
  try {
    return JSON.parse(cleaned || text);
  } catch (_) {
    // 响应体不是 JSON（空体、HTML 错误页、或别的东西）时原来直接吞成 null，上层只能看到
    // 一个编造出来的错误码，无从判断是网关拒绝、路由不对还是被风控。把原文头部记下来。
    if (opts.trace) {
      noteLibraryStep('kugou', `${opts.trace}:raw`, {
        status: resp.status,
        chars: cleaned.length,
        head: cleaned.slice(0, 160),
      });
    }
    return null;
  }
}

function buildKGMid() {
  // Official clients commonly use 32-char md5 hex mid.
  return md5(`mineradio_${Date.now()}_${Math.random()}`);
}

async function getKGMid(cookieHeader) {
  const device = await getKGDeviceIdentity(cookieHeader);
  kgMidCache = String(device.mid);
  return kgMidCache;
}

function buildKGTrackerKey(hash, mid, userId, appid) {
  hash = String(hash || '').trim().toLowerCase();
  userId = String(userId || '0').replace(/\D/g, '') || '0';
  appid = String(appid || KG_ANDROID_APPID);
  // Compatible with both historical concat and official signKey(hash+salt+appid+mid+userid).
  return md5(`${hash}${KG_TRACKER_SECRET}${appid}${mid}${userId}`);
}

function buildKGLiteTrackerKey(hash, mid, userId) {
  hash = String(hash || '').trim().toLowerCase();
  userId = String(userId || '0').replace(/\D/g, '') || '0';
  return md5(`${hash}${KG_TRACKER_SECRET}${KG_LITE_APPID}${mid}${userId}`);
}

/**
 * Fast path for the Android V5 request that the native bridge can verify with a valid reward
 * session. It mirrors the successful 20489/clientver variant as a single first request instead
 * of walking the older 11430 probes before it.
 */
async function fetchKGAndroidFastSongUrl(hash, albumId, albumAudioId, cookieHeader, loginVipType, quality) {
  hash = String(hash || '').trim().toLowerCase();
  if (!hash) return '';
  cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: true });
  const userId = kgCookieUserId(cookieHeader) || '0';
  const token = kgCookieToken(cookieHeader) || '';
  if (!userId || userId === '0' || !token) return '';
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader) || kgRandomString(24);
  const clienttime = Math.floor(Date.now() / 1000);
  const cached = await loadKGVipSessionCache(userId);
  const params = {
    album_id: Number(albumId) || 0,
    area_code: 1,
    hash,
    ssa_flag: 'is_fromtrack',
    version: KG_TRACKER_CLIENTVER,
    page_id: KG_SONG_PAGE_ID,
    quality: quality || 128,
    album_audio_id: Number(albumAudioId) || 0,
    behavior: 'play',
    pid: KG_SONG_PID,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: 0,
    ppage_id: KG_SONG_PPID,
    cdnBackup: 1,
    module: '',
    clientver: KG_TRACKER_CLIENTVER,
    dfid,
    mid,
    uuid: '-',
    appid: KG_ANDROID_APPID,
    clienttime,
    token,
    userid: userId,
  };
  params.key = buildKGTrackerKey(hash, mid, userId, KG_ANDROID_APPID);
  // KuGouMusicApi's song_url passes `notSign`, but its request layer checks `notSignature`;
  // the real client still sends this Android signature.
  params.signature = signatureKGAndroidParams(params);
  const qs = Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const url = `https://gateway.kugou.com/v5/url?${qs}`;
  const startedAt = Date.now();
  noteLibraryStep('kugou', 'url:http:start', { name: 'android-fast-v5', host: 'gateway.kugou.com' });
  try {
    const body = await kgFetchJSON(url, {
      mobile: true,
      referer: 'https://www.kugou.com/',
      headers: {
        Cookie: buildKGLeanCookie(cookieHeader),
        'User-Agent': KG_ANDROID_UA,
        dfid: String(dfid),
        clienttime: String(clienttime),
        mid: String(mid),
        'kg-rc': '1',
        'kg-thash': '5d816a0',
        'kg-rec': '1',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
        'x-router': 'trackercdn.kugou.com',
      },
    });
    noteLibraryStep('kugou', 'url:http:done', {
      name: 'android-fast-v5',
      host: 'gateway.kugou.com',
      ms: Date.now() - startedAt,
      status: body && body.status,
    });
    return parseKGPlayUrl(body);
  } catch (error) {
    noteLibraryStep('kugou', 'url:http:error', {
      name: 'android-fast-v5',
      host: 'gateway.kugou.com',
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

async function fetchKGTrackerV5Url(hash, albumId, albumAudioId, cookieHeader, loginVipType, quality) {
  hash = String(hash || '').trim().toLowerCase();
  if (!hash) return { url: '', status: 0, blocked: false };
  // VIP tracker needs android appToken when available.
  cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: true });
  const userId = kgCookieUserId(cookieHeader) || '0';
  const token = kgCookieToken(cookieHeader) || '';
  if (!userId || userId === '0' || !token) return { url: '', status: 0, blocked: false };
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader) || kgRandomString(24);
  const cached = await loadKGVipSessionCache(userId);
  const vipType = resolveKGTrackerVipType(cookieHeader, loginVipType || (cached && cached.vipType));
  const vipToken = resolveKGEffectiveVipToken(cookieHeader, cached);
  const qualityCode = Number(quality) || 128;
  // Match KuGouMusicApi song_url: version/clientver=11430, no vipType in query; then fallbacks.
  const attempts = [
    { clientver: KG_TRACKER_CLIENTVER, withVipType: false },
  ];
  const leanCookie = buildKGLeanCookie(cookieHeader);
  let lastStatus = 0;
  for (const attempt of attempts) {
    const clienttime = Math.floor(Date.now() / 1000);
    const params = {
      album_id: Number(albumId) || 0,
      album_audio_id: Number(albumAudioId) || 0,
      area_code: 1,
      behavior: 'play',
      hash,
      cmd: 26,
      pid: KG_SONG_PID,
      pidversion: 3001,
      IsFreePart: 0,
      cdnBackup: 1,
      module: '',
      page_id: KG_SONG_PAGE_ID,
      ppage_id: KG_SONG_PPID,
      quality: qualityCode,
      ssa_flag: 'is_fromtrack',
      version: attempt.clientver,
      clientver: attempt.clientver,
      appid: KG_ANDROID_APPID,
      clienttime,
      dfid,
      mid,
      uuid: '-',
      userid: userId,
      token,
    };
    if (attempt.withVipType && Number(loginVipType) > 0) params.vipType = loginVipType;
    params.key = buildKGTrackerKey(hash, mid, userId, KG_ANDROID_APPID);
    // Match KuGouMusicApi's actual request layer: `notSign` is not the option it reads,
    // so `/v5/url` must still carry the Android signature.
    params.signature = signatureKGAndroidParams(params);
    const qs = Object.keys(params)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    const urls = [
      `https://gateway.kugou.com/v5/url?${qs}`,
      `https://gateway.kugou.com/tracker/v5/url?${qs}`,
    ];
    for (const url of urls) {
      const httpStartedAt = Date.now();
      const httpHost = new URL(url).host;
      noteLibraryStep('kugou', 'url:http:start', { name: 'v5', host: httpHost, clientver: attempt.clientver });
      try {
        const body = await kgFetchJSON(url, {
          mobile: true,
          referer: 'https://www.kugou.com/',
          headers: Object.assign({
            Cookie: leanCookie,
            'User-Agent': KG_ANDROID_UA,
            dfid: String(dfid),
            clienttime: String(clienttime),
            mid: String(mid),
            'kg-rc': '1',
            'kg-thash': '5d816a0',
            'kg-rec': '1',
            'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
            'x-router': 'trackercdn.kugou.com',
          }, buildKGAuthHeaders(token)),
        });
        if (!body) continue;
        lastStatus = Number(body.status) || 0;
        noteLibraryStep('kugou', 'url:http:done', {
          name: 'v5',
          host: httpHost,
          ms: Date.now() - httpStartedAt,
          status: lastStatus,
        });
        const playUrl = parseKGPlayUrl(body);
        if (playUrl) {
          const harvested = harvestKGVipToken(body);
          if (harvested || Number(vipType) > 0) {
            await saveKGVipSessionCache(userId, {
              vipToken: harvested || vipToken,
              vipType: Number(vipType) || 6,
              isVip: true,
              vipLabel: (cached && cached.vipLabel) || 'VIP',
            });
          }
          return { url: playUrl, status: lastStatus || 1, blocked: false, vipType, via: 'v5', clientver: attempt.clientver };
        }
      } catch (error) {
        noteLibraryStep('kugou', 'url:http:error', {
          name: 'v5',
          host: httpHost,
          ms: Date.now() - httpStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { url: '', status: lastStatus, blocked: lastStatus === 2, vipType, via: 'v5' };
}

function parseKGPlayUrl(body) {
  if (!body) return '';
  const candidates = [
    body.url,
    body.backupUrl,
    body.backup_url,
    body.data && body.data.url,
    body.data && body.data.backupUrl,
    body.data && body.data.backup_url,
  ];
  for (const urls of candidates) {
    if (Array.isArray(urls)) {
      const hit = urls.find((item) => item && /^https?:\/\//i.test(item));
      if (hit) return hit;
    }
    if (typeof urls === 'string' && /^https?:\/\//i.test(urls)) return urls;
  }
  return '';
}

function pickPlayInfoUrl(playInfo) {
  if (!playInfo || playInfo.error) return '';
  if (playInfo.url && /^https?:\/\//i.test(playInfo.url)) return playInfo.url;
  const backup = playInfo.backup_url;
  if (Array.isArray(backup) && backup[0]) return backup[0];
  if (typeof backup === 'string' && backup) return backup;
  return '';
}

function isExpiredKGVipTime(value) {
  const ts = Date.parse(String(value || '').replace(/-/g, '/'));
  return Number.isFinite(ts) ? ts < Date.now() : false;
}

function parseKGVipFromData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { vipType: 0, isVip: false };
  const nestedRaw = data.vip || data.user_vip || data.userVip || data.music_vip || {};
  const nested = (nestedRaw && typeof nestedRaw === 'object' && !Array.isArray(nestedRaw)) ? nestedRaw : {};
  const vipEnd = data.vip_end_time || data.vipEndTime || nested.vip_end_time || data.expire_time || data.expireTime;
  let vipType = Number(
    data.vip_type || data.vipType || data.VIPType || data.VipType ||
    nested.vip_type || nested.vipType || nested.type || 0,
  ) || 0;
  const productType = String(data.product_type || nested.product_type || data.busi_type || nested.busi_type || '').toLowerCase();
  const isVipFlag = Number(data.is_vip ?? data.isVip ?? nested.is_vip ?? nested.isVip ?? data.isVipUser ?? -1);
  let isVip = !!(
    (vipType > 0 && (!vipEnd || !isExpiredKGVipTime(vipEnd))) ||
    isVipFlag === 1 ||
    Number(data.vip) === 1 ||
    Number(nested.vip) === 1 ||
    Number(data.MusicPack) === 1 ||
    Number(data.musicpack) === 1 ||
    Number(data.y_type) > 0 ||
    Number(data.music_vip) > 0 ||
    (productType && !/^(free|none|0|normal)$/.test(productType) && Number(data.is_vip) === 1) ||
    (vipEnd && !isExpiredKGVipTime(vipEnd)) ||
    (data.svip_end_time && !isExpiredKGVipTime(data.svip_end_time)) ||
    (data.musicvip_end_time && !isExpiredKGVipTime(data.musicvip_end_time)) ||
    (nested.vip_end_time && !isExpiredKGVipTime(nested.vip_end_time))
  );
  if (Number(data.is_vip) === 1 && data.vip_end_time && !isExpiredKGVipTime(data.vip_end_time)) {
    isVip = true;
    vipType = Math.max(vipType, KG_PRODUCT_VIP_TYPE[productType] || 6);
  }
  if (Number(data.m_type) > 0 && data.m_end_time && !isExpiredKGVipTime(data.m_end_time)) {
    isVip = true;
    vipType = Math.max(vipType, Number(data.m_type) || 6);
  }
  if (Number(data.su_vip) > 0 || (data.su_vip_end_time && !isExpiredKGVipTime(data.su_vip_end_time))) {
    isVip = true;
    vipType = Math.max(vipType, 33);
  }
  return { vipType: vipType || (isVip ? 6 : 0), isVip };
}

function pushKGVipQueueItem(queue, value) {
  if (!value) return;
  if (Array.isArray(value)) queue.push(...value);
  else queue.push(value);
}

function extractKGVipFromPayload(payload) {
  let best = parseKGVipFromData(payload);
  const queue = [];
  pushKGVipQueueItem(queue, payload);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    ['busi_vip', 'busiVip', 'vip_info', 'vipInfo', 'music_vip', 'svip', 'data', 'info', 'user_vip'].forEach((key) => {
      pushKGVipQueueItem(queue, payload[key]);
    });
    if (Array.isArray(payload.list)) queue.push(...payload.list);
    if (Array.isArray(payload.vip_list)) queue.push(...payload.vip_list);
  }
  queue.forEach((item) => {
    const hit = parseKGVipFromData(item);
    if (hit.isVip && (!best.isVip || hit.vipType >= best.vipType)) best = hit;
  });
  return best;
}

function resolveKGVipMeta(data) {
  if (!data || typeof data !== 'object') return { vipLabel: '', expireTime: '' };
  if (Number(data.m_type) > 0 && data.m_end_time && !isExpiredKGVipTime(data.m_end_time)) {
    return { vipLabel: '豪华VIP', expireTime: String(data.m_end_time) };
  }
  if (Number(data.su_vip) > 0 || (data.su_vip_end_time && !isExpiredKGVipTime(data.su_vip_end_time))) {
    return { vipLabel: '超级VIP', expireTime: String(data.su_vip_end_time || data.vip_end_time || '') };
  }
  const items = Array.isArray(data.busi_vip) ? data.busi_vip : (Array.isArray(data.busiVip) ? data.busiVip : []);
  let bestItem = null;
  items.forEach((item) => {
    if (!item || Number(item.is_vip) !== 1) return;
    if (item.vip_end_time && isExpiredKGVipTime(item.vip_end_time)) return;
    if (!bestItem || String(item.vip_end_time || '') > String(bestItem.vip_end_time || '')) bestItem = item;
  });
  if (bestItem) {
    const pt = String(bestItem.product_type || '').toLowerCase();
    const label = pt === 'svip' ? '超级VIP'
      : (pt === 'mvip' ? '音乐包' : (pt === 'tvip' || pt === 'vip' || pt === 'qvip' || pt === 'dvip' || pt ? '豪华VIP' : 'VIP'));
    return { vipLabel: label, expireTime: String(bestItem.vip_end_time || '') };
  }
  if (Number(data.vip_type) > 0 && data.vip_end_time && !isExpiredKGVipTime(data.vip_end_time)) {
    return { vipLabel: '豪华VIP', expireTime: String(data.vip_end_time) };
  }
  return { vipLabel: '', expireTime: '' };
}

async function fetchKGUserVipDetailOnce(cookieHeader, busiType) {
  cookieHeader = await enrichKGCookieHeader(cookieHeader);
  const extra = busiType ? { busi_type: busiType } : {};
  // Matches KuGouMusicApi /user/vip/detail → kugouvip.kugou.com/v1/get_union_vip
  const attempts = [
    () => kgFetchAndroidSigned('https://kugouvip.kugou.com', '/v1/get_union_vip', cookieHeader, extra),
    () => kgFetchAndroidSigned(
      'https://gateway.kugou.com',
      '/v1/get_union_vip',
      cookieHeader,
      extra,
      { 'x-router': 'kugouvip.kugou.com' },
    ),
    () => kgFetchAndroidSigned(
      'https://gateway.kugou.com/kugouvip.service',
      '/v1/get_union_vip',
      cookieHeader,
      extra,
      { 'x-router': 'kugouvip.kugou.com' },
    ),
  ];
  for (const run of attempts) {
    try {
      const body = await run();
      if (!body) continue;
      const err = Number(body.error_code ?? body.errcode ?? body.err_code ?? 0);
      if (err && err !== 0 && Number(body.status) !== 1) continue;
      const data = body.data || body.info || body;
      if (!data || typeof data !== 'object') continue;
      const vip = extractKGVipFromPayload(data);
      const meta = resolveKGVipMeta(data);
      // Concept VIP payloads often put membership on the root or busi_vip[].
      const rootVip = Number(data.is_vip ?? data.isVip ?? 0) === 1
        && !(data.vip_end_time && isExpiredKGVipTime(data.vip_end_time));
      const isVip = !!(vip.isVip || meta.vipLabel || rootVip);
      if (!isVip && !meta.expireTime && !Array.isArray(data.busi_vip) && !Array.isArray(data.busiVip)) {
        // Keep raw body when status ok so callers can inspect empty VIP.
        if (Number(body.status) === 1 || err === 0) {
          return {
            vipType: 0,
            isVip: false,
            vipLabel: '',
            expireTime: '',
            vipToken: harvestKGVipToken(body) || harvestKGVipToken(data),
            detail: data,
            busiType: busiType || '',
            empty: true,
          };
        }
        continue;
      }
      let vipType = vip.vipType || 0;
      if (!vipType && isVip) {
        const pt = String(data.product_type || (meta.vipLabel === '超级VIP' ? 'svip' : 'vip')).toLowerCase();
        vipType = KG_PRODUCT_VIP_TYPE[pt] || 6;
      }
      return {
        vipType: vipType || (isVip ? 6 : 0),
        isVip,
        vipLabel: meta.vipLabel || (isVip ? (String(data.product_type || '').toLowerCase() === 'svip' ? '超级VIP' : '豪华VIP') : ''),
        expireTime: meta.expireTime || String(data.vip_end_time || data.su_vip_end_time || data.m_end_time || ''),
        vipToken: harvestKGVipToken(body) || harvestKGVipToken(data),
        detail: data,
        busiType: busiType || '',
        empty: false,
      };
    } catch (_) {}
  }
  return null;
}

/**
 * KuGouMusicApi `/user/vip/detail`
 * Upstream: GET https://kugouvip.kugou.com/v1/get_union_vip?busi_type=concept (android signed)
 */
async function fetchKGUserVipDetail(cookieHeader) {
  // Docs default to concept; also try music for standard VIP accounts.
  const busiTypes = ['concept', 'music', ''];
  let best = null;
  for (const busiType of busiTypes) {
    const hit = await fetchKGUserVipDetailOnce(cookieHeader, busiType);
    if (!hit) continue;
    if (!best) best = hit;
    if (hit.isVip) {
      best = hit;
      break;
    }
    if (!best.detail && hit.detail) best = hit;
  }
  return best;
}

export async function getKGUserVipDetail(cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  await syncKGVipCacheWithCookie(cookieHeader);
  const auth = await ensureKGAndroidAuth(cookieHeader, { requireAppToken: true });
  cookieHeader = await enrichKGCookieHeader(auth.cookieHeader || cookieHeader, {
    preferAppToken: !!(auth && auth.token && auth.refreshed),
  });
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) {
    return {
      provider: 'kg',
      loggedIn: false,
      error: 'NOT_LOGGED_IN',
      message: '未登录，无法查询 VIP 详情。请先在 www.kugou.com 登录。',
    };
  }
  // Primary path: /user/vip/detail (= get_union_vip)
  const detail = await fetchKGUserVipDetail(cookieHeader);
  const [userCenter, union, mobileVip] = await Promise.all([
    fetchKGUserCenterVip(cookieHeader).catch(() => null),
    fetchKGUnionVip(cookieHeader).catch(() => null),
    fetchKGMobileVipInfo(cookieHeader).catch(() => null),
  ]);
  let merged = mergeKGVipState({}, detail || {});
  merged = mergeKGVipState(merged, userCenter || {});
  merged = mergeKGVipState(merged, union || {});
  merged = mergeKGVipState(merged, mobileVip || {});
  if (!merged.isVip && kgCookieHasVipSession(cookieHeader)) {
    merged = mergeKGVipState(merged, { vipType: kgCookieVipType(cookieHeader) || 6, isVip: true });
  }
  const cached = await loadKGVipSessionCache(userId);
  if (!merged.isVip && cached && cached.isVip) {
    merged = mergeKGVipState(merged, cached);
  }
  const vipToken = (detail && detail.vipToken)
    || harvestKGVipToken(detail && detail.detail)
    || harvestKGVipToken(userCenter && userCenter.detail)
    || resolveKGEffectiveVipToken(cookieHeader, cached);
  const vipLabel = (detail && detail.vipLabel)
    || (userCenter && userCenter.vipLabel)
    || (merged.isVip ? 'VIP' : '无VIP');
  const expireTime = (detail && detail.expireTime)
    || (userCenter && userCenter.expireTime)
    || '';
  if (merged.isVip || vipToken) {
    await saveKGVipSessionCache(userId, {
      vipType: merged.vipType || 6,
      isVip: !!(merged.isVip || vipToken),
      vipLabel,
      expireTime,
      vipToken,
    });
  }
  if (!merged.isVip && !detail && !userCenter && !union && !mobileVip) {
    return {
      provider: 'kg',
      loggedIn: true,
      userId,
      isVip: false,
      vipType: 0,
      vipLabel: '无VIP',
      vipToken: '',
      error: 'VIP_DETAIL_EMPTY',
      message: ' /user/vip/detail 未返回会员信息，请确认会员未过期后重新登录酷狗网页',
      source: 'user/vip/detail',
    };
  }
  return {
    provider: 'kg',
    loggedIn: true,
    userId,
    isVip: merged.isVip,
    vipType: merged.vipType,
    vipLabel,
    expireTime,
    vipToken: vipToken || '',
    hasVipToken: !!vipToken,
    detail: (detail && detail.detail) || (userCenter && userCenter.detail) || null,
    source: 'user/vip/detail',
    busiType: (detail && detail.busiType) || 'concept',
  };
}

export function mergeKGVipState(base, extra) {
  base = base || { vipType: 0, isVip: false };
  extra = extra || { vipType: 0, isVip: false };
  const vipType = Math.max(Number(base.vipType) || 0, Number(extra.vipType) || 0);
  const isVip = !!(base.isVip || extra.isVip || vipType > 0);
  return { vipType: vipType || (isVip ? 6 : 0), isVip };
}

export function resolveKGTrackerVipType(cookieHeader, loginVipType) {
  const fromCookie = kgCookieVipType(cookieHeader);
  if (fromCookie > 0) return String(fromCookie);
  if (Number(loginVipType) > 0) return String(loginVipType);
  if (kgCookieHasVipSession(cookieHeader)) return '6';
  if (kgCookieToken(cookieHeader)) return '6';
  return '0';
}

export function buildKGTrackerVipTypeCandidates(cookieHeader, loginVipType) {
  return [...new Set([
    resolveKGTrackerVipType(cookieHeader, loginVipType),
    String(kgCookieVipType(cookieHeader) || ''),
    kgCookieHasVipSession(cookieHeader) ? '6' : '',
    kgCookieToken(cookieHeader) ? '6' : '',
    '6', '11', '33', '3',
  ].filter(Boolean))];
}

function buildKGSessionCacheKey(cookieHeader) {
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  return `${userId}|${token ? token.slice(0, 12) : ''}|${kgCookieVipType(cookieHeader)}`;
}

const KG_QUALITY_OPTIONS = [
  { level: 'lossless', label: '无损 SQ', br: 999000 },
  { level: 'exhigh', label: '极高 HQ', br: 320000 },
  { level: 'standard', label: '标准', br: 128000 },
];

export function normalizeQualityPreference(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (['jymaster', 'master', 'studio', 'svip', 'highest'].includes(raw)) return 'jymaster';
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires';
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless';
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh';
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard';
  return 'hires';
}

export function qualityCandidatesFrom(target, candidates) {
  target = normalizeQualityPreference(target);
  let start = candidates.findIndex((item) => item.level === target);
  if (start < 0) start = 0;
  return candidates.slice(start);
}

function extractKGQualityMap(extra, baseHash) {
  extra = extra || {};
  return {
    lossless: String(extra.sqhash || extra.SQFileHash || '').trim().toLowerCase(),
    exhigh: String(extra['320hash'] || extra.HQFileHash || '').trim().toLowerCase(),
    standard: String(extra['128hash'] || extra.FileHash || baseHash || '').trim().toLowerCase(),
  };
}

export function pickKGHashForQuality(extra, baseHash, qualityPreference) {
  const map = extractKGQualityMap(extra, baseHash);
  const order = qualityCandidatesFrom(normalizeQualityPreference(qualityPreference), KG_QUALITY_OPTIONS);
  for (const item of order) {
    const hash = map[item.level];
    if (hash) return { hash, level: item.level, label: item.label, br: item.br };
  }
  const fallback = map.standard || String(baseHash || '').trim().toLowerCase();
  return { hash: fallback, level: 'standard', label: '标准', br: 128000 };
}

function buildKGPlayUrlCacheKey(hash, albumId, albumAudioId, qualityLevel) {
  return `${hash}|${albumId || '0'}|${albumAudioId || ''}|${qualityLevel || ''}`;
}

function readKGPlayUrlCache(key) {
  const hit = kgPlayUrlCache.get(key);
  if (!hit) return '';
  if (Date.now() - hit.at > KG_PLAY_URL_CACHE_TTL_MS) {
    kgPlayUrlCache.delete(key);
    return '';
  }
  return hit.url;
}

function writeKGPlayUrlCache(key, url) {
  if (!url) return;
  kgPlayUrlCache.set(key, { url, at: Date.now() });
  if (kgPlayUrlCache.size > 80) {
    const oldest = kgPlayUrlCache.keys().next().value;
    if (oldest) kgPlayUrlCache.delete(oldest);
  }
}

function rememberKGPlaySession(cookieHeader, session) {
  kgSessionCache = {
    key: buildKGSessionCacheKey(cookieHeader),
    at: Date.now(),
    session,
  };
}

async function getKGPlayContext(cookieHeader) {
  cookieHeader = await enrichKGCookieHeader(cookieHeader || await getKGCookie());
  const cacheKey = buildKGSessionCacheKey(cookieHeader);
  const now = Date.now();
  const cached = kgSessionCache.key === cacheKey && kgSessionCache.session && (now - kgSessionCache.at) < KG_SESSION_CACHE_TTL_MS
    ? kgSessionCache.session
    : null;
  if (cached && (!cached.loggedIn || cached.vipResolved)) return cached;
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const loggedIn = !!(userId && token);
  const vipCached = loggedIn ? await loadKGVipSessionCache(userId) : null;
  let vipType = kgCookieVipType(cookieHeader) || (vipCached && vipCached.vipType) || 0;
  let isVip = kgCookieHasVipSession(cookieHeader) || !!(vipCached && vipCached.isVip);
  let vipLabel = isVip ? ((vipCached && vipCached.vipLabel) || 'VIP') : '无VIP';
  const session = { loggedIn, userId, vipType, isVip, vipLabel, vipResolved: false };
  if (loggedIn) {
    const vipInfo = await resolveKGSessionVip(cookieHeader, {
      vipType,
      isVip,
      vipLabel,
      nickname: kgCookieNickname(cookieHeader),
      avatar: kgCookieAvatar(cookieHeader),
    });
    Object.assign(session, vipInfo);
  } else {
    session.vipResolved = true;
  }
  rememberKGPlaySession(cookieHeader, session);
  return session;
}

function buildKGTrackerFastVipTypes(cookieHeader, loginVipType) {
  const primary = resolveKGTrackerVipType(cookieHeader, loginVipType);
  return [...new Set([primary, '6', '33', '0'].filter(Boolean))].slice(0, 3);
}

async function raceKGPlayTasks(taskFns, pickHit) {
  if (!taskFns.length) return null;
  return new Promise((resolve) => {
    let pending = taskFns.length;
    let settled = false;
    taskFns.forEach((fn) => {
      Promise.resolve()
        .then(fn)
        .then((result) => {
          if (settled) return;
          const hit = pickHit(result);
          if (hit) {
            settled = true;
            resolve(hit);
            return;
          }
          pending -= 1;
          if (pending <= 0) resolve(null);
        })
        .catch(() => {
          pending -= 1;
          if (!settled && pending <= 0) resolve(null);
        });
    });
  });
}

async function fetchKGUserCenterVip(cookieHeader) {
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) return null;
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader) || '-';
  const clienttime = String(Date.now());
  const commonParams = {
    userid: userId,
    token,
    appid: String(KG_ANDROID_APPID),
    clientver: String(KG_WEB_CLIENTVER),
    mid,
    dfid,
    uuid: '-',
    clienttime,
  };
  const attempts = [
    {
      base: 'https://apis.user.kugou.com/usercenter/v2/user/info',
      params: commonParams,
      headers: Object.assign({
        'User-Agent': KG_DEMO_UA,
        Accept: 'application/json, text/plain, */*',
      }, buildKGRequestHeaders(cookieHeader, token)),
    },
    {
      base: 'https://apis.user.kugou.com/usercenter/v2/user/info',
      params: { userid: userId },
      headers: Object.assign({
        'User-Agent': KG_DEMO_UA,
        Accept: 'application/json, text/plain, */*',
      }, buildKGRequestHeaders(cookieHeader, token)),
    },
    {
      base: 'https://gateway.kugou.com/usercenter.service/v2/user/info',
      params: commonParams,
      headers: Object.assign({
        'User-Agent': KG_DEMO_UA,
        mid: String(mid),
        dfid: String(dfid),
        clienttime,
        'kg-rc': '1',
        'kg-rec': '1',
      }, buildKGRequestHeaders(cookieHeader, token)),
    },
  ];
  for (const attempt of attempts) {
    const u = new URL(attempt.base);
    Object.entries(attempt.params).forEach(([key, value]) => {
      if (value != null && value !== '') u.searchParams.set(key, String(value));
    });
    try {
      const body = await kgFetchJSON(u.toString(), {
        referer: 'https://www.kugou.com/',
        headers: attempt.headers,
      });
      const parsed = parseKGUserCenterBody(body);
      if (parsed) return parsed;
    } catch (_) {}
  }
  try {
    const body = await kgFetchAndroidSigned(
      'https://gateway.kugou.com/usercenter.service',
      '/v2/user/info',
      cookieHeader,
      { clientver: String(KG_WEB_CLIENTVER) },
      { 'x-router': 'usercenter.service.kugou.com' },
    );
    const parsed = parseKGUserCenterBody(body);
    if (parsed) return parsed;
  } catch (_) {}
  return null;
}

async function resolveKGSessionVip(cookieHeader, seed) {
  seed = seed || {};
  cookieHeader = await enrichKGCookieHeader(cookieHeader);
  const userId = kgCookieUserId(cookieHeader);
  const cached = userId ? await loadKGVipSessionCache(userId) : null;
  let vipType = Number(seed.vipType) || kgCookieVipType(cookieHeader) || (cached && cached.vipType) || 0;
  let isVip = !!(seed.isVip || kgCookieHasVipSession(cookieHeader) || (cached && cached.isVip));
  let vipLabel = seed.vipLabel || (cached && cached.vipLabel) || (isVip ? 'VIP' : '无VIP');
  let expireTime = seed.expireTime || (cached && cached.expireTime) || '';
  let nickname = seed.nickname || '';
  let avatar = seed.avatar || '';
  let vipToken = resolveKGEffectiveVipToken(cookieHeader, cached);
  const [userCenter, vipDetail, profile, union, mobileVip] = await Promise.all([
    fetchKGUserCenterVip(cookieHeader),
    fetchKGUserVipDetail(cookieHeader),
    fetchKGUserProfile(cookieHeader),
    fetchKGUnionVip(cookieHeader),
    fetchKGMobileVipInfo(cookieHeader),
  ]);
  const payloads = [userCenter, vipDetail, profile, union, mobileVip]
    .map((item) => item && (item.detail || item))
    .filter(Boolean);
  for (const payload of payloads) {
    const harvested = harvestKGVipToken(payload);
    if (harvested) {
      vipToken = harvested;
      break;
    }
  }
  if (userCenter) {
    ({ vipType, isVip } = mergeKGVipState({ vipType, isVip }, userCenter));
    if (userCenter.vipLabel) vipLabel = userCenter.vipLabel;
    if (userCenter.expireTime) expireTime = userCenter.expireTime;
    if (userCenter.nickname) nickname = userCenter.nickname;
    if (userCenter.avatar) avatar = userCenter.avatar;
  }
  if (vipDetail) {
    ({ vipType, isVip } = mergeKGVipState({ vipType, isVip }, vipDetail));
    if (vipDetail.vipLabel) vipLabel = vipDetail.vipLabel;
    if (vipDetail.expireTime) expireTime = vipDetail.expireTime;
  }
  if (profile) {
    if (profile.nickname) nickname = profile.nickname;
    if (profile.avatar) avatar = profile.avatar;
    ({ vipType, isVip } = mergeKGVipState({ vipType, isVip }, profile));
  }
  if (union) ({ vipType, isVip } = mergeKGVipState({ vipType, isVip }, union));
  if (mobileVip) ({ vipType, isVip } = mergeKGVipState({ vipType, isVip }, mobileVip));
  if (!isVip && (kgCookieHasVipSession(cookieHeader) || vipToken || (cached && cached.isVip))) {
    vipType = vipType || (cached && cached.vipType) || 6;
    isVip = true;
    vipLabel = vipLabel === '无VIP' ? ((cached && cached.vipLabel) || 'VIP') : vipLabel;
  }
  if (isVip && vipLabel === '无VIP') vipLabel = 'VIP';
  if (userId && (isVip || vipToken || vipType > 0)) {
    await saveKGVipSessionCache(userId, { vipType, isVip, vipLabel, expireTime, vipToken });
  }
  return { vipType, isVip, vipLabel, expireTime, nickname, avatar, vipToken, vipResolved: true };
}

async function fetchKGUserProfile(cookieHeader) {
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) return null;
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader);
  const buildUrl = (secure) => {
    const u = new URL(`${secure ? 'https' : 'http'}://userinfo.user.kugou.com/v2/get_user_info`);
    u.searchParams.set('appid', '1005');
    u.searchParams.set('clientver', String(KG_WEB_CLIENTVER));
    u.searchParams.set('mid', mid);
    u.searchParams.set('userid', userId);
    u.searchParams.set('token', token);
    u.searchParams.set('dfid', dfid);
    u.searchParams.set('plat', '0');
    u.searchParams.set('clienttime', String(Date.now()));
    return u.toString();
  };
  const headers = Object.assign({
    'User-Agent': KG_DEMO_UA,
    Accept: 'application/json, text/plain, */*',
  }, buildKGRequestHeaders(cookieHeader, token));
  for (const url of [buildUrl(true), buildUrl(false)]) {
    try {
      const body = await kgFetchJSON(url, {
        referer: 'https://www.kugou.com/',
        headers,
      });
      if (!kgApiBodyOk(body)) continue;
      const data = body.data || body.info;
      if (!data || typeof data !== 'object') continue;
      const vip = extractKGVipFromPayload(data);
      return {
        nickname: stripKGHighlightHtml(data.nickname || data.nick_name || data.username || data.user_name || ''),
        avatar: normalizeKGCover(data.pic || data.Pic || data.user_pic || data.avatar || data.userpic || '', 180),
        vipType: vip.vipType,
        isVip: vip.isVip,
      };
    } catch (_) {}
  }
  return null;
}

async function fetchKGUnionVip(cookieHeader) {
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const loginPwd = kgCookieLoginPwd(cookieHeader);
  if (!userId || !token) return null;
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader);
  const common = `appid=1005&clientver=9108&mid=${encodeURIComponent(mid)}&userid=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}&dfid=${encodeURIComponent(dfid)}`;
  const pwdPart = loginPwd ? `&pwd=${encodeURIComponent(loginPwd)}&KugooPwd=${encodeURIComponent(loginPwd)}` : '';
  const urls = [
    `https://mobileservice.kugou.com/api/v5/vip_info?${common}${pwdPart}&format=json`,
    `https://mobileservice.kugou.com/api/v5/vip_status?${common}${pwdPart}`,
    `http://mobileservice.kugou.com/api/v5/vip_info?${common}${pwdPart}&format=json`,
    `http://mobileservice.kugou.com/api/v5/vip_status?${common}${pwdPart}`,
    `https://kugouvip.kugou.com/v1/get_union_vip?busi_type=concept&${common}`,
    `https://kugouvip.kugou.com/v1/get_union_vip?busi_type=music&${common}`,
    `https://kugouvip.kugou.com/v1/get_union_vip?${common}`,
    `https://vip.kugou.com/recharge/getUserVip?kugouid=${encodeURIComponent(userId)}&clienttoken=${encodeURIComponent(token)}&appid=1005${loginPwd ? `&KugooPwd=${encodeURIComponent(loginPwd)}` : ''}`,
    `https://mobilecdn.kugou.com/api/v3/user/vip?userid=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}&appid=1005&mid=${encodeURIComponent(mid)}${loginPwd ? `&KugooPwd=${encodeURIComponent(loginPwd)}` : ''}`,
  ];
  const headers = Object.assign({
    'User-Agent': KG_DEMO_UA,
    Accept: 'application/json, text/plain, */*',
  }, buildKGRequestHeaders(cookieHeader, token));
  let best = { vipType: 0, isVip: false };
  for (const url of urls) {
    try {
      const body = await kgFetchJSON(url, {
        referer: 'https://www.kugou.com/',
        headers,
      });
      if (!body) continue;
      const vip = extractKGVipFromPayload(body.data || body.info || body);
      if (vip.isVip) best = mergeKGVipState(best, vip);
    } catch (_) {}
  }
  return best.isVip ? best : null;
}

async function fetchKGMobileVipInfo(cookieHeader) {
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) return null;
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader);
  const common = `userid=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}&appid=1005&clientver=9108&mid=${encodeURIComponent(mid)}&dfid=${encodeURIComponent(dfid)}`;
  const urls = [
    `http://mobilecdn.kugou.com/api/v3/user/vipinfo?${common}`,
    `http://mobileservice.kugou.com/api/v3/user/vip?${common}`,
    `http://mobileservice.kugou.com/api/v5/user/vip?${common}`,
  ];
  let best = { vipType: 0, isVip: false };
  for (const url of urls) {
    try {
      const body = await kgFetchJSON(url, {
        mobile: true,
        referer: 'https://www.kugou.com/',
        headers: buildKGRequestHeaders(cookieHeader, token),
      });
      if (!body) continue;
      const vip = extractKGVipFromPayload(body.data || body.info || body);
      if (vip.isVip) best = mergeKGVipState(best, vip);
    } catch (_) {}
  }
  return best.isVip ? best : null;
}


export async function getKGLoginStatus(cookieHeader) {
  cookieHeader = cookieHeader || await ensureKGCookie();
  noteLibraryStep('kugou', 'platform:ready', { platform: KG_PLATFORM });
  if (kgCookieUserId(cookieHeader) && kgCookieToken(cookieHeader)) {
    try {
      await syncKGVipCacheWithCookie(cookieHeader);
      // Soft refresh: try app token for VIP fields, but never poison web cookie token.
      const auth = await ensureKGAndroidAuth(cookieHeader, { requireAppToken: true });
      cookieHeader = await enrichKGCookieHeader(auth.cookieHeader || cookieHeader, { preferAppToken: false });
    } catch (_) {
      cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: false });
    }
  } else {
    cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: false });
  }
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const loggedIn = !!(userId && token);
  const cached = loggedIn ? await loadKGVipSessionCache(userId) : null;
  let nickname = kgCookieNickname(cookieHeader);
  let avatar = kgCookieAvatar(cookieHeader);
  let vipType = kgCookieVipType(cookieHeader) || (cached && cached.vipType) || 0;
  let isVip = kgCookieHasVipSession(cookieHeader) || !!(cached && cached.isVip);
  let vipLabel = isVip ? ((cached && cached.vipLabel) || 'VIP') : '无VIP';
  let expireTime = (cached && cached.expireTime) || '';
  if (loggedIn) {
    const vipInfo = await resolveKGSessionVip(cookieHeader, { vipType, isVip, vipLabel, nickname, avatar, expireTime });
    ({ vipType, isVip, vipLabel, expireTime } = vipInfo);
    if (vipInfo.nickname) nickname = vipInfo.nickname;
    if (vipInfo.avatar) avatar = vipInfo.avatar;
    rememberKGPlaySession(cookieHeader, { loggedIn, userId, vipType, isVip, vipLabel, vipResolved: true });
  }
  return {
    provider: 'kg',
    loggedIn,
    hasCookie: !!cookieHeader,
    userId,
    nickname: nickname || (loggedIn ? `酷狗 ${userId}` : '酷狗音乐'),
    avatar,
    vipType,
    isVip,
    vipLevel: isVip ? (vipType >= 33 ? 'svip' : 'vip') : 'none',
    vipLabel,
    expireTime,
    hasVipToken: !!resolveKGEffectiveVipToken(cookieHeader, cached),
    session: analyzeKGCookieSession(cookieHeader),
    hasKuGooSession: !!(parseKGCookieObject(cookieHeader).KugooID || parseKGCookieObject(cookieHeader).KugooID),
    message: !loggedIn
      ? '未检测到酷狗登录 Cookie（需要 KuGoo 或 userid+token）。你目前可能只有统计/路由 Cookie，请在 www.kugou.com 用手机号或微信完整登录。'
      : (!isVip ? '已登录（KuGoo 有效）。PC 站 Cookie 往往不含会员字段，已尝试从酷狗会员接口同步；若仍显示普通账号，请确认会员未过期后点「刷新登录状态」。' : ''),
  };
}

export async function handleKGSearch(keywords, limit, cookieHeader, page) {
  keywords = String(keywords || '').trim();
  limit = Math.max(4, Math.min(30, Number(limit) || 16));
  page = Math.max(1, Number(page) || 1);
  if (!keywords) return [];
  const u = new URL('https://songsearch.kugou.com/song_search_v2');
  u.searchParams.set('keyword', keywords);
  u.searchParams.set('platform', 'WebFilter');
  u.searchParams.set('format', 'json');
  u.searchParams.set('page', String(page));
  u.searchParams.set('pagesize', String(limit));
  u.searchParams.set('userid', '-1');
  u.searchParams.set('tag', 'em');
  u.searchParams.set('filter', '2');
  u.searchParams.set('iscorrection', '1');
  u.searchParams.set('privilege_filter', '0');
  u.searchParams.set('_', String(Date.now()));
  // Avoid Authorization/KugooToken — WebFilter often returns empty with app tokens.
  const leanCookie = buildKGLeanCookie(cookieHeader || '');
  const attempts = [
    { headers: { Cookie: leanCookie || cookieHeader || '', 'User-Agent': KG_UA_PC }, mobile: false },
    { headers: { 'User-Agent': KG_UA_MOBILE }, mobile: true },
    { headers: {}, mobile: true },
  ];
  let list = [];
  for (const attempt of attempts) {
    try {
      const body = await kgFetchJSON(u.toString(), {
        mobile: !!attempt.mobile,
        referer: 'https://www.kugou.com/',
        headers: attempt.headers,
      });
      list = (body && body.data && body.data.lists) || (body && body.lists) || [];
      if (Array.isArray(list) && list.length) break;
    } catch (_) {}
  }
  return list.map((item) => mapKGSong(item, true)).filter((s) => s.hash && s.name);
}

async function fetchKGPlayInfo(hash, albumAudioId, cookieHeader) {
  const u = new URL('https://m.kugou.com/app/i/getSongInfo.php');
  u.searchParams.set('cmd', 'playInfo');
  u.searchParams.set('hash', String(hash || '').trim());
  if (albumAudioId) u.searchParams.set('album_audio_id', String(albumAudioId));
  return kgFetchJSON(u.toString(), {
    mobile: true,
    referer: 'https://m.kugou.com/',
    headers: buildKGRequestHeaders(cookieHeader),
  });
}

async function fetchKGTrackerOnce(host, vipType, hash, albumId, albumAudioId, cookieHeader) {
  cookieHeader = await enrichKGCookieHeader(cookieHeader);
  const userId = kgCookieUserId(cookieHeader) || '0';
  const token = kgCookieToken(cookieHeader) || '';
  const mid = await getKGMid(cookieHeader);
  const key = buildKGTrackerKey(hash, mid, userId);
  const audioId = String(albumAudioId || '0');
  const dfid = kgCookieDfid(cookieHeader);
  const cached = await loadKGVipSessionCache(userId);
  const vipToken = resolveKGEffectiveVipToken(cookieHeader, cached);
  const u = new URL(`${host}/i/v2/`);
  u.searchParams.set('cmd', '26');
  u.searchParams.set('key', key);
  u.searchParams.set('hash', hash);
  u.searchParams.set('behavior', 'play');
  u.searchParams.set('mid', mid);
  u.searchParams.set('dfid', dfid);
  u.searchParams.set('appid', '1005');
  u.searchParams.set('userid', userId);
  u.searchParams.set('version', '9108');
  u.searchParams.set('vipType', vipType);
  u.searchParams.set('token', token);
  if (vipToken) u.searchParams.set('vip_token', vipToken);
  u.searchParams.set('album_id', albumId || '0');
  u.searchParams.set('album_audio_id', audioId);
  u.searchParams.set('area_code', '1');
  u.searchParams.set('pid', '2');
  u.searchParams.set('pidversion', '3001');
  u.searchParams.set('with_res_tag', '1');
  const trackerHost = u.host;
  const trackerStartedAt = Date.now();
  noteLibraryStep('kugou', 'url:http:start', { name: 'tracker', host: trackerHost, vipType });
  let body = null;
  try {
    body = await kgFetchJSON(u.toString(), {
      mobile: true,
      referer: 'https://www.kugou.com/',
      headers: buildKGRequestHeaders(cookieHeader, token),
    });
  } catch (error) {
    noteLibraryStep('kugou', 'url:http:error', {
      name: 'tracker',
      host: trackerHost,
      ms: Date.now() - trackerStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  noteLibraryStep('kugou', 'url:http:done', {
    name: 'tracker',
    host: trackerHost,
    ms: Date.now() - trackerStartedAt,
    status: Number(body && body.status) || 0,
  });
  const url = parseKGPlayUrl(body);
  const status = Number(body && body.status) || 0;
  if (url) {
    const harvested = harvestKGVipToken(body);
    if (harvested || Number(vipType) > 0) {
      await saveKGVipSessionCache(userId, {
        vipToken: harvested || vipToken,
        vipType: Number(vipType) || 6,
        isVip: true,
      });
    }
  }
  return { url, status, blocked: status === 2, vipType };
}

async function fetchKGTrackerUrl(hash, albumId, albumAudioId, cookieHeader, loginVipType) {
  hash = String(hash || '').trim().toLowerCase();
  if (!hash) return { url: '', status: 0, blocked: false };
  const userId = kgCookieUserId(cookieHeader);
  const cached = await loadKGVipSessionCache(userId);
  const hasVipEntitlement = Number(loginVipType) > 0
    || kgCookieVipType(cookieHeader) > 0
    || !!resolveKGEffectiveVipToken(cookieHeader, cached);
  let lastStatus = 0;
  const fastVipTypes = hasVipEntitlement
    ? buildKGTrackerFastVipTypes(cookieHeader, loginVipType)
    : ['0'];
  const fastTasks = [];
  KG_TRACKER_FAST_HOSTS.forEach((host) => {
    fastVipTypes.forEach((vipType) => {
      fastTasks.push(() => fetchKGTrackerOnce(host, vipType, hash, albumId, albumAudioId, cookieHeader)
        .then((result) => {
          if (Number(result && result.status) > 0) lastStatus = Number(result.status);
          return result;
        }));
    });
  });
  const fastHit = await raceKGPlayTasks(fastTasks, (result) => result && result.url ? result : null);
  if (fastHit) return fastHit;
  const tried = new Set();
  KG_TRACKER_FAST_HOSTS.forEach((host) => {
    fastVipTypes.forEach((vipType) => tried.add(`${host}|${vipType}`));
  });
  const fallbackTasks = [];
  const fallbackVipTypes = hasVipEntitlement
    ? buildKGTrackerVipTypeCandidates(cookieHeader, loginVipType)
    : ['0'];
  for (const host of KG_TRACKER_HOSTS) {
    for (const vipType of fallbackVipTypes) {
      const key = `${host}|${vipType}`;
      if (tried.has(key)) continue;
      tried.add(key);
      fallbackTasks.push(() => fetchKGTrackerOnce(host, vipType, hash, albumId, albumAudioId, cookieHeader)
        .then((result) => {
          if (Number(result && result.status) > 0) lastStatus = Number(result.status);
          return result;
        }));
    }
  }
  const fallbackHit = await raceKGPlayTasks(fallbackTasks, (result) => result && result.url ? result : null);
  if (fallbackHit) return fallbackHit;
  return { url: '', status: lastStatus, blocked: lastStatus === 2 };
}

/**
 * 单条取链策略的兜底时限。
 *
 * raceKGPlayTasks 只在「拿到地址」时提前返回，四条都没拿到就要等它们全部结束；其中任何一条卡在
 * 一个不响应的 CDN 上（安卓这边要等 OkHttp 的 45s 读超时，甚至叠加多次尝试），整个取链就一直
 * 不返回，界面永远停在「正在获取歌曲链接...」。这里给每条策略一个上限，并逐条记进诊断轨迹，
 * 这样既能保证一定会返回，也能看出是哪一条拖住了。
 */
const KG_PLAY_STRATEGY_DEADLINE_MS = 9000;
const KG_FAST_SONG_URL_DEADLINE_MS = 1500;

async function runKGPlayStrategy(name, run, deadlineMs = KG_PLAY_STRATEGY_DEADLINE_MS) {
  const startedAt = Date.now();
  noteLibraryStep('kugou', 'url:strategy:start', { name });
  let timer = null;
  try {
    const result = await Promise.race([
      Promise.resolve().then(run),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ __timedOut: true }), deadlineMs);
      }),
    ]);
    const ms = Date.now() - startedAt;
    if (result && result.__timedOut) {
      noteLibraryStep('kugou', 'url:strategy:timeout', { name, ms });
      return null;
    }
    noteLibraryStep('kugou', 'url:strategy:done', { name, ms, hasUrl: Boolean(result && result.url) });
    return result;
  } catch (error) {
    noteLibraryStep('kugou', 'url:strategy:error', {
      name,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const kgPlayUrlResolutionInFlight = new Map();

async function resolveKGSongPlayUrlUncached(hash, albumId, albumAudioId, cookieHeader, login, qualityCode) {
  const vipType = login && login.vipType;
  const q = Number(qualityCode) || 128;
  const cached = await loadKGVipSessionCache(kgCookieUserId(cookieHeader));
  const hasVipEntitlement = Number(vipType) > 0
    || !!resolveKGEffectiveVipToken(cookieHeader, cached);
  // Always try the lite endpoint first. It is the fastest source for both VIP and normal
  // tracks, and a logged-in session can resolve VIP entitlement between calls.
  noteLibraryStep('kugou', 'url:fast-attempt', { hasVipEntitlement });
  const fastHit = await runKGPlayStrategy(
    'lite-v5',
    () => fetchKGAndroidFastSongUrl(hash, albumId, albumAudioId, cookieHeader, vipType, q)
      .then((url) => (url ? { url, source: 'android-fast-v5' } : null)),
    KG_FAST_SONG_URL_DEADLINE_MS,
  );
  if (fastHit && fastHit.url) return fastHit;

  // Keep the cheap v5/playInfo sources ahead of the tracker fan-out. The tracker path can
  // launch a dozen requests; doing that while audio is loading makes playback feel slow.
  const preferredTasks = [
    () => runKGPlayStrategy('v5', () => fetchKGTrackerV5Url(hash, albumId, albumAudioId, cookieHeader, vipType, q)
      .then((result) => (result.url ? { url: result.url, source: 'v5', tracker: result } : null))),
    () => runKGPlayStrategy('playInfo', () => fetchKGPlayInfo(hash, albumAudioId, cookieHeader)
      .then((info) => {
        const url = pickPlayInfoUrl(info);
        return url ? { url, source: 'playInfo' } : null;
      })),
  ];
  const preferredHit = await raceKGPlayTasks(preferredTasks, (result) => result);
  if (preferredHit && preferredHit.url) return preferredHit;

  const fallbackTasks = [
    () => runKGPlayStrategy('getdata', () => fetchKGPlayGetData(hash, albumId, albumAudioId, cookieHeader, vipType)
      .then((url) => (url ? { url, source: 'getdata' } : null))),
    () => runKGPlayStrategy('tracker', () => fetchKGTrackerUrl(hash, albumId, albumAudioId, cookieHeader, vipType)
      .then((result) => (result.url ? { url: result.url, source: 'tracker', tracker: result } : null))),
  ];
  return raceKGPlayTasks(fallbackTasks, (result) => result);
}

async function resolveKGSongPlayUrl(hash, albumId, albumAudioId, cookieHeader, login, qualityCode) {
  const cacheKey = [
    String(hash || '').trim().toLowerCase(),
    String(albumId || ''),
    String(albumAudioId || ''),
    Number(qualityCode) || 128,
    buildKGSessionCacheKey(cookieHeader),
  ].join('|');
  const existing = kgPlayUrlResolutionInFlight.get(cacheKey);
  if (existing) return existing;

  const request = resolveKGSongPlayUrlUncached(hash, albumId, albumAudioId, cookieHeader, login, qualityCode);
  kgPlayUrlResolutionInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (kgPlayUrlResolutionInFlight.get(cacheKey) === request) {
      kgPlayUrlResolutionInFlight.delete(cacheKey);
    }
  }
}

async function fetchKGPlayGetData(hash, albumId, albumAudioId, cookieHeader, loginVipType) {
  hash = String(hash || '').trim().toLowerCase();
  if (!hash) return '';
  cookieHeader = await enrichKGCookieHeader(cookieHeader);
  const userId = kgCookieUserId(cookieHeader) || '0';
  const token = kgCookieToken(cookieHeader) || '';
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader);
  const cached = await loadKGVipSessionCache(userId);
  const vipToken = resolveKGEffectiveVipToken(cookieHeader, cached);
  const u = new URL('https://wwwapi.kugou.com/yy/index.php');
  u.searchParams.set('r', 'play/getdata');
  u.searchParams.set('hash', hash);
  u.searchParams.set('album_id', albumId || '0');
  if (albumAudioId) u.searchParams.set('album_audio_id', String(albumAudioId));
  u.searchParams.set('mid', mid);
  u.searchParams.set('dfid', dfid);
  u.searchParams.set('platid', '4');
  u.searchParams.set('from', 'mkugou');
  if (token) {
    u.searchParams.set('appid', String(KG_ANDROID_APPID));
    u.searchParams.set('clientver', String(KG_ANDROID_CLIENTVER));
    u.searchParams.set('userid', userId);
    u.searchParams.set('token', token);
    u.searchParams.set('vipType', resolveKGTrackerVipType(cookieHeader, loginVipType || (cached && cached.vipType)));
    if (vipToken) u.searchParams.set('vip_token', vipToken);
  }
  try {
    const body = await kgFetchJSON(u.toString(), {
      referer: 'https://www.kugou.com/',
      headers: buildKGRequestHeaders(cookieHeader, token),
    });
    const data = body && body.data;
    const url = data && (data.play_url || data.play_backup_url || data.playUrl || data.url);
    if (typeof url === 'string' && url) {
      const harvested = harvestKGVipToken(body);
      if (harvested || Number(data && data.privilege) > 0) {
        await saveKGVipSessionCache(userId, {
          vipToken: harvested || vipToken,
          vipType: Number(resolveKGTrackerVipType(cookieHeader, loginVipType)) || 6,
          isVip: true,
        });
      }
      return url;
    }
    if (Array.isArray(url) && url[0]) return url[0];
  } catch (_) {}
  return '';
}

/** Only scheme + host: play urls carry signed paths and tokens, so the report must not quote them. */
function describeKGSchemeAndHost(url) {
  try {
    const parsed = new URL(String(url || ''), 'https://www.kugou.com/');
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return 'unparseable';
  }
}

function normalizePlayUrl(url) {
  url = String(url || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return 'http:' + url;
  if (url.startsWith('/')) return 'http://fs.open.kugou.com' + url;
  return 'http://fs.open.kugou.com/' + url.replace(/^\/+/, '');
}

/**
 * 取链失败时要不要现场补领概念版每日 VIP：歌曲被拦、已登录、没有任何 VIP 凭证、
 * 且距离上次尝试超过限流间隔才试。抽成纯函数以便单测（两版共用这段判断）。
 */
export function shouldClaimConceptVipOnFailure(input) {
  const { blocked, loggedIn, hasVipToken, isVip } = input || {};
  if (!blocked || !loggedIn || hasVipToken || isVip) return false;
  const now = Number(input.now) || Date.now();
  const lastAttemptAt = Number(input.lastAttemptAt) || 0;
  const intervalMs = Number(input.intervalMs) > 0 ? Number(input.intervalMs) : KG_CONCEPT_CLAIM_INTERVAL_MS;
  return (now - lastAttemptAt) > intervalMs;
}
// 概念版每日领取用的日期按中国日历算（官方客户端同款），不跟随设备时区。
function chinaCalendarDate(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  } catch (_) {
    return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}
export async function handleKGSongUrl(hash, albumId, albumAudioId, quality, cookieHeader, qualityHashes) {
  hash = String(hash || '').trim().toLowerCase();
  albumId = String(albumId || '').trim();
  albumAudioId = String(albumAudioId || '').trim();
  qualityHashes = qualityHashes || {};
  const hash320 = String(qualityHashes.hash320 || '').trim().toLowerCase();
  const hashSq = String(qualityHashes.hashSq || '').trim().toLowerCase();
  if (!hash) {
    return { provider: 'kg', url: '', playable: false, error: 'MISSING_HASH', message: 'Missing Kugou song hash' };
  }
  cookieHeader = cookieHeader || await getKGCookie();
  await syncKGVipCacheWithCookie(cookieHeader);
  // 会员歌曲的取链要带 vip_token，而扫码登录只带回 userid/token；没有 vip_token 时服务端一律
  // 回 status=2（会员校验不通过），表现为「所有酷狗歌都取不到地址」。这里在缺 vip_token 时强制
  // 走一次 login_by_token 换取，并限流，避免每次播放都打一次登录接口。
  const loginBeforeVip = await getKGPlayContext(cookieHeader);
  const vipCacheBefore = await loadKGVipSessionCache(loginBeforeVip.userId);
  const vipTokenBefore = !!resolveKGEffectiveVipToken(cookieHeader, vipCacheBefore);
  // 概念版会员没有 vip_token，但 .225 之后能以 vipType/isVip 记进缓存。认出来了就不再每 5 分钟
  // 强制做一次 login_by_token（那是每次播放多 1-2 秒等待），只有缓存里没有任何会员线索时才刷新。
  const vipRecognizedBefore = !!(vipCacheBefore && (vipCacheBefore.isVip || Number(vipCacheBefore.vipType) > 0));
  const shouldFetchVipToken = loginBeforeVip.loggedIn
    && !vipTokenBefore
    && !vipRecognizedBefore
    && (Date.now() - kgVipTokenRefreshAt) > KG_VIP_TOKEN_REFRESH_INTERVAL_MS;
  if (shouldFetchVipToken) {
    kgVipTokenRefreshAt = Date.now();
    noteLibraryStep('kugou', 'auth:vip-token:refresh', { userId: String(loginBeforeVip.userId || '').slice(0, 6) });
  } else if (vipRecognizedBefore && !vipTokenBefore) {
    noteLibraryStep('kugou', 'auth:vip-token:skip', {
      reason: 'vip-recognised-without-token',
      vipType: Number(vipCacheBefore.vipType) || 0,
    });
  }
  // 缓存里完全没有会员线索时，探一次 /user/vip/detail：它合并标准版/概念版/移动端的会员信息，
  // 比只问概念版 union VIP 更全（概念版换字段时也能命中），并按 5 分钟限流。
  if (loginBeforeVip.loggedIn && !vipTokenBefore && !vipRecognizedBefore
    && (Date.now() - kgUserVipProbeAt) > KG_USER_VIP_PROBE_INTERVAL_MS) {
    kgUserVipProbeAt = Date.now();
    try {
      const detail = await getKGUserVipDetail(cookieHeader);
      noteLibraryStep('kugou', 'auth:user-vip:probe', {
        isVip: !!(detail && detail.isVip),
        vipType: Number(detail && detail.vipType) || 0,
        error: (detail && detail.error) || '',
      });
    } catch (error) {
      noteLibraryStep('kugou', 'auth:user-vip:probe:error', {
        message: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
      });
    }
  }
  const auth = await ensureKGAndroidAuth(cookieHeader, { requireAppToken: true, force: shouldFetchVipToken });
  cookieHeader = auth.cookieHeader || await enrichKGCookieHeader(cookieHeader, { preferAppToken: true });
  const requestedQuality = normalizeQualityPreference(quality);
  const extra = { '128hash': hash };
  if (hash320) extra['320hash'] = hash320;
  if (hashSq) extra.sqhash = hashSq;
  const desiredLevels = qualityCandidatesFrom(requestedQuality, KG_QUALITY_OPTIONS).map((item) => item.level);
  const desiredLevel = desiredLevels[0] || 'standard';
  const qualityMap = extractKGQualityMap(extra, hash);
  if (!qualityMap[desiredLevel]) {
    try {
      const playInfo = await fetchKGPlayInfo(hash, albumAudioId, cookieHeader);
      Object.assign(extra, (playInfo && playInfo.extra) || {});
      if (playInfo && playInfo.hash) extra['128hash'] = String(playInfo.hash).trim().toLowerCase();
      if (!albumAudioId && playInfo) {
        albumAudioId = String(playInfo.mixsongid || playInfo.album_audio_id || playInfo.audio_id || '').trim();
      }
      if (!albumId && playInfo) {
        albumId = String(playInfo.albumid || playInfo.album_id || '').trim();
      }
    } catch (_) {}
  }
  const picked = pickKGHashForQuality(extra, hash, requestedQuality);
  const playHash = picked.hash;
  if (!playHash) {
    return { provider: 'kg', url: '', playable: false, error: 'MISSING_HASH', message: 'Missing Kugou song hash' };
  }
  const qualityCode = picked.level === 'lossless' ? 'flac' : (picked.level === 'exhigh' ? 320 : 128);
  const cacheKey = buildKGPlayUrlCacheKey(playHash, albumId, albumAudioId, picked.level);
  let login = await getKGPlayContext(cookieHeader);
  const hasVipToken = !!resolveKGEffectiveVipToken(cookieHeader, await loadKGVipSessionCache(login.userId));
  const successPayload = (url, source) => ({
    provider: 'kg',
    url: normalizePlayUrl(url),
    playable: true,
    loggedIn: login.loggedIn,
    isVip: login.isVip,
    vipType: login.vipType,
    vipLabel: login.vipLabel,
    hasVipToken,
    level: picked.level,
    quality: picked.label,
    br: picked.br,
    requestedQuality,
    playHash,
    source,
  });
  const cachedUrl = readKGPlayUrlCache(cacheKey);
  if (cachedUrl) return successPayload(cachedUrl, 'cache');
  let trackerResult = { url: '', status: 0, blocked: false };
  const resolveStartedAt = Date.now();
  noteLibraryStep('kugou', 'url:start', {
    hash: playHash.slice(0, 8),
    quality: qualityCode,
    level: picked.level,
    loggedIn: login.loggedIn,
    isVip: login.isVip,
  });
  try {
    const hit = await resolveKGSongPlayUrl(playHash, albumId, albumAudioId, cookieHeader, login, qualityCode);
    if (hit && hit.url) {
      writeKGPlayUrlCache(cacheKey, hit.url);
      if (hit.tracker) trackerResult = hit.tracker;
      noteLibraryStep('kugou', 'url:hit', {
        source: hit.source,
        ms: Date.now() - resolveStartedAt,
        target: describeKGSchemeAndHost(hit.url),
      });
      return successPayload(hit.url, hit.source);
    }
    if (hit && hit.tracker) trackerResult = hit.tracker;
    noteLibraryStep('kugou', 'url:miss', {
      ms: Date.now() - resolveStartedAt,
      status: trackerResult.status || 0,
      blocked: !!trackerResult.blocked,
      loggedIn: login.loggedIn,
    });
    // One forced auth refresh then retry once for VIP tracks. If the first refresh already
    // resolved to "logged in but no VIP token / no VIP type", another full strategy pass cannot
    // turn that into an entitlement and only adds another long wait.
    const currentVipToken = !!resolveKGEffectiveVipToken(
      cookieHeader,
      await loadKGVipSessionCache(login.userId),
    );
    const retryMayRecoverVip = login.loggedIn && (!auth.refreshed || currentVipToken || Number(login.vipType) > 0);
    if ((trackerResult.blocked || trackerResult.status === 2 || !hit || !hit.url) && retryMayRecoverVip) {
      if (!auth.refreshed) {
        const forced = await ensureKGAndroidAuth(cookieHeader, { force: true, requireAppToken: true });
        cookieHeader = forced.cookieHeader || cookieHeader;
      } else {
        // Cached appToken may be stale — drop it and retry with fresh login_by_token.
        await clearKGVipAppToken(login.userId);
        const forced = await ensureKGAndroidAuth(cookieHeader, { force: true, requireAppToken: true });
        cookieHeader = forced.cookieHeader || cookieHeader;
      }
      // 强制刷新里同时做了标准版 token 刷新和概念版会员探测：用刷新后的登录态重试，
      // 否则重试仍按刷新前的「免费账号」判断，概念版会员这一轮就白刷了。
      const loginBeforeRetry = login;
      login = await getKGPlayContext(cookieHeader);
      if (login.vipType !== loginBeforeRetry.vipType || login.isVip !== loginBeforeRetry.isVip) {
        noteLibraryStep('kugou', 'url:retry-vip-state', {
          vipTypeBefore: Number(loginBeforeRetry.vipType) || 0,
          vipTypeAfter: Number(login.vipType) || 0,
          isVipBefore: !!loginBeforeRetry.isVip,
          isVipAfter: !!login.isVip,
        });
      }
      const retry = await resolveKGSongPlayUrl(playHash, albumId, albumAudioId, cookieHeader, login, qualityCode);
      if (retry && retry.url) {
        writeKGPlayUrlCache(cacheKey, retry.url);
        noteLibraryStep('kugou', 'url:hit', {
          source: `${retry.source}+auth-retry`,
          ms: Date.now() - resolveStartedAt,
          target: describeKGSchemeAndHost(retry.url),
        });
        return successPayload(retry.url, retry.source);
      }
      if (retry && retry.tracker) trackerResult = retry.tracker;
      noteLibraryStep('kugou', 'url:retry-miss', {
        ms: Date.now() - resolveStartedAt,
        status: trackerResult.status || 0,
        blocked: !!trackerResult.blocked,
      });
    } else if ((trackerResult.blocked || trackerResult.status === 2 || !hit || !hit.url) && login.loggedIn) {
      noteLibraryStep('kugou', 'url:retry-skip', {
        reason: 'no-vip-entitlement-after-refresh',
        hasVipToken: currentVipToken,
        vipType: Number(login.vipType) || 0,
      });
    }

    // 概念版还有一条路：会员歌曲取不到链、账号又完全没有 VIP 时，现场领一次当天的畅听 VIP 再试。
    // 已领过的那天服务端会拒绝，不会重复领取；标准版账号没领过时也可能受益，行为与官方客户端一致。
    const stillBlocked = trackerResult.blocked || trackerResult.status === 2;
    const cacheAfterRetry = await loadKGVipSessionCache(login.userId);
    const hasVipTokenAfterRetry = !!resolveKGEffectiveVipToken(cookieHeader, cacheAfterRetry);
    // 概念版会员（vipType=6/33）在缓存里会被记成 isVip=true，于是「已经是 VIP」把领取挡在门外，
    // 但概念版 VIP 并不等于畅听权益：主站取链回的 status=3/trackerStatus=0 就是这么来的。
    // 以前只在 status=2（会员被拦）时领，概念版这种「认成 VIP 却没权益」的情况一次都领不到。
    // 这里把概念版账号也当成需要领取：每日权益服务端只发一次，重复领取会被拒，不会造成刷接口。
    const conceptAccount = !hasVipTokenAfterRetry && (Number(login.vipType) === 6 || Number(login.vipType) === 33);
    const shouldClaim = shouldClaimConceptVipOnFailure({
      blocked: stillBlocked || conceptAccount,
      loggedIn: login.loggedIn,
      hasVipToken: hasVipTokenAfterRetry,
      isVip: conceptAccount ? false : !!login.isVip,
      lastAttemptAt: kgConceptClaimAt,
      intervalMs: KG_CONCEPT_CLAIM_INTERVAL_MS,
    });
    if (shouldClaim) {
      kgConceptClaimAt = Date.now();
      try {
        const claimDay = chinaCalendarDate();
        noteLibraryStep('kugou', 'vip:claim-on-fail:start', { day: claimDay });
        await claimKGYouthDayVip(cookieHeader, claimDay);
        await upgradeKGYouthDayVip(cookieHeader, login.userId);
        const afterClaim = await resolveKGSongPlayUrl(playHash, albumId, albumAudioId, cookieHeader, login, qualityCode);
        if (afterClaim && afterClaim.url) {
          writeKGPlayUrlCache(cacheKey, afterClaim.url);
          noteLibraryStep('kugou', 'url:hit', {
            source: `${afterClaim.source}+concept-claim`,
            ms: Date.now() - resolveStartedAt,
            target: describeKGSchemeAndHost(afterClaim.url),
          });
          return successPayload(afterClaim.url, afterClaim.source);
        }
        noteLibraryStep('kugou', 'vip:claim-on-fail:miss', { status: (afterClaim && afterClaim.tracker && afterClaim.tracker.status) || 0 });
      } catch (error) {
        noteLibraryStep('kugou', 'vip:claim-on-fail:error', {
          message: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
        });
      }
    }
  } catch (_) {}
  const blocked = trackerResult.blocked || trackerResult.status === 2;
  const likelyVipSong = blocked || trackerResult.status === 2;
  const vipCacheNow = await loadKGVipSessionCache(login.userId);
  const vipTokenNow = !!resolveKGEffectiveVipToken(cookieHeader, vipCacheNow);
  const hasAppToken = !!(vipCacheNow && vipCacheNow.appToken);
  noteLibraryStep('kugou', 'url:fail', {
    ms: Date.now() - resolveStartedAt,
    error: !login.loggedIn ? 'LOGIN_REQUIRED' : (likelyVipSong ? 'VIP_REQUIRED' : 'URL_UNAVAILABLE'),
    trackerStatus: trackerResult.status || 0,
    loggedIn: login.loggedIn,
    hasVipToken: vipTokenNow,
    hasAppToken,
  });
  return {
    provider: 'kg',
    url: '',
    playable: false,
    loggedIn: login.loggedIn,
    isVip: login.isVip,
    vipType: login.vipType,
    vipLabel: login.vipLabel,
    hasVipToken: vipTokenNow,
    hasAppToken,
    error: !login.loggedIn ? 'LOGIN_REQUIRED' : (likelyVipSong ? 'VIP_REQUIRED' : 'URL_UNAVAILABLE'),
    reason: !login.loggedIn ? 'login_required' : (likelyVipSong ? 'vip_required' : 'url_unavailable'),
    message: !login.loggedIn
      ? '酷狗会员歌曲需要登录后播放'
      : (likelyVipSong
        ? (vipTokenNow
          ? '酷狗会员歌曲取链失败。请确认会员未过期，或在官网重新登录后再试'
          : '未拿到 vip_token（网页 Cookie 换安卓凭证失败）。请在 www.kugou.com 重新完整登录后点「刷新登录状态」')
        : '酷狗未返回播放地址，请确认账号会员有效并在官网重新登录'),
    trackerStatus: trackerResult.status || 0,
  };
}

function decodeKGLyricContent(content) {
  content = String(content || '').trim();
  if (!content) return '';
  try {
    // KuGou download returns base64 for LRC content
    if (!content.includes('[') && /^[A-Za-z0-9+/=\s]+$/.test(content)) {
      const bin = atob(content.replace(/\s+/g, ''));
      let decoded = '';
      try {
        decoded = decodeURIComponent(escape(bin));
      } catch (_) {
        decoded = bin;
      }
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) return decoded;
    }
  } catch (_) {}
  return content;
}

function isValidKGLyricText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 8) return false;
  // m.kugou.com often replies "No Action Found!" with HTTP 200
  if (/no action found|not found|找不到|暂无歌词|<html|<!doctype/i.test(t)) return false;
  // LRC 的行头是 [mm:ss.xxx]，KRC 的行头是 [起始毫秒,时长毫秒]（没有冒号）。
  // 只认前者会把解密后的 KRC 判成无效，于是又退回 LRC。
  return /\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/.test(t) || /\[\d+,\d+\]/.test(t);
}

function normalizeKGLyricDurationMs(duration) {
  const n = Number(duration) || 0;
  if (!n) return 0;
  // Frontend/mapKGSong stores ms; raw search seconds stay < 10000
  if (n > 0 && n < 10000) return Math.round(n * 1000);
  return Math.round(n);
}

async function fetchKGBasicLrc(hash) {
  if (!hash) return '';
  const urls = [
    `https://m.kugou.com/krc/${encodeURIComponent(hash)}.lrc`,
    `http://m.kugou.com/krc/${encodeURIComponent(hash)}.lrc`,
  ];
  for (const url of urls) {
    try {
      const text = await kgFetchText(url, {
        mobile: true,
        referer: 'https://m.kugou.com/',
      });
      const chars = String(text || '').trim().length;
      noteLibraryStep('kugou', 'lyric:basic:done', { host: 'm.kugou.com', chars, valid: isValidKGLyricText(text) });
      if (isValidKGLyricText(text)) return String(text).trim();
    } catch (error) {
      // 这条兜底以前把异常完全吞掉：失败与「确实没有歌词」在诊断里长得一样。
      noteLibraryStep('kugou', 'lyric:basic:error', { host: 'm.kugou.com', message: String(error && error.message || error) });
    }
  }
  return '';
}

async function searchKGLyricCandidates(hash, albumAudioId, durationMs, keyword) {
  const keywordText = String(keyword || '').trim();
  const attempts = [
    {
      url: 'https://krcs.kugou.com/search',
      params: {
        ver: '1',
        man: 'yes',
        client: 'mobi',
        keyword: keywordText,
        hash: hash || '',
        album_audio_id: albumAudioId || '',
        duration: durationMs ? String(durationMs) : '',
        lrctxt: '1',
      },
    },
    {
      url: 'https://lyrics.kugou.com/v1/search',
      params: {
        ver: '1',
        man: 'yes',
        client: 'pc',
        keyword: keywordText || hash || '',
        hash: hash || '',
        album_audio_id: albumAudioId || '0',
        duration: durationMs ? String(durationMs) : '0',
        lrctxt: '1',
      },
    },
    keywordText ? {
      url: 'https://krcs.kugou.com/search',
      params: {
        ver: '1',
        man: 'yes',
        client: 'pc',
        keyword: keywordText,
        hash: '',
        duration: durationMs ? String(durationMs) : '',
        lrctxt: '1',
      },
    } : null,
  ].filter(Boolean);

  for (const attempt of attempts) {
    try {
      const u = new URL(attempt.url);
      Object.keys(attempt.params).forEach((key) => {
        if (attempt.params[key] !== '' && attempt.params[key] != null) {
          u.searchParams.set(key, String(attempt.params[key]));
        }
      });
      const search = await kgFetchJSON(u.toString(), {
        mobile: true,
        referer: 'https://www.kugou.com/',
        headers: { 'User-Agent': KG_UA_MOBILE },
      });
      const list = (search && (search.candidates || (search.data && search.data.candidates))) || [];
      noteLibraryStep('kugou', 'lyric:search:attempt', {
        host: u.host,
        count: Array.isArray(list) ? list.length : 0,
        status: search && (search.status ?? search.error_code),
      });
      if (Array.isArray(list) && list.length) return list;
    } catch (error) {
      // 之前这里 catch (_) {}：请求失败与「上游没有候选」都变成空数组，报告里看不出区别。
      noteLibraryStep('kugou', 'lyric:search:attempt', {
        host: (() => { try { return new URL(attempt.url).host; } catch (_) { return attempt.url; } })(),
        error: String(error && error.message || error),
      });
    }
  }
  noteLibraryStep('kugou', 'lyric:search:empty', { attempts: attempts.length });
  return [];
}

// base64 -> bytes：KRC 要先按字节取出再解密，不能先当字符串处理。
function base64ToBytes(value) {
  const bin = atob(String(value || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 按调用方要的格式取歌词。provider 请求的是 fmt=krc + decode（拿到解密后的 KRC 文本，
 * parseKRC 才能解析逐字），而这里以前固定下 fmt=lrc —— 于是返回的是 LRC 文本，
 * 被 provider 当 KRC 解析，`[数字,数字]` 行一条都匹配不到。现在 krc 优先、失败退回 lrc。
 */
async function downloadKGLyricByCandidate(candidate, options = {}) {
  if (!candidate || !candidate.id || !candidate.accesskey) return '';
  const formats = String(options.fmt || '').toLowerCase() === 'krc' ? ['krc', 'lrc'] : ['lrc'];
  for (const fmt of formats) {
    for (const base of ['https://lyrics.kugou.com/download', 'http://lyrics.kugou.com/download']) {
      try {
        const dl = new URL(base);
        dl.searchParams.set('ver', '1');
        dl.searchParams.set('client', 'pc');
        dl.searchParams.set('id', String(candidate.id));
        dl.searchParams.set('accesskey', String(candidate.accesskey));
        dl.searchParams.set('fmt', fmt);
        dl.searchParams.set('charset', 'utf8');
        const body = await kgFetchJSON(dl.toString(), {
          referer: 'https://www.kugou.com/',
          headers: { 'User-Agent': KG_UA_PC },
        });
        const raw = body && (body.content || (body.data && body.data.content));
        let lyric = '';
        if (fmt === 'krc') {
          try {
            lyric = await krcDecrypt(base64ToBytes(raw));
          } catch (error) {
            noteLibraryStep('kugou', 'lyric:krc:error', { message: String(error && error.message || error) });
          }
        } else {
          lyric = decodeKGLyricContent(raw);
        }
        noteLibraryStep('kugou', 'lyric:download:attempt', {
          host: dl.host,
          fmt,
          chars: String(lyric || '').length,
          valid: isValidKGLyricText(lyric),
          status: body && (body.status ?? body.error_code),
        });
        if (isValidKGLyricText(lyric)) return lyric;
      } catch (error) {
        noteLibraryStep('kugou', 'lyric:download:error', {
          host: (() => { try { return new URL(base).host; } catch (_) { return base; } })(),
          fmt,
          message: String(error && error.message || error),
        });
      }
    }
  }
  return '';
}

export async function handleKGLyric(hash, albumAudioId, duration, keyword) {
  hash = String(hash || '').trim().toLowerCase();
  albumAudioId = String(albumAudioId || '').trim();
  keyword = String(keyword || '').trim();
  if (!hash && !keyword) return { provider: 'kg', lyric: '', error: 'MISSING_HASH' };

  let lyric = hash ? await fetchKGBasicLrc(hash) : '';
  if (isValidKGLyricText(lyric)) return { provider: 'kg', lyric, source: 'basic' };

  const durationMs = normalizeKGLyricDurationMs(duration);
  try {
    const candidates = await searchKGLyricCandidates(hash, albumAudioId, durationMs, keyword);
    for (const candidate of candidates.slice(0, 4)) {
      lyric = await downloadKGLyricByCandidate(candidate);
      if (isValidKGLyricText(lyric)) {
        return { provider: 'kg', lyric, source: 'krc' };
      }
    }
  } catch (_) {}
  return { provider: 'kg', lyric: '' };
}

/**
 * KuGouMusicApi `/user/playlist`
 * POST gateway `/v7/get_all_list` (+ type 0/1 fallbacks)
 * Requires android token (appid=1005). Web cookie token alone → error 20017.
 */
async function fetchKGUserPlaylistOfficial(cookieHeader, page, pagesize, opts) {
  opts = opts || {};
  const preferApp = opts.preferAppToken !== false;
  cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: preferApp });
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) {
    return { ok: false, lists: [], attempts: [], error: 'NOT_LOGGED_IN' };
  }
  page = Math.max(1, Number(page) || 1);
  pagesize = Math.max(1, Math.min(100, Number(pagesize) || 50));
  const attempts = [];
  const merged = [];
  const seen = new Set();
  // 裸域名 + x-router 才是可用形式（见 KG_CLOUDLIST_GATEWAY 的注释）；两个候选曾经同形，
  // 现在合成一条，避免失败时白白多发一轮。
  const endpoints = [
    { base: KG_CLOUDLIST_GATEWAY, path: '/v7/get_all_list', headers: KG_CLOUDLIST_ROUTER },
  ];
  // type 2=全部；若网关对 type=2 失败再拆 0 自建 / 1 收藏
  for (const listType of [2, 0, 1]) {
    for (let p = page; p <= page + 8; p += 1) {
      let pageLists = [];
      let pageOk = false;
      for (const endpoint of endpoints) {
        try {
          const body = await kgPostAndroidSigned(
            endpoint.base,
            endpoint.path,
            cookieHeader,
            {
              userid: userId,
              token,
              total_ver: 979,
              type: listType,
              page: p,
              pagesize,
            },
            { plat: 1, userid: Number(userId) || userId, token },
            KG_CLOUDLIST_ROUTER,
            { preferAppToken: preferApp },
          );
          const lists = extractKGCloudLists(body);
          attempts.push({
            path: `${endpoint.base}${endpoint.path}`,
            page: p,
            type: listType,
            ok: kgCloudlistOk(body),
            status: body && body.status,
            error_code: body && body.error_code,
            count: Array.isArray(lists) ? lists.length : 0,
          });
          if (Array.isArray(lists) && lists.length) {
            pageLists = lists.map((item) => Object.assign({}, item, {
              type: item.type != null ? item.type : listType,
            }));
            pageOk = true;
            break;
          }
          if (kgCloudlistOk(body)) {
            pageOk = true;
            pageLists = [];
            break;
          }
        } catch (err) {
          attempts.push({
            path: `${endpoint.base}${endpoint.path}`,
            page: p,
            type: listType,
            ok: false,
            error: err && err.message ? err.message : String(err || 'error'),
          });
        }
      }
      if (!pageOk && !pageLists.length) break;
      pageLists.forEach((item) => {
        const key = String(kgPlaylistListId(item) || kgPlaylistGlobalId(item) || item.specialid || item.id || '');
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
      if (pageLists.length < pagesize) break;
    }
    // type=2 已有数据时不必再拆 0/1（仍可再拆补漏，但有数据就够）
    if (listType === 2 && merged.length) break;
  }
  return {
    ok: merged.length > 0,
    lists: merged,
    attempts,
    error: merged.length ? '' : 'KG_PLAYLIST_EMPTY',
  };
}

async function fetchKGWebSignedLists(cookieHeader) {
  // Web signature + PC token (never use android appToken here).
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieWebToken(cookieHeader) || kgCookieToken(cookieHeader);
  cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: false });
  if (!userId || !token) return { lists: [], attempts: [] };
  const mid = await getKGMid(cookieHeader);
  const dfid = kgCookieDfid(cookieHeader) || '-';
  const leanCookie = buildKGLeanCookie(cookieHeader);
  const attempts = [];
  const merged = new Map();
  const endpoints = [
    { base: 'https://wwwapi.kugou.com', path: '/cloudlist.service/v1/get_all_list', appid: 1014, clientver: 9003 },
    { base: 'https://wwwapi.kugou.com', path: '/cloudlist/v1/get_all_list', appid: 1014, clientver: 9003 },
    { base: 'https://gateway.kugou.com', path: '/cloudlist.service/v1/get_all_list', appid: 1014, clientver: 9003 },
  ];

  for (const endpoint of endpoints) {
    for (const listType of [2, 0, 1]) {
      try {
        const clienttime = Math.floor(Date.now() / 1000);
        const params = {
          appid: endpoint.appid,
          clientver: endpoint.clientver,
          clienttime,
          mid,
          uuid: mid,
          dfid,
          userid: userId,
          token,
          type: listType,
          page: 1,
          pagesize: 100,
          plat: 1,
        };
        params.signature = signatureKGWebParams(params);
        const qs = Object.keys(params)
          .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
          .join('&');
        const body = await kgFetchJSON(`${endpoint.base}${endpoint.path}?${qs}`, {
          referer: 'https://www.kugou.com/',
          headers: {
            Cookie: leanCookie,
            'User-Agent': KG_UA_PC,
            Accept: 'application/json, text/plain, */*',
          },
        });
        const lists = extractKGCloudLists(body);
        attempts.push({
          path: `${endpoint.base}${endpoint.path}`,
          type: listType,
          ok: kgCloudlistOk(body) || !!(lists && lists.length),
          status: body && body.status,
          error_code: body && (body.error_code || body.errcode || body.error),
          count: Array.isArray(lists) ? lists.length : 0,
        });
        (Array.isArray(lists) ? lists : []).forEach((item) => {
          const pl = mapKGPlaylist(Object.assign({}, item, {
            type: item.type != null ? item.type : listType,
          }), userId);
          if (!keepKGUserPlaylist(pl, userId)) return;
          const key = String(pl.listId || pl.globalCollectionId || pl.id);
          const prev = merged.get(key);
          if (!prev) merged.set(key, pl);
          else {
            merged.set(key, Object.assign({}, prev, pl, {
              trackCount: Math.max(prev.trackCount || 0, pl.trackCount || 0),
              subscribed: !!(prev.subscribed || pl.subscribed),
              isFavorite: !!(prev.isFavorite || pl.isFavorite),
            }));
          }
        });
      } catch (err) {
        attempts.push({
          path: `${endpoint.base}${endpoint.path}`,
          type: listType,
          ok: false,
          error: err && err.message ? err.message : String(err || 'error'),
        });
      }
    }
    if (merged.size) break;
  }
  return { lists: Array.from(merged.values()), attempts };
}

async function fetchKGPlaylistCoverFromTracks(listId, globalCollectionId, cookieHeader) {
  listId = String(listId || '').trim();
  globalCollectionId = String(globalCollectionId || '').trim();
  const pickCover = (arr) => {
    for (const item of Array.isArray(arr) ? arr : []) {
      const song = item && item.hash ? item : mapKGSong(item, false);
      const cover = normalizeKGCover((song && song.cover) || extractKGCover(item, 240), 240);
      if (cover) return cover;
    }
    return '';
  };
  cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: true });
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (listId && userId && token) {
    try {
      const body = await kgPostAndroidSigned(
        'https://gateway.kugou.com',
        '/v4/get_list_all_file',
        cookieHeader,
        {
          listid: Number(listId) || listId,
          userid: Number(userId) || userId,
          token,
          area_code: 1,
          show_relate_goods: 0,
          pagesize: 8,
          allplatform: 1,
          show_cover: 1,
          type: 0,
          page: 1,
        },
        {},
        KG_CLOUDLIST_ROUTER,
        { preferAppToken: true },
      );
      const cover = pickCover(extractKGCloudLists(body));
      if (cover) return cover;
    } catch (_) {}
  }
  if (globalCollectionId) {
    try {
      const body = await kgFetchAndroidSigned(
        'https://gateway.kugou.com',
        '/pubsongs/v2/get_other_list_file_nofilt',
        cookieHeader,
        {
          area_code: 1,
          begin_idx: 0,
          plat: 1,
          type: 1,
          mode: 1,
          personal_switch: 1,
          pagesize: 8,
          global_collection_id: globalCollectionId,
        },
        {},
      );
      const cover = pickCover(extractKGCloudLists(body));
      if (cover) return cover;
    } catch (_) {}
  }
  return '';
}

async function enrichKGFavoritePlaylist(playlists, cookieHeader, userId) {
  let list = (Array.isArray(playlists) ? playlists : []).filter((pl) => keepKGUserPlaylist(pl, userId));
  // Pick the best heart list — never prefer empty 「默认收藏」 over 「我喜欢」 with songs
  const favCandidates = list.filter((pl) => pl && (
    pl.isFavorite || isKGFavoriteName(pl.name) || String(pl.listId) === '2' || String(pl.id) === '2'
  ));
  let bestFav = pickKGFavoriteList(favCandidates.map((pl) => ({
    name: pl.name,
    listid: pl.listId || pl.id,
    count: pl.trackCount,
    is_default: pl.isFavorite ? 1 : 0,
    is_favorite: pl.isFavorite ? 1 : 0,
    type: pl.listType,
    global_collection_id: pl.globalCollectionId,
  })));
  let realFavId = String(kgPlaylistListId(bestFav) || (bestFav && (bestFav.listid || bestFav.listId)) || '').trim();
  let realFavCount = kgPlaylistSongCount(bestFav);
  let realFavGlobal = String((bestFav && (bestFav.global_collection_id || bestFav.globalCollectionId)) || '').trim();

  if (!realFavId) {
    try {
      realFavId = String(await fetchKGFavoriteListId(cookieHeader, true) || '').trim();
    } catch (_) {}
  }
  if (!realFavId && favCandidates.length) {
    // Fall back to candidate with highest trackCount
    favCandidates.sort((a, b) => (Number(b.trackCount) || 0) - (Number(a.trackCount) || 0));
    realFavId = String(favCandidates[0].listId || favCandidates[0].id || '').trim();
    realFavCount = Number(favCandidates[0].trackCount) || 0;
    realFavGlobal = String(favCandidates[0].globalCollectionId || '').trim();
  }
  if (!realFavGlobal && realFavId && userId) {
    realFavGlobal = `collection_3_${userId}_${realFavId}_0`;
  }

  // Collapse 默认收藏 / 我喜欢 duplicates into one 「我喜欢」
  if (realFavId) {
    let cover = (favCandidates.find((pl) => pl.cover) || {}).cover || '';
    const maxCount = Math.max(
      realFavCount,
      ...favCandidates.map((pl) => Number(pl.trackCount) || 0),
      0,
    );
    const creator = (favCandidates.find((pl) => pl.creator) || {}).creator || '酷狗音乐';
    // API often omits cover for heart lists — use the first song art
    if (!cover && maxCount > 0) {
      try {
        cover = await fetchKGPlaylistCoverFromTracks(realFavId, realFavGlobal, cookieHeader);
      } catch (_) {}
    }
    list = list.filter((pl) => !(
      pl && (pl.isFavorite || isKGFavoriteName(pl.name) || String(pl.listId) === '2' || String(pl.id) === '2')
    ));
    list.unshift({
      provider: 'kg',
      source: 'kg',
      type: 'playlist',
      id: realFavId,
      listId: realFavId,
      globalCollectionId: realFavGlobal,
      name: '我喜欢',
      cover,
      trackCount: maxCount,
      creator,
      ownerId: String(userId || ''),
      subscribed: false,
      isFavorite: true,
      listType: 0,
      ownedByMe: true,
    });
  }

  list.sort((a, b) => {
    const af = Number(!!(a && a.isFavorite));
    const bf = Number(!!(b && b.isFavorite));
    if (af !== bf) return bf - af;
    const as = Number(!!(a && a.subscribed));
    const bs = Number(!!(b && b.subscribed));
    if (as !== bs) return as - bs;
    return 0;
  });
  return list;
}

function summarizeKGPlaylistAttempts(attempts) {
  const fails = (attempts || []).filter((a) => a && !a.ok).slice(0, 3);
  if (!fails.length) return '';
  return fails.map((a) => {
    const code = a.error_code != null ? a.error_code : (a.error || a.status || '?');
    return `${a.path || 'api'}@t${a.type}:${code}`;
  }).join(' | ');
}

export async function handleKGUserPlaylists(cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  await syncKGVipCacheWithCookie(cookieHeader);
  const userId = kgCookieUserId(cookieHeader);
  const webToken = kgCookieWebToken(cookieHeader) || kgCookieToken(cookieHeader);
  if (!userId || !webToken) {
    return { provider: 'kg', loggedIn: false, playlists: [], message: '未登录酷狗，无法获取歌单' };
  }

  // error 20017 = web token + android signature. Convert via login_by_token first.
  const cachedAuth = await loadKGVipSessionCache(userId);
  const auth = await ensureKGAndroidAuth(cookieHeader, {
    requireAppToken: true,
    force: !(cachedAuth && cachedAuth.appToken && cachedAuth.sourceToken === webToken),
  });
  cookieHeader = auth.cookieHeader || cookieHeader;
  const hasAppToken = !!(auth && auth.hasAppToken);

  let playlists = [];
  let source = 'empty';
  let attempts = [];
  attempts.push({
    path: 'login_by_token',
    type: '-',
    ok: hasAppToken,
    error_code: hasAppToken ? 0 : 'NO_APP_TOKEN',
  });

  if (hasAppToken) {
    try {
      const official = await fetchKGUserPlaylistOfficial(cookieHeader, 1, 50, { preferAppToken: true });
      attempts = attempts.concat(official.attempts || []);
      playlists = (official.lists || [])
        .map((item) => mapKGPlaylist(item, userId))
        .filter((pl) => keepKGUserPlaylist(pl, userId));
      if (playlists.length) source = 'user/playlist';
    } catch (_) {}
  }

  // Web-signed (appid 1014) works with PC cookie when android convert fails.
  if (!playlists.length) {
    try {
      const web = await fetchKGWebSignedLists(cookieHeader);
      attempts = attempts.concat(web.attempts || []);
      // Keep owner-matched first; if empty, keep numeric cloudlist rows from authenticated call
      let webLists = (web.lists || []).filter((pl) => keepKGUserPlaylist(pl, userId));
      if (!webLists.length && web.lists && web.lists.length) {
        webLists = web.lists.filter((pl) => pl && /^\d+$/.test(String(pl.listId || pl.id || '')));
      }
      if (webLists.length) {
        playlists = webLists;
        source = 'web-signed';
      }
    } catch (_) {}
  }

  playlists = await enrichKGFavoritePlaylist(playlists, cookieHeader, userId);

  const created = playlists.filter((pl) => pl && !pl.subscribed && !pl.isFavorite).length;
  const collected = playlists.filter((pl) => pl && pl.subscribed).length;
  const hint = summarizeKGPlaylistAttempts(attempts);
  const code20017 = (attempts || []).some((a) => Number(a.error_code) === 20017);
  let message = '';
  if (!playlists.length) {
    if (!hasAppToken) {
      message = '网页登录凭证无法换成安卓 token（会员歌/云歌单都需要）。请在 www.kugou.com 退出后重新完整登录，再点「刷新登录状态」';
    } else if (code20017) {
      message = `酷狗鉴权失败 20017，安卓 token 可能无效。请重新登录酷狗后再试${hint ? `（${hint}）` : ''}`;
    } else {
      message = `未获取到酷狗歌单，请在 www.kugou.com 重新登录后再刷新${hint ? `（${hint}）` : ''}`;
    }
  }
  return {
    provider: 'kg',
    loggedIn: true,
    userId,
    playlists,
    count: playlists.length,
    createdCount: created,
    collectedCount: collected,
    source,
    hasAppToken,
    hasVipToken: !!auth.vipToken,
    attempts: attempts.slice(0, 20),
    message,
  };
}

async function fetchKGCloudlistTracks(listId, cookieHeader) {
  listId = String(listId || '').trim();
  if (!listId) return [];
  cookieHeader = await enrichKGCookieHeader(cookieHeader, { preferAppToken: true });
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const pageSize = 300;
  // Official playlist_track_all_new uses /v4/get_list_all_file
  const attempts = [
    { base: KG_CLOUDLIST_GATEWAY, path: '/v4/get_list_all_file', headers: KG_CLOUDLIST_ROUTER },
    { base: KG_CLOUDLIST_GATEWAY, path: '/v2/get_list_all_file', headers: KG_CLOUDLIST_ROUTER },
  ];
  for (const listType of [0, 1]) {
    for (const endpoint of attempts) {
      let page = 1;
      let total = Infinity;
      const tracks = [];
      while (tracks.length < total && page <= 30) {
        const body = await kgPostAndroidSigned(
          endpoint.base,
          endpoint.path,
          cookieHeader,
          {
            listid: Number(listId) || listId,
            userid: Number(userId) || userId,
            token,
            area_code: 1,
            show_relate_goods: 0,
            pagesize: pageSize,
            allplatform: 1,
            show_cover: 1,
            type: listType,
            page,
          },
          {},
          endpoint.headers,
          { preferAppToken: true },
        );
        if (!body) break;
        if (Number(body.status) === 0 && Number(body.error_code) !== 0) break;
        const info = extractKGCloudLists(body);
        const arr = Array.isArray(info) ? info : [];
        total = Number((body.data && (body.data.total || body.data.count || body.data.list_count)) || body.total || arr.length) || arr.length;
        arr.forEach((item) => {
          const song = mapKGSong(item, false);
          if (song.hash) tracks.push(song);
        });
        if (!arr.length) break;
        page += 1;
      }
      if (tracks.length) return tracks;
    }
  }
  return [];
}

export async function handleKGPlaylistTracks(id, cookieHeader, globalCollectionId) {
  id = String(id || '').trim();
  globalCollectionId = String(globalCollectionId || '').trim();
  if (!id && !globalCollectionId) return { provider: 'kg', error: 'Missing playlist id', tracks: [] };
  cookieHeader = cookieHeader || await getKGCookie();
  await syncKGVipCacheWithCookie(cookieHeader);
  const auth = await ensureKGAndroidAuth(cookieHeader, { requireAppToken: true });
  cookieHeader = await enrichKGCookieHeader(auth.cookieHeader || cookieHeader, { preferAppToken: true });
  const loginUserId = kgCookieUserId(cookieHeader);
  const loggedIn = !!(loginUserId && kgCookieToken(cookieHeader));
  let tracks = [];
  let source = 'cloudlist';
  let resolvedId = id || globalCollectionId;

  // Resolve 「我喜欢」/「默认收藏」 aliases to the best heart listid
  if (id === 'fav' || id === 'favorite' || isKGFavoriteName(id)) {
    try {
      const favId = String(await fetchKGFavoriteListId(cookieHeader, true) || '').trim();
      if (favId) resolvedId = favId;
    } catch (_) {}
  }

  const tryLoad = async (listOrGlobal) => {
    const key = String(listOrGlobal || '').trim();
    if (!key) return { tracks: [], id: key, source: '' };
    if (/^collection_/i.test(key) || (!/^\d+$/.test(key) && key.includes('_'))) {
      const m = key.match(/^collection_\d+_\d+_(\d+)_\d+$/i);
      if (m && m[1]) {
        const cloud = await fetchKGCloudlistTracks(m[1], cookieHeader);
        if (cloud.length) return { tracks: cloud, id: m[1], source: 'cloudlist' };
      }
      const pub = await fetchKGGlobalCollectionTracks(key, cookieHeader);
      if (pub.length) return { tracks: pub, id: key, source: 'pubsongs' };
      return { tracks: [], id: key, source: '' };
    }
    const cloud = await fetchKGCloudlistTracks(key, cookieHeader);
    if (cloud.length) return { tracks: cloud, id: key, source: 'cloudlist' };
    if (loginUserId) {
      const globalId = `collection_3_${loginUserId}_${key}_0`;
      const pub = await fetchKGGlobalCollectionTracks(globalId, cookieHeader);
      if (pub.length) return { tracks: pub, id: key, source: 'pubsongs' };
    }
    return { tracks: [], id: key, source: '' };
  };

  try {
    // Prefer explicit global_collection_id from playlist meta
    if (globalCollectionId) {
      const got = await tryLoad(globalCollectionId);
      if (got.tracks.length) {
        tracks = got.tracks;
        resolvedId = got.id || resolvedId;
        source = got.source;
      }
    }
    if (!tracks.length && resolvedId) {
      const got = await tryLoad(resolvedId);
      tracks = got.tracks;
      if (got.id) resolvedId = got.id;
      if (got.source) source = got.source;
    }
  } catch (_) {}

  if (!tracks.length) {
    try {
      const favId = String(await fetchKGFavoriteListId(cookieHeader, true) || '').trim();
      if (favId && favId !== resolvedId) {
        const got = await tryLoad(favId);
        if (got.tracks.length) {
          tracks = got.tracks;
          resolvedId = got.id || favId;
          source = got.source || 'cloudlist-fav';
        }
      }
    } catch (_) {}
  }

  const cover = (() => {
    for (const song of tracks) {
      const c = normalizeKGCover(song && song.cover, 240);
      if (c) return c;
    }
    return '';
  })();
  const playlist = {
    id: resolvedId,
    provider: 'kg',
    trackCount: tracks.length,
    source,
    cover,
    globalCollectionId: globalCollectionId || (loginUserId && /^\d+$/.test(String(resolvedId))
      ? `collection_3_${loginUserId}_${resolvedId}_0`
      : ''),
  };
  return { provider: 'kg', loggedIn, playlist, tracks };
}

async function fetchKGSpecialTracks(specialId, cookieHeader) {
  const pageSize = 200;
  let page = 1;
  let total = Infinity;
  const tracks = [];
  while (tracks.length < total && page <= 20) {
    const u = new URL('http://mobilecdn.kugou.com/api/v3/special/song');
    u.searchParams.set('specialid', specialId);
    u.searchParams.set('page', String(page));
    u.searchParams.set('pagesize', String(pageSize));
    u.searchParams.set('version', '9108');
    u.searchParams.set('area_code', '1');
    const body = await kgFetchJSON(u.toString(), {
      mobile: true,
      referer: 'https://www.kugou.com/',
      headers: buildKGRequestHeaders(cookieHeader),
    });
    const info = (body && body.data && body.data.info) || (body && body.info) || [];
    total = Number((body && body.data && body.data.total) || body.total || info.length) || info.length;
    info.forEach((item) => {
      const song = mapKGSong(item, false);
      if (song.hash) tracks.push(song);
    });
    if (!info.length) break;
    page += 1;
  }
  return tracks;
}

async function fetchKGGlobalCollectionTracks(globalId, cookieHeader) {
  globalId = String(globalId || '').trim();
  if (!globalId) return [];
  const pageSize = 100;
  let page = 1;
  let total = Infinity;
  const tracks = [];
  while (tracks.length < total && page <= 30) {
    const begin = (page - 1) * pageSize;
    const body = await kgFetchAndroidSigned(
      'https://gateway.kugou.com',
      '/pubsongs/v2/get_other_list_file_nofilt',
      cookieHeader,
      {
        area_code: 1,
        begin_idx: begin,
        plat: 1,
        type: 1,
        mode: 1,
        personal_switch: 1,
        pagesize: pageSize,
        global_collection_id: globalId,
      },
      {},
    );
    const info = extractKGCloudLists(body);
    const arr = Array.isArray(info) ? info : [];
    total = Number((body && body.data && (body.data.total || body.data.count)) || body.total || arr.length) || arr.length;
    arr.forEach((item) => {
      const song = mapKGSong(item, false);
      if (song.hash) tracks.push(song);
    });
    if (!arr.length) break;
    page += 1;
  }
  return tracks;
}

export async function handleKGPlaylistCreate(name, cookieHeader) {
  name = String(name || '').trim();
  if (!name) return { provider: 'kg', error: 'MISSING_NAME', success: false };
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = await ensureKGAndroidAuth(cookieHeader);
  cookieHeader = auth.cookieHeader || cookieHeader;
  const login = await getKGPlayContext(cookieHeader);
  if (!login.loggedIn) return { provider: 'kg', error: 'LOGIN_REQUIRED', success: false, loggedIn: false };
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const clienttime = Math.floor(Date.now() / 1000);
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY,
    '/v5/add_list',
    cookieHeader,
    {
      userid: userId,
      token,
      total_ver: 0,
      name,
      type: 0,
      source: 1,
      is_pri: 0,
      list_create_userid: userId,
      list_create_listid: 0,
      list_create_gid: '',
      from_shupinmv: 0,
    },
    { last_time: clienttime, last_area: 'gztx', userid: userId, token },
    KG_CLOUDLIST_ROUTER,
  );
  if (!kgCloudlistOk(body)) {
    return { provider: 'kg', error: 'KG_PLAYLIST_CREATE_FAILED', success: false, loggedIn: true, body };
  }
  const data = (body && body.data) || {};
  const listId = String(data.listid || data.list_id || data.id || '').trim();
  return {
    provider: 'kg',
    success: true,
    loggedIn: true,
    playlist: {
      id: listId,
      listId,
      name,
      provider: 'kg',
      source: 'kg',
      trackCount: 0,
    },
  };
}

export async function handleKGPlaylistAddSong(listId, hash, albumId, albumAudioId, name, cookieHeader) {
  listId = String(listId || '').trim();
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = await ensureKGAndroidAuth(cookieHeader);
  cookieHeader = auth.cookieHeader || cookieHeader;
  const login = await getKGPlayContext(cookieHeader);
  if (!login.loggedIn) return { provider: 'kg', error: 'LOGIN_REQUIRED', success: false, loggedIn: false };
  const meta = await resolveKGSongMetaForFavorite(hash, albumId, albumAudioId, name, cookieHeader);
  if (!meta || !meta.hash) return { provider: 'kg', error: 'MISSING_HASH', success: false, loggedIn: true };
  if (!listId) return { provider: 'kg', error: 'MISSING_LIST_ID', success: false, loggedIn: true };
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const clienttime = Math.floor(Date.now() / 1000);
  const resource = [{
    number: 1,
    name: meta.name,
    hash: meta.hash,
    size: 0,
    sort: 0,
    timelen: 0,
    bitrate: 0,
    album_id: Number(meta.albumId) || 0,
    mixsongid: Number(meta.albumAudioId) || 0,
  }];
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY,
    '/v6/add_song',
    cookieHeader,
    {
      userid: userId,
      token,
      listid: Number(listId) || listId,
      list_ver: 0,
      type: 0,
      slow_upload: 1,
      scene: 'false;null',
      data: resource,
    },
    { last_time: clienttime, last_area: 'gztx', userid: userId, token },
    KG_CLOUDLIST_ROUTER,
  );
  if (!kgCloudlistOk(body)) {
    return { provider: 'kg', error: 'KG_PLAYLIST_ADD_FAILED', success: false, loggedIn: true, body };
  }
  return {
    provider: 'kg',
    success: true,
    loggedIn: true,
    listId,
    hash: meta.hash,
  };
}

// ---------------------------------------------------------------------------
// 歌单写入与用户云盘（cloudlist.service / mcloudservice）
//
// 这一族的请求体与其余接口不同：body 是 AES-128-CBC 加密体，密钥由 6 位随机小写串派生
//   encryptKey = md5(key)[0:16]，iv = md5(key)[16:32]
// 再用 RSA 把 {aes, uid, token} 包成 p 参数。这里的 RSA 是 RSAES-PKCS1-v1_5（参考实现的
// rsaEncrypt2），而本文件的 kgRsaEncryptRaw 是「零填充裸 RSA」，两者不能互换。
// 端点与参数来自 docs/ku-go-api-docs.md 的 /playlist/add|del、/playlist/tracks/add|del、
// /user/cloud，以及 KuGouMusicApi 对应的 module。
// ---------------------------------------------------------------------------

/** 云盘系列的 AES 加密：返回 { key, str }，key 随 p 参数发给服务端用于解密。 */
function kgCloudAesEncrypt(data) {
  const key = kgRandomString(6).toLowerCase();
  const digest = md5(key);
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data == null ? '' : data);
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(digest.substring(0, 16)),
    { iv: CryptoJS.enc.Utf8.parse(digest.substring(16, 32)), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  );
  return { key, str: CryptoJS.enc.Base64.stringify(encrypted.ciphertext) };
}

function kgCloudAesDecrypt(str, key) {
  const digest = md5(String(key || ''));
  const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(String(str || '')) });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, CryptoJS.enc.Utf8.parse(digest.substring(0, 16)), {
    iv: CryptoJS.enc.Utf8.parse(digest.substring(16, 32)),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const text = decrypted.toString(CryptoJS.enc.Utf8);
  try { return JSON.parse(text); } catch (_) { return text; }
}

/** RSAES-PKCS1-v1_5（RFC 8017 §7.2.1），输出大写 hex，与参考实现 rsaEncrypt2 一致。 */
function kgRsaPkcs1Encrypt(data) {
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data == null ? '' : data);
  const message = new TextEncoder().encode(text);
  const k = KG_RSA_KEY_BYTES;
  if (message.length > k - 11) throw new Error('KG_RSA_OVERFLOW');
  const paddingLength = k - message.length - 3;
  const padding = new Uint8Array(paddingLength);
  let filled = 0;
  while (filled < paddingLength) {
    const batch = new Uint8Array(paddingLength - filled);
    (globalThis.crypto || window.crypto).getRandomValues(batch);
    for (const byte of batch) if (byte !== 0) padding[filled++] = byte;
  }
  const block = new Uint8Array(k);
  block[1] = 0x02;
  block.set(padding, 2);
  block[2 + paddingLength] = 0x00;
  block.set(message, 3 + paddingLength);
  let value = BigInt(0);
  for (const byte of block) value = (value << BigInt(8)) | BigInt(byte);
  const encrypted = kgModPow(value, KG_RSA_EXP, KG_RSA_MODULUS);
  return encrypted.toString(16).padStart(k * 2, '0').toUpperCase();
}

function kgBytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function kgParam(params, key, fallback) {
  const value = params && params[key];
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

/** 歌单写入前统一要的登录态（userid + token），拿不到就按未登录返回。 */
function kgRequirePlaylistAuth(cookieHeader) {
  const userId = String(kgCookieUserId(cookieHeader) || '').trim();
  const token = String(kgCookieToken(cookieHeader) || '').trim();
  if (!userId || !token) return null;
  return { userId, token };
}

/** `/playlist/add`：收藏歌单（type=1）或新建歌单（type=0）。 */
export async function handleKGPlaylistWrite(params, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = kgRequirePlaylistAuth(cookieHeader);
  if (!auth) return { status: 0, error_code: 401, data: {} };
  const type = Number(kgParam(params, 'type', 0)) === 0 ? 0 : 1;
  const clienttime = Math.floor(Date.now() / 1000);
  const data = {
    userid: auth.userId,
    token: auth.token,
    total_ver: 0,
    name: String(kgParam(params, 'name', '') || ''),
    type,
    source: Number(kgParam(params, 'source', 1)) === 0 ? 0 : (Number(kgParam(params, 'source', 1)) || 1),
    is_pri: 0,
    list_create_userid: String(kgParam(params, 'list_create_userid', '') || ''),
    list_create_listid: String(kgParam(params, 'list_create_listid', '') || ''),
    list_create_gid: String(kgParam(params, 'list_create_gid', '') || ''),
    from_shupinmv: 0,
  };
  // 隐私标记只在新建歌单时有效（上游同此约定）。
  if (type === 0) data.is_pri = Number(kgParam(params, 'is_pri', 0)) || 0;
  const extra = type === 0 ? { last_time: clienttime, last_area: 'gztx', userid: auth.userId, token: auth.token } : {};
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY, '/v5/add_list', cookieHeader, data, extra, KG_CLOUDLIST_ROUTER,
  );
  noteLibraryStep('kugou', 'playlist:add:done', {
    type, status: body && body.status, errorCode: body && body.error_code,
  });
  return body || { status: 0, error_code: -1, bridgeEmptyResponse: true, data: {} };
}

/** `/playlist/del`：取消收藏 / 删除歌单。走加密体，响应也是加密的二进制。 */
export async function handleKGPlaylistDel(params, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = kgRequirePlaylistAuth(cookieHeader);
  if (!auth) return { status: 0, error_code: 401, data: {} };
  const listId = Number(kgParam(params, 'listid', 0)) || 0;
  if (!listId) return { status: 0, error_code: -1, data: {} };
  const clienttime = Math.floor(Date.now() / 1000);
  const encoded = kgCloudAesEncrypt({ listid: listId, total_ver: 0, type: 1 });
  const p = kgRsaPkcs1Encrypt({ aes: encoded.key, uid: auth.userId, token: auth.token });
  const bytes = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY, '/v2/delete_list', cookieHeader, encoded.str,
    { clienttime, last_area: 'gztx', last_time: clienttime, p },
    KG_CLOUDLIST_ROUTER,
    { rawBody: true, responseBytes: true },
  );
  const body = kgCloudAesDecrypt(kgBytesToBase64(bytes || new Uint8Array(0)), encoded.key);
  noteLibraryStep('kugou', 'playlist:del:done', {
    status: body && body.status, errorCode: body && body.error_code,
  });
  return (body && typeof body === 'object') ? body : { status: 0, error_code: -1, data: {} };
}

/** `/playlist/tracks/add`：data 是「歌曲名|hash|专辑id|mixsongid」，逗号分隔多首。 */
export async function handleKGPlaylistTracksAdd(params, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = kgRequirePlaylistAuth(cookieHeader);
  if (!auth) return { status: 0, error_code: 401, data: {} };
  const listId = String(kgParam(params, 'listid', '') || '').trim();
  if (!listId) return { status: 0, error_code: -1, data: {} };
  const resource = String(kgParam(params, 'data', '') || '').split(',').filter(Boolean).map((entry) => {
    const parts = entry.split('|');
    return {
      number: 1,
      name: parts[0] || '',
      hash: parts[1] || '',
      size: 0,
      sort: 0,
      timelen: 0,
      bitrate: 0,
      album_id: Number(parts[2] || 0) || 0,
      mixsongid: Number(parts[3] || 0) || 0,
    };
  });
  if (!resource.length) return { status: 0, error_code: -1, data: {} };
  const clienttime = Math.floor(Date.now() / 1000);
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY, '/v6/add_song', cookieHeader,
    {
      userid: auth.userId,
      token: auth.token,
      listid: Number(listId) || listId,
      list_ver: 0,
      type: 0,
      slow_upload: 1,
      scene: 'false;null',
      data: resource,
    },
    { last_time: clienttime, last_area: 'gztx', userid: auth.userId, token: auth.token },
    KG_CLOUDLIST_ROUTER,
    { trace: 'playlist:tracks:add' },
  );
  noteLibraryStep('kugou', 'playlist:tracks:add:done', {
    count: resource.length, status: body && body.status, errorCode: body && body.error_code,
  });
  return body || { status: 0, error_code: -1, bridgeEmptyResponse: true, data: {} };
}

/** `/playlist/tracks/del`：fileids 逗号分隔。 */
export async function handleKGPlaylistTracksDel(params, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = kgRequirePlaylistAuth(cookieHeader);
  if (!auth) return { status: 0, error_code: 401, data: {} };
  const listId = String(kgParam(params, 'listid', '') || '').trim();
  const resource = String(kgParam(params, 'fileids', '') || '').split(',').filter(Boolean)
    .map((fileId) => ({ fileid: Number(fileId) || 0 }));
  if (!listId || !resource.length) return { status: 0, error_code: -1, data: {} };
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY, '/v4/delete_songs', cookieHeader,
    {
      listid: Number(listId) || listId,
      userid: auth.userId,
      data: resource,
      type: 0,
      token: auth.token,
      list_ver: 0,
    },
    { last_time: Math.floor(Date.now() / 1000), last_area: 'gztx', userid: auth.userId, token: auth.token },
    KG_CLOUDLIST_ROUTER,
    { trace: 'playlist:tracks:del' },
  );
  noteLibraryStep('kugou', 'playlist:tracks:del:done', {
    count: resource.length, status: body && body.status, errorCode: body && body.error_code,
  });
  return body || { status: 0, error_code: -1, bridgeEmptyResponse: true, data: {} };
}

/**
 * `/v4/get_list_all_file_v3`：App 当前使用的**云歌单歌曲**端点（按 listid + 分页）。
 *
 * 与 `/v4/get_list_all_file`（global_collection_id 的云文件列表）不同：这条按 listid 取，
 * 而且行里带 `fileid` —— 「取消收藏」必须靠 fileid 定位要删的那一行。
 * 现场：收藏能成功、取消时报「读回没看到这首歌」，就是因为读取端产出的行没有 fileid。
 */
export async function handleKGPlaylistTracksNew(params, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = kgRequirePlaylistAuth(cookieHeader);
  if (!auth) return { status: 0, error_code: 401, data: {} };
  const listId = String(kgParam(params, 'listid', '') || '').trim();
  if (!listId) return { status: 0, error_code: -1, data: {} };
  const page = Math.max(1, Number(kgParam(params, 'page', 1)) || 1);
  const pagesize = Math.max(1, Math.min(300, Number(kgParam(params, 'pagesize', 300)) || 300));
  const body = await kgPostAndroidSigned(
    KG_CLOUDLIST_GATEWAY, '/v4/get_list_all_file_v3', cookieHeader,
    {
      listid: Number(listId) || listId,
      userid: auth.userId,
      type: 0,
      page,
      pagesize,
      area_code: 1,
      allplatform: 1,
      show_cover: 1,
      token: auth.token,
    },
    { last_time: Math.floor(Date.now() / 1000), last_area: 'gztx', userid: auth.userId, token: auth.token },
    KG_CLOUDLIST_ROUTER,
    { trace: 'playlist:tracks:new' },
  );
  noteLibraryStep('kugou', 'playlist:tracks:new:done', {
    page, pagesize, status: body && body.status, errorCode: body && body.error_code,
  });
  return body || { status: 0, error_code: -1, bridgeEmptyResponse: true, data: {} };
}

/**
 * `/user/cloud`：用户云盘列表。
 *
 * 端点与参数按 KuGouMusicApi 的 user_cloud module：自定义 host mcloudservice，只带
 * clienttime/mid/key/clientver/appid/p（clearDefaultParams + notSignature），body 是
 * AES 密文的**原始字节**（不是 base64 串），响应同样是加密体。
 */
export async function handleKGUserCloud(params, cookieHeader) {
  cookieHeader = cookieHeader || await getKGCookie();
  const auth = kgRequirePlaylistAuth(cookieHeader);
  if (!auth) return { status: 0, error_code: 401, data: {} };
  const clienttime = Math.floor(Date.now() / 1000);
  const mid = await getKGMid(cookieHeader);
  const encoded = kgCloudAesEncrypt({
    page: Number(kgParam(params, 'page', 1)) || 1,
    pagesize: Number(kgParam(params, 'pagesize', 30)) || 30,
    getkmr: 1,
  });
  const p = kgRsaPkcs1Encrypt({ aes: encoded.key, uid: auth.userId, token: auth.token });
  const query = {
    clienttime,
    mid,
    key: kgSignParamsKey(String(clienttime)),
    clientver: KG_LITE_CLIENTVER,
    appid: KG_LITE_APPID,
    p,
  };
  const qs = Object.keys(query)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
    .join('&');
  const bytes = await kgFetchBytes(`https://mcloudservice.kugou.com/v1/get_list?${qs}`, {
    mobile: true,
    method: 'POST',
    headers: { Cookie: buildKGLeanCookie(cookieHeader), 'User-Agent': KG_ANDROID_UA, 'Content-Type': 'application/json' },
    body: base64ToBytes(encoded.str),
  });
  const body = kgCloudAesDecrypt(kgBytesToBase64(bytes), encoded.key);
  noteLibraryStep('kugou', 'user:cloud:done', {
    status: body && body.status, errorCode: body && body.error_code,
  });
  return (body && typeof body === 'object') ? body : { status: 0, error_code: -1, data: {} };
}

export function normalizeKGCookieInput(raw) {
  return String(raw || '').trim();
}

export function validateKGCookie(raw) {
  const obj = parseKGCookieObject(normalizeKGCookieInput(raw));
  const userId = obj.userid || obj.KugooID || obj.kugouid || '';
  const token = obj.token || obj.KToken || obj.kg_token || obj.t || '';
  return !!(String(userId).trim() && String(token).trim());
}

function normalizeKGArtistName(name) {
  return String(name || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
}

async function kgFetchMobileJSON(pathWithQuery) {
  const bases = [
    'https://mobilecdn.kugou.com',
    'http://mobilecdn.kugou.com',
    'https://m3ws.kugou.com',
  ];
  for (const base of bases) {
    try {
      const body = await kgFetchJSON(`${base}${pathWithQuery}`, {
        mobile: true,
        referer: 'https://www.kugou.com/',
        headers: { 'User-Agent': KG_UA_MOBILE },
      });
      if (body) return body;
    } catch (_) {}
  }
  return null;
}

async function searchKGSingerId(name) {
  name = String(name || '').trim().split(/\s*[/、,，]\s*/)[0].trim();
  if (!name) return { singerId: '', singerName: '' };
  const target = normalizeKGArtistName(name);
  const pickFromList = (list) => {
    const arr = Array.isArray(list) ? list : [];
    return arr.find((item) => normalizeKGArtistName(item.singername || item.author_name || item.name) === target)
      || arr.find((item) => {
        const candidate = normalizeKGArtistName(item.singername || item.author_name || item.name);
        return candidate && (candidate.includes(target) || target.includes(candidate));
      })
      || arr[0];
  };

  // 1) classic mobilecdn singer search
  try {
    const qs = new URLSearchParams({
      keyword: name,
      page: '1',
      pagesize: '8',
      version: '9108',
      plat: '0',
      with_res_tag: '1',
    });
    const body = await kgFetchMobileJSON(`/api/v3/search/singer?${qs}`);
    const matched = pickFromList((body && body.data && body.data.info) || (body && body.info) || []);
    if (matched) {
      return {
        singerId: String(matched.singerid || matched.singer_id || matched.author_id || matched.id || '').trim(),
        singerName: matched.singername || matched.author_name || matched.name || name,
      };
    }
  } catch (_) {}

  // 2) complexsearch singer
  try {
    const u = new URL('https://complexsearch.kugou.com/v2/search/singer');
    u.searchParams.set('keyword', name);
    u.searchParams.set('page', '1');
    u.searchParams.set('pagesize', '8');
    u.searchParams.set('platform', 'WebFilter');
    u.searchParams.set('format', 'json');
    const body = await kgFetchJSON(u.toString(), {
      mobile: false,
      referer: 'https://www.kugou.com/',
      headers: { 'User-Agent': KG_UA_PC },
    });
    const matched = pickFromList(
      (body && body.data && (body.data.lists || body.data.info || body.data.list))
      || (body && body.lists)
      || [],
    );
    if (matched) {
      return {
        singerId: String(matched.singerid || matched.singer_id || matched.AuthorId || matched.author_id || matched.id || '').trim(),
        singerName: matched.singername || matched.author_name || matched.AuthorName || matched.name || name,
      };
    }
  } catch (_) {}

  // 3) Fall back: take SingerId from a song search hit
  try {
    const songs = await handleKGSearch(name, 8, '', 1);
    const hit = (songs || []).find((s) => s && s.singerId && normalizeKGArtistName(s.artist).includes(target))
      || (songs || []).find((s) => s && s.singerId);
    if (hit && hit.singerId) {
      return { singerId: String(hit.singerId), singerName: hit.artist || name };
    }
  } catch (_) {}

  return { singerId: '', singerName: name };
}

export async function handleKGArtistDetail(id, name, limit) {
  limit = Math.max(10, Math.min(80, Number(limit) || 36));
  let singerId = String(id || '').trim();
  let singerName = String(name || '').trim().split(/\s*[/、,，]\s*/)[0].trim();
  if (!singerId && singerName) {
    const found = await searchKGSingerId(singerName);
    singerId = found.singerId;
    singerName = found.singerName || singerName;
  }
  if (!singerId && !singerName) {
    return { provider: 'kg', error: 'MISSING_SINGER_ID', message: '缺少酷狗歌手 ID', artist: null, songs: [] };
  }

  let info = {};
  let rawSongs = [];
  if (singerId) {
    try {
      const infoBody = await kgFetchMobileJSON(
        `/api/v3/singer/info?singerid=${encodeURIComponent(singerId)}&with_res_tag=1`,
      );
      info = (infoBody && infoBody.data) || infoBody || {};
    } catch (_) {}
    try {
      const qs = new URLSearchParams({
        singerid: singerId,
        page: '1',
        pagesize: String(limit),
        sorttype: '2',
        plat: '0',
        version: '9108',
        area_code: '1',
        with_res_tag: '1',
      });
      const songsBody = await kgFetchMobileJSON(`/api/v3/singer/song?${qs}`);
      rawSongs = (songsBody && songsBody.data && songsBody.data.info)
        || (songsBody && songsBody.info)
        || [];
    } catch (_) {}
  }

  // Last resort: keyword songs when singer endpoints fail
  if (!rawSongs.length && singerName) {
    try {
      const searched = await handleKGSearch(singerName, limit, '', 1);
      rawSongs = (searched || []).map((s) => ({
        FileHash: s.hash,
        hash: s.hash,
        SongName: s.name,
        SingerName: s.artist,
        SingerId: s.singerId || singerId,
        AlbumID: s.albumId,
        MixSongID: s.albumAudioId,
        AlbumName: s.album,
        imgUrl: s.cover,
        Duration: s.duration,
      }));
      if (!singerId) {
        const first = (searched || []).find((s) => s.singerId);
        if (first) singerId = String(first.singerId);
      }
    } catch (_) {}
  }

  if (!singerId && !rawSongs.length) {
    return { provider: 'kg', error: 'MISSING_SINGER_ID', message: '缺少酷狗歌手 ID', artist: null, songs: [] };
  }

  return {
    provider: 'kg',
    artist: {
      provider: 'kg',
      id: singerId || '',
      name: info.singername || info.author_name || singerName || '',
      avatar: normalizeKGCover(info.imgurl || info.singerHead || info.pic || info.avatar || '', 240),
      briefDesc: info.intro || info.description || '',
    },
    songs: rawSongs.map((item) => mapKGSong(item, false)).filter((song) => song.hash && song.name),
  };
}

function parseKGCommentTime(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const parsed = Date.parse(text.replace(/-/g, '/'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function handleKGSongComments(hash, albumAudioId, limit, page) {
  hash = String(hash || '').trim().toLowerCase();
  albumAudioId = String(albumAudioId || '').trim();
  limit = Math.max(1, Math.min(40, Number(limit) || 20));
  page = Math.max(1, Number(page) || 1);
  if (!hash) {
    return { provider: 'kg', error: 'Missing song hash', comments: [] };
  }
  const u = new URL('http://m.comment.service.kugou.com/index.php');
  u.searchParams.set('r', 'commentsv2/getCommentWithLike');
  u.searchParams.set('extdata', hash);
  u.searchParams.set('p', String(page));
  u.searchParams.set('pagesize', String(limit));
  u.searchParams.set('code', 'fc4be23b4e972707f36b8a828a93ba8a');
  u.searchParams.set('clientver', '8983');
  if (albumAudioId) u.searchParams.set('mixsongid', albumAudioId);
  try {
    const body = await kgFetchJSON(u.toString(), { referer: 'https://www.kugou.com/' });
    const raw = (body && (body.list || body.comments)) || [];
    const comments = (Array.isArray(raw) ? raw : [])
      .map((item) => ({
        id: item.id || item.cmtid || item.comment_id || '',
        content: stripKGHighlightHtml(item.content || item.msg || ''),
        likedCount: Number((item.like && (item.like.likenum || item.like.count)) || item.like_count || 0) || 0,
        time: parseKGCommentTime(item.addtime || item.add_time || item.time),
        user: {
          id: item.user_id || (item.udetail && item.udetail.user_id) || '',
          nickname: stripKGHighlightHtml(item.user_name || item.nickname || item.username || '酷狗用户'),
          avatar: item.user_pic || item.user_avatar || (item.udetail && item.udetail.user_pic) || '',
        },
      }))
      .filter((item) => item.content);
    return {
      provider: 'kg',
      hash,
      albumAudioId,
      total: Number((body && (body.combine_count || body.count)) || 0) || comments.length,
      comments,
    };
  } catch (err) {
    return { provider: 'kg', error: err.message || 'KG_COMMENTS_FAILED', comments: [] };
  }
}

async function kgFetchWebSignedGet(baseURL, urlPath, extraParams, fetchOptions) {
  const mid = await getKGMid('');
  const clienttime = Math.floor(Date.now() / 1000);
  const params = Object.assign({
    dfid: '-',
    mid,
    uuid: mid,
    clientver: KG_ANDROID_CLIENTVER,
    clienttime,
  }, extraParams || {});
  params.signature = signatureKGWebParams(params);
  const qs = Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const url = `${String(baseURL || '').replace(/\/$/, '')}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}?${qs}`;
  return kgFetchJSON(url, Object.assign({
    referer: 'https://www.kugou.com/',
    headers: {
      'User-Agent': KG_UA_PC,
      Accept: 'application/json, text/plain, */*',
    },
  }, fetchOptions || {}));
}

/**
 * 二维码图本地画（见 qrImage.js）：以前这里去 `api.qrserver.com` 取 PNG，那台机器不通时
 * 整个酷狗扫码就没有图可看。保持 async 是为了不改调用方。
 */
async function kgBuildQrDataUrl(text) {
  text = String(text || '').trim();
  if (!text) return '';
  try {
    return buildQrDataUrl(text);
  } catch (_) {
    return '';
  }
}

/** KuGouMusicApi `/login/qr/key` → login-user.kugou.com/v2/qrcode */
export async function handleKGLoginQrKey() {
  const body = await kgFetchWebSignedGet('https://login-user.kugou.com', '/v2/qrcode', {
    appid: KG_QR_KEY_APPID,
    type: 1,
    plat: 4,
    qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${KG_ANDROID_APPID}&`,
    srcappid: KG_SRCAPPID,
  });
  const key = String(
    (body && body.data && (body.data.qrcode || body.data.qrcode_key || body.data.key))
    || (body && (body.qrcode || body.key))
    || '',
  ).trim();
  return {
    provider: 'kg',
    code: key ? 200 : 500,
    unikey: key,
    key,
    status: body && body.status,
    error_code: body && body.error_code,
    message: key ? '' : '酷狗二维码 key 获取失败',
    raw: body,
  };
}

/** KuGouMusicApi `/login/qr/create` */
export async function handleKGLoginQrCreate(key) {
  key = String(key || '').trim();
  if (!key) return { provider: 'kg', code: 400, error: 'MISSING_KEY', message: '缺少二维码 key' };
  const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`;
  const qrimg = await kgBuildQrDataUrl(url);
  return {
    provider: 'kg',
    code: 200,
    data: { url, qrimg },
    url,
    qrimg,
  };
}

/**
 * KuGouMusicApi `/login/qr/check`
 * status: 0 过期, 1 等待扫码, 2 待确认, 4 成功(返回 token)
 */
// 这个端点本身就是长轮询（服务端挂到状态变化才回），桥默认的 15 秒会把「还没扫码」误判成网络失败。
const KG_QR_CHECK_TIMEOUT_MS = 45000;
const KG_QR_CHECK_MAX_CONSECUTIVE_TIMEOUTS = 3;
const kgQrCheckTimeouts = new Map();

/**
 * 长轮询超时说明服务端还没等到状态变化：连续几次以内按「等待扫码」返回，让前端接着轮询；
 * 连续超时到上限才当成真失败（否则一次网络抖动就把整个扫码会话判死，用户只能重新扫码）。
 */
export const resolveKgQrTimeoutAsWaiting = (
  consecutiveTimeouts,
  maxTimeouts = KG_QR_CHECK_MAX_CONSECUTIVE_TIMEOUTS,
) => Number(consecutiveTimeouts) < maxTimeouts;

export async function handleKGLoginQrCheck(key) {
  key = String(key || '').trim();
  if (!key) return { provider: 'kg', status: 0, code: 0, message: '缺少二维码 key' };
  let body;
  try {
    body = await kgFetchWebSignedGet('https://login-user.kugou.com', '/v2/get_userinfo_qrcode', {
      plat: 4,
      appid: KG_ANDROID_APPID,
      srcappid: KG_SRCAPPID,
      qrcode: key,
    }, { timeoutMs: KG_QR_CHECK_TIMEOUT_MS });
    kgQrCheckTimeouts.delete(key);
  } catch (error) {
    const attempts = (kgQrCheckTimeouts.get(key) || 0) + 1;
    kgQrCheckTimeouts.set(key, attempts);
    if (!resolveKgQrTimeoutAsWaiting(attempts)) {
      kgQrCheckTimeouts.delete(key);
      throw error;
    }
    noteLibraryStep('kugou', 'qr:check:timeout', { attempts, retryAsWaiting: true });
    return {
      provider: 'kg',
      status: 1,
      code: 1,
      message: '请用酷狗 App 扫码',
      loggedIn: false,
      timedOut: true,
    };
  }
  const data = (body && body.data) || {};
  const status = Number(data.status != null ? data.status : body && body.status) || 0;
  const message = status === 0 ? '二维码已过期，请刷新'
    : (status === 1 ? '请用酷狗 App 扫码'
      : (status === 2 ? '已扫码，请在手机确认'
        : (status === 4 ? '登录成功' : '等待扫码')));
  if (status !== 4) {
    return {
      provider: 'kg',
      status,
      code: status,
      message,
      loggedIn: false,
      error_code: body && body.error_code,
    };
  }
  const userId = String(data.userid || data.user_id || data.KugooID || '').trim();
  const token = String(data.token || data.t || '').trim();
  if (!userId || !token) {
    return {
      provider: 'kg',
      status: 4,
      code: 4,
      loggedIn: false,
      error: 'QR_NO_TOKEN',
      message: '扫码成功但未返回 token，请刷新二维码重试',
      raw: data,
    };
  }
  const nickname = stripKGHighlightHtml(data.nickname || data.nick_name || data.username || '');
  const avatar = normalizeKGCover(data.pic || data.user_pic || data.avatar || data.headimg || '', 180);
  const vipToken = String(data.vip_token || data.vipToken || '').trim();
  const vipType = Number(data.vip_type || data.vipType || 0) || (vipToken ? 6 : 0);
  const cookiePatch = {
    userid: userId,
    KugooID: userId,
    token,
    t: token,
  };
  if (nickname) cookiePatch.NickName = nickname;
  if (avatar) cookiePatch.pic = avatar;
  if (vipToken) cookiePatch.vip_token = vipToken;
  if (vipType) cookiePatch.vip_type = String(vipType);
  try {
    await persistKGLoginCookies(cookiePatch);
  } catch (_) {}
  // QR token is android-compatible (appid 1005) — store as appToken for cloudlist/VIP.
  await saveKGVipSessionCache(userId, {
    appToken: token,
    sourceToken: token,
    vipToken,
    vipType,
    isVip: !!(vipType > 0 || vipToken),
    vipLabel: vipType === 33 || vipType === 4 ? '超级VIP' : (vipType || vipToken ? 'VIP' : ''),
    authAt: Date.now(),
  });
  const cookieHeader = await ensureKGCookie();
  const info = await getKGLoginStatus(cookieHeader);
  return {
    provider: 'kg',
    status: 4,
    code: 4,
    loggedIn: true,
    message: '登录成功',
    userId,
    token,
    hasAppToken: true,
    hasVipToken: !!resolveKGEffectiveVipToken(cookieHeader, await loadKGVipSessionCache(userId)),
    ...info,
    nickname: info.nickname || nickname || `酷狗 ${userId}`,
    avatar: info.avatar || avatar,
  };
}

export async function handleKGLoginCookie(raw) {
  const normalized = normalizeKGCookieInput(raw);
  if (!validateKGCookie(normalized)) {
    return {
      provider: 'kg',
      loggedIn: false,
      error: 'INVALID_KG_COOKIE',
      message: '酷狗 cookie 缺少 userid 或 token',
    };
  }
  await persistKGLoginCookies(normalized);
  const cookieHeader = await ensureKGCookie();
  const info = await getKGLoginStatus(cookieHeader);
  return { ...info, saved: info.loggedIn, hasCookie: info.loggedIn };
}

export {
  searchKGLyricCandidates,
  downloadKGLyricByCandidate,
  kgFetchJSON,
  kgPostAndroidSigned,
  getKGMid,
  signatureKGWebParams,
};

/**
 * 推荐类接口用的 `signParamsKey`：md5(appid + 盐 + clientver + data)。
 *
 * 上游 KuGouMusicApi 的标准版/概念版走不同盐值，本地桥固定用概念版（lite）那一套，
 * 和 kgPostAndroidSigned 里签 signature 用的是同一个盐，别两边改了一个忘了另一个。
 */
function kgSignParamsKey(data) {
  return md5(`${KG_LITE_APPID}${KG_ANDROID_SIGN_SALT}${KG_LITE_CLIENTVER}${data}`);
}

/**
 * 每日推荐（/everyday/recommend → everydayrec 服务）。
 *
 * 上游是 POST 且不带 data，参数全走 query；本地桥的 kgPostAndroidSigned 会把 dfid/mid/
 * appid/clientver/clienttime/token/userid 这些默认参数一起签进去，所以这里只补 platform。
 * body 不传（与上游一致）：空 body 由原生补成 0 长度，见 kgPostAndroidSigned 里的说明。
 */
export async function handleKGEverydayRecommend(cookieHeader, platform) {
  cookieHeader = cookieHeader || await getKGCookie();
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  if (!userId || !token) {
    // kgPostAndroidSigned 在这两个缺一个时直接返回 null，界面上就只看到「每日推荐是空的」，
    // 而不知道到底缺什么 —— 这里把缺的那一项记进本地库追踪，下一次看日志能直接定位。
    noteLibraryStep('kugou', 'everyday:recommend:no-session', {
      hasUserId: Boolean(userId),
      hasToken: Boolean(token),
    });
    return null;
  }
  noteLibraryStep('kugou', 'everyday:recommend:start');
  const body = await kgPostAndroidSigned(
    'https://gateway.kugou.com',
    '/everyday_song_recommend',
    cookieHeader,
    undefined,
    { platform: String(platform || 'ios') },
    { 'x-router': 'everydayrec.service.kugou.com' },
  );
  noteLibraryStep('kugou', 'everyday:recommend:done', {
    status: body && body.status,
    errorCode: body && body.error_code,
  });
  return body;
}

/**
 * 私人 FM（/personal/fm → persnfm 服务）。
 *
 * `remain_songcnt` 是「队列里还剩几首没播」的意思，酷狗服务端在它大于 4 时**直接不返回新歌**，
 * 所以默认必须给 0 —— 否则 FM 首页会一次次拿到空列表，表现就是「私人 FM 没有歌」。
 */
export async function handleKGPersonalFm(cookieHeader, options) {
  options = options || {};
  cookieHeader = cookieHeader || await getKGCookie();
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const vipType = kgCookieVipType(cookieHeader);
  const mid = await getKGMid(cookieHeader);
  const dateTime = Date.now();
  const data = {
    appid: KG_LITE_APPID,
    clienttime: dateTime,
    mid,
    action: String(options.action || 'play'),
    recommend_source_locked: 0,
    song_pool_id: Number(options.song_pool_id) || 0,
    callerid: 0,
    m_type: 1,
    platform: String(options.platform || 'ios'),
    area_code: 1,
    // 夹在 0~4：服务端见大于 4 就不发歌，调用方就算把整个播放队列长度传进来也不会把 FM 变成空的。
    remain_songcnt: Math.max(0, Math.min(4, Number(options.remain_songcnt) || 0)),
    clientver: KG_LITE_CLIENTVER,
    is_overplay: options.is_overplay ? 1 : 0,
    mode: String(options.mode || 'normal'),
    fakem: 'ca981cfc583a4c37f28d2d49000013c16a0a',
    key: kgSignParamsKey(dateTime),
  };
  if (userId) {
    data.userid = userId;
    data.kguid = userId;
  }
  if (token) data.token = token;
  if (vipType) data.vip_type = vipType;
  if (options.hash) data.hash = options.hash;
  if (options.songid) data.songid = options.songid;
  if (options.playtime) data.playtime = options.playtime;
  if (options.cur_mark) data.cur_mark = options.cur_mark;
  noteLibraryStep('kugou', 'personal:fm:start', { action: data.action, mode: data.mode });
  const body = await kgPostAndroidSigned(
    'https://gateway.kugou.com',
    '/v2/personal_recommend',
    cookieHeader,
    data,
    {},
    { 'x-router': 'persnfm.service.kugou.com' },
  );
  noteLibraryStep('kugou', 'personal:fm:done', {
    status: body && body.status,
    errorCode: body && body.error_code,
  });
  return body;
}

/** 历史推荐（/everyday/history）：mode=list 拿日期列表，mode=song 拿某天的歌。 */
export async function handleKGEverydayHistory(cookieHeader, options) {
  options = options || {};
  cookieHeader = cookieHeader || await getKGCookie();
  const extra = {
    mode: String(options.mode || 'list'),
    platform: String(options.platform || 'ios'),
  };
  if (options.history_name) extra.history_name = options.history_name;
  if (options.date) extra.date = options.date;
  noteLibraryStep('kugou', 'everyday:history:start', { mode: extra.mode });
  const body = await kgPostAndroidSigned(
    'https://gateway.kugou.com',
    '/everyday/api/v1/get_history',
    cookieHeader,
    undefined,
    extra,
    { 'x-router': 'everydayrec.service.kugou.com' },
  );
  noteLibraryStep('kugou', 'everyday:history:done', {
    status: body && body.status,
    errorCode: body && body.error_code,
  });
  return body;
}

/** 歌曲推荐（概念版卡片，/top/card/youth）。clientver 上游写死 11490，别改成 lite 的 11440。 */
export async function handleKGTopCardYouth(cookieHeader, options) {
  options = options || {};
  cookieHeader = cookieHeader || await getKGCookie();
  const pagesize = Number(options.pagesize);
  noteLibraryStep('kugou', 'top:card:youth:start', { cardId: options.card_id });
  const body = await kgPostAndroidSigned(
    'https://gateway.kugou.com',
    '/youth/v1/song/single_card_recommend',
    cookieHeader,
    {
      tagid: options.tagid != null ? options.tagid : '',
      u_info: '',
      source_mixsong: '',
    },
    {
      card_id: Number(options.card_id) || 3005,
      area_code: 1,
      platform: 'ios',
      module_id: 1,
      ver: 'v2',
      pagesize: Number.isFinite(pagesize) && pagesize > 0 ? pagesize : 30,
      clientver: 11490,
    },
    {},
  );
  noteLibraryStep('kugou', 'top:card:youth:done', {
    status: body && body.status,
    errorCode: body && body.error_code,
  });
  return body;
}
