import CryptoJS from '../vendor/crypto-es.mjs';
import {
  getQQCookie,
  parseCookieString,
  qqCookieAvatar,
  qqCookieHasWebAuth,
  qqCookieMusicKey,
  qqCookieNickname,
  qqCookiePlaybackKey,
  qqCookieUin,
  clearCookieCache,
  saveProviderCookie,
} from './cookies.js';
import { UA } from './weapi.js';
import { qqGetLoginQr, qqCheckLoginQr } from './qq-login-qr.js';
import { noteLibraryStep } from './libraryTrace.js';

const noteQQLibraryStep = (step, detail) => noteLibraryStep('qq', step, detail);

/**
 * Bridge wrappers around sansenjian/qq-music-api QR login:
 * GET  /user/getQQLoginQr  → handleQQLoginQrCreate
 * POST /user/checkQQLoginQr → handleQQLoginQrCheck
 * Docs: https://sansenjian.github.io/qq-music-api/api/user.html
 */
export async function handleQQLoginQrCreate() {
  return qqGetLoginQr();
}

export async function handleQQLoginQrCheck(qrsig, ptqrtoken) {
  const result = await qqCheckLoginQr({ qrsig, ptqrtoken });
  if (result?.session?.cookie) {
    await saveProviderCookie('qq', result.session.cookie);
  }
  if (result && result.isOk && result.loggedIn) {
    // Enrich with profile/vip if cookie landed
    try {
      clearCookieCache();
      const cookieHeader = await getQQCookie();
      const status = await getQQLoginStatus(cookieHeader);
      if (status && status.loggedIn) {
        return {
          ...result,
          ...status,
          isOk: true,
          code: 0,
          status: 'ok',
          message: '登录成功',
          loggedIn: true,
          session: result.session,
        };
      }
    } catch (_) {}
  }
  // 换票被判定失败前再确认一次登录态：手机上已经确认、cookie 罐里也有有效会话时，
  // 不该因为一次换票失败把用户挡在门外。
  if (result && result.retryable === false && result.status === 'error') {
    try {
      clearCookieCache();
      const cookieHeader = await getQQCookie();
      const status = await getQQLoginStatus(cookieHeader);
      if (status && status.loggedIn) {
        noteQQLibraryStep('qr:exchange:recovered', { hasUserId: Boolean(status.uin || status.userId) });
        return {
          ...result,
          ...status,
          isOk: true,
          code: 0,
          status: 'ok',
          message: '登录成功',
          loggedIn: true,
          hasCookie: true,
          retryable: true,
        };
      }
    } catch (_) {}
  }
  return result;
}

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';

function normalizeQualityPreference(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (['jymaster', 'master', 'studio', 'svip', 'highest'].includes(raw)) return 'jymaster';
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires';
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless';
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh';
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard';
  return 'hires';
}

const QQ_QUALITY_CANDIDATE_TEMPLATES = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC' },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
  { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' },
];

function qualityCandidatesFrom(target, candidates) {
  target = normalizeQualityPreference(target);
  let start = candidates.findIndex((item) => item.level === target);
  if (start < 0) start = 0;
  return candidates.slice(start);
}

function playbackRestriction(provider, category, message, action, extra) {
  return Object.assign({ provider, category, message, action: action || 'none' }, extra || {});
}

function classifyQQPlaybackRestriction(info, session) {
  const hasSession = typeof session === 'object' ? !!session.hasSession : !!session;
  const hasPlaybackKey = typeof session === 'object' ? !!session.hasPlaybackKey : hasSession;
  const hasWebAuth = typeof session === 'object' ? session.hasWebAuth !== false : hasSession;
  const rawMsg = String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').trim();
  const code = Number((info && (info.result || info.code || info.errtype)) || 0);
  const lower = rawMsg.toLowerCase();
  if (!hasSession) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', { code, rawMessage: rawMsg });
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开 y.qq.com 完成登录', 'login', { code, rawMessage: rawMsg, missingPlaybackKey: true });
  }
  if (code === 104003 && !hasWebAuth) {
    // 快速扫码/微信通道只有 musickey，没有网页登录的 p_skey/skey：VIP 歌会逐档回 104003。
    return playbackRestriction('qq', 'login_required',
      '当前 QQ 登录没有拿到网页播放授权（p_skey/skey），VIP 歌曲会被 QQ 拒绝。请退出 QQ 音乐登录后重新用 QQ 扫码，等网页登录完成再试。',
      'login', { code, rawMessage: rawMsg, missingWebAuth: true });
  }
  if (code === 104003) {
    // 现场实测：非会员账号点 VIP 歌时，逐档音质都回 104003 且 purl 为空；同一账号的免费歌能正常播。
    // 带上 hint，界面才会给出「完整播放可能需要会员」，而不是泛泛的「暂时无法播放这首歌」。
    return playbackRestriction('qq', 'copyright_unavailable', 'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制', 'switch_source', { code, rawMessage: rawMsg, hint: { key: 'playback.maybe-membership' } });
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('qq', 'vip_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', { code, rawMessage: rawMsg, hint: { key: 'playback.maybe-membership' } });
  }
  if (code && code !== 0) {
    return playbackRestriction('qq', 'copyright_unavailable', rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播', 'switch_source', { code, rawMessage: rawMsg });
  }
  return playbackRestriction('qq', 'url_unavailable', 'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制', 'switch_source', { code, rawMessage: rawMsg });
}

function parseJSONText(text) {
  const raw = String(text || '').trim();
  return JSON.parse(raw.replace(/^callback\(([\s\S]*)\);?$/, '$1'));
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function decodeQQLyricText(text) {
  let raw = decodeHtmlEntities(String(text || '').trim());
  if (!raw) return '';
  try {
    if (!raw.includes('[') && /^[A-Za-z0-9+/=]+$/.test(raw.replace(/\s+/g, ''))) {
      const bin = atob(raw.replace(/\s+/g, ''));
      const decoded = decodeURIComponent(escape(bin));
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) raw = decoded;
    }
  } catch (_) {}
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim();
}

function qqOfficialCoverSize(size) {
  const want = Math.max(1, Number(size) || 300);
  const allowed = [68, 90, 126, 150, 180, 300, 500, 800];
  let best = allowed[0];
  let bestDiff = Math.abs(want - best);
  for (let i = 1; i < allowed.length; i++) {
    const px = allowed[i];
    const diff = Math.abs(want - px);
    if (diff < bestDiff || (diff === bestDiff && px > best)) {
      best = px;
      bestDiff = diff;
    }
  }
  return best;
}

function qqAlbumCover(albumMid, size) {
  if (!albumMid) return '';
  const px = qqOfficialCoverSize(size || 300);
  return `https://y.gtimg.cn/music/photo_new/T002R${px}x${px}M000${albumMid}.jpg?max_age=2592000`;
}

function qqSingerAvatar(singerMid, size) {
  if (!singerMid) return '';
  const px = qqOfficialCoverSize(size || 300);
  return `https://y.gtimg.cn/music/photo_new/T001R${px}x${px}M000${singerMid}.jpg?max_age=2592000`;
}

function qqFeeFromPay(pay) {
  pay = pay || {};
  if (Number(pay.time_free) === 1) return 0;
  // pay_play=1 需付费播放；pay_month=1 需绿钻；pay_down 只影响下载，不代表不能免费播
  if (Number(pay.pay_play) === 1 || Number(pay.pay_month) === 1) return 1;
  return 0;
}

function qqFeeFromTrack(track) {
  track = track || {};
  if (track.pay && typeof track.pay === 'object') return qqFeeFromPay(track.pay);
  const fnote = Number(track.fnote || 0);
  if (fnote === 4009 || fnote === 8012 || fnote === 8013) return 1;
  return 0;
}

export function mergeQQSearchEnrich(item, detail) {
  if (!item || !detail) return item;
  // The liked-songs and playlist paths build bare `{ mid, id }` rows and rely
  // on this merge to receive everything else, so the display fields must be
  // copied too - otherwise every row renders as an empty/unknown song.
  if (!item.name && detail.name) item.name = detail.name;
  if (!item.artist && detail.artist) item.artist = detail.artist;
  if ((!item.artists || !item.artists.length) && Array.isArray(detail.artists) && detail.artists.length) {
    item.artists = detail.artists;
  }
  if (!item.album && detail.album) item.album = detail.album;
  if (!item.duration && detail.duration) item.duration = detail.duration;
  if (!item.interval && detail.interval) item.interval = detail.interval;
  if (!item.songmid && detail.songmid) item.songmid = detail.songmid;
  if (detail.mediaMid) item.mediaMid = detail.mediaMid;
  if (detail.cover && !item.cover) item.cover = detail.cover;
  if (detail.albumMid && !item.albumMid) item.albumMid = detail.albumMid;
  if (detail.artistMid && !item.artistMid) item.artistMid = detail.artistMid;
  if (detail.fee != null) item.fee = detail.fee;
  return item;
}

async function qqSongDetailsBatch(items, cookieHeader) {
  items = (items || []).filter((item) => item && item.mid);
  if (!items.length) return items;
  if (items.length === 1) {
    try {
      mergeQQSearchEnrich(items[0], await qqSongDetail(items[0].mid, items[0], cookieHeader));
    } catch (_) {}
    return items;
  }
  // The upstream detail endpoint starts rejecting the request once the mid list
  // gets long, so ask for them in chunks instead of falling back to one request
  // per song (which made a 150-song playlist take minutes).
  const CHUNK_SIZE = 50;
  const MAX_PARALLEL = 4;
  const chunks = [];
  for (let index = 0; index < items.length; index += CHUNK_SIZE) {
    chunks.push(items.slice(index, index + CHUNK_SIZE));
  }
  for (let index = 0; index < chunks.length; index += MAX_PARALLEL) {
    await Promise.all(
      chunks.slice(index, index + MAX_PARALLEL).map(async (chunk) => {
        try {
          const json = await qqMusicRequest({
            comm: { ct: 24, cv: 0 },
            songinfo: {
              module: 'music.pf_song_detail_svr',
              method: 'get_song_detail_yqq',
              param: { song_mid: chunk.map((item) => item.mid).join(',') },
            },
          }, cookieHeader);
          const data = json && json.songinfo && json.songinfo.data;
          let rawTracks = [];
          if (Array.isArray(data && data.track_info)) rawTracks = data.track_info;
          else if (data && data.track_info) rawTracks = [data.track_info];
          else if (Array.isArray(data)) rawTracks = data;
          const byMid = {};
          rawTracks.forEach((raw) => {
            const track = raw && (raw.track_info || raw.songInfo || raw.songinfo || raw);
            const mapped = mapQQTrack(track, {});
            if (mapped && mapped.mid) byMid[mapped.mid] = mapped;
          });
          chunk.forEach((item) => {
            if (byMid[item.mid]) mergeQQSearchEnrich(item, byMid[item.mid]);
          });
        } catch (_) {}
      }),
    );
  }
  // Only the rows that still lack a title (or a resolvable media id) need the
  // per-song fallback, and even then bounded so one bad chunk cannot stall the
  // whole page.
  const missing = items.filter((item) => !item.name || (!item.mediaMid && item.fee == null));
  noteQQLibraryStep('song-details:batch', {
    requested: items.length,
    named: items.filter((item) => Boolean(item.name)).length,
    chunks: chunks.length,
    fallback: Math.min(missing.length, 30),
  });
  await Promise.all(
    missing.slice(0, 30).map(async (item) => {
      try {
        mergeQQSearchEnrich(item, await qqSongDetail(item.mid, item, cookieHeader));
      } catch (_) {}
    }),
  );
  return items;
}

function mapQQArtists(raw) {
  return (raw || [])
    .map((a) => ({ id: a && a.id, mid: a && a.mid, name: (a && (a.name || a.title)) || '' }))
    .filter((a) => a.name);
}

function mapQQSearchSong(item) {
  item = item || {};
  const album = item.album || {};
  const artists = mapQQArtists(item.singer || []);
  const mid = item.mid || item.songmid || item.id || '';
  const albumMid = album.mid || album.pmid || item.albummid || item.albumMid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    mediaMid: (item.file && item.file.media_mid) || item.strMediaMid || item.media_mid || '',
    name: item.name || item.title || item.songname || '',
    artist: artists.map((a) => a.name).join(' / ') || item.singer || '',
    artists: artists.length ? artists : (item.singer ? [{ name: item.singer }] : []),
    album: album.name || album.title || item.albumname || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || item.albumimg || '',
    duration: (Number(item.interval) || 0) * 1000,
    fee: qqFeeFromTrack(item),
    playable: false,
  };
}

async function qqDesktopSearch(keywords, limit, page, cookieHeader) {
  const kw = String(keywords || '').trim();
  if (!kw) return [];
  const safeLimit = Math.max(4, Math.min(30, Number(limit) || 12));
  const pageNum = Math.max(1, Number(page) || 1);
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    req_1: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: {
        remoteplace: 'txt.yqq.song',
        query: kw,
        search_type: 0,
        num_per_page: safeLimit,
        page_num: pageNum,
      },
    },
  }, cookieHeader);
  const block = (json && json.req_1) || (json && json['music.search.SearchCgiService']) || {};
  const data = block.data || {};
  const body = data.body || {};
  const song = body.song || {};
  const list = song.list || song.itemlist || [];
  return (Array.isArray(list) ? list : []).map(mapQQSearchSong).filter((s) => s.name && s.mid);
}

function mapQQSmartSong(item) {
  item = item || {};
  const mid = item.mid || item.songmid || item.id || '';
  const albumMid = item.albummid || item.albumMid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    albumMid,
    name: item.name || item.songname || item.title || '',
    artist: item.singer || '',
    artists: item.singer ? [{ name: item.singer }] : [],
    album: item.albumname || '',
    cover: item.albumimg || qqAlbumCover(albumMid, 300) || '',
    duration: Number(item.duration || 0) * 1000,
    fee: qqFeeFromTrack(item),
    playable: false,
  };
}

function mapQQTrack(track, fallback) {
  track = track || {};
  fallback = fallback || {};
  const albumObj = track.album && typeof track.album === 'object' ? track.album : {};
  const artists = mapQQArtists(track.singer || track.singerInfo || []);
  let artistText = artists.map((a) => a.name).join(' / ');
  if (!artistText && typeof track.singer === 'string') artistText = track.singer;
  if (!artistText && track.singername) artistText = track.singername;
  const mid = track.mid || track.songmid || track.songMid || fallback.mid || fallback.songmid || '';
  const albumMid = albumObj.mid || albumObj.pmid || track.albummid || track.albumMid || fallback.albumMid || fallback.albummid || '';
  const albumName = albumObj.name || albumObj.title || (typeof track.album === 'string' ? track.album : '') || track.albumname || track.albumName || fallback.album || '';
  const qqId = track.id || track.songid || track.songId || track.songID || fallback.qqId || fallback.id || '';
  const interval = Number(track.interval || track.songInterval || track.duration || fallback.interval || 0) || 0;
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid || String(qqId || ''),
    qqId: String(qqId || ''),
    mid,
    songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || track.mediaMid || fallback.mediaMid || '',
    name: track.name || track.title || track.songname || track.songName || fallback.name || '',
    artist: artistText || fallback.artist || '',
    artists: artists.length ? artists : (artistText ? [{ name: artistText }] : fallback.artists || []),
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: albumName,
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || normalizeQQPlaylistCover(
      track.albumimg || track.albumImg || track.albumpic || track.albumPic || track.pic ||
      albumObj.pic || albumObj.picurl || albumObj.cover ||
      fallback.cover || fallback.albumimg || ''
    ),
    duration: interval > 1000 ? interval : interval * 1000 || fallback.duration || 0,
    fee: qqFeeFromTrack(track),
    playable: false,
  };
}

async function qqMusicRequest(payload, cookieHeader, ua, options = {}) {
  // g_tk（bkn）是 QQ 的 CSRF token。写入接口要它；读取接口不带也能过，
  // 所以以前一直没暴露出来。放 query 里，与公开的可用实现一致。
  const query = options.gTk === undefined ? 'format=json' : `format=json&g_tk=${options.gTk}`;
  const resp = await fetch(`${QQ_MUSICU_URL}?${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Referer: 'https://y.qq.com/',
      'User-Agent': ua || UA,
      Cookie: cookieHeader || '',
    },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

async function qqGetJSON(url, params, cookieHeader) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const resp = await fetch(u.toString(), {
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': UA,
      Cookie: cookieHeader || '',
    },
  });
  return parseJSONText(await resp.text());
}

async function qqSmartboxSearch(keywords, limit) {
  const u = new URL(QQ_SMARTBOX_URL);
  u.searchParams.set('format', 'json');
  u.searchParams.set('key', keywords);
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', '0');
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  const resp = await fetch(u.toString(), { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } });
  const json = parseJSONText(await resp.text());
  const items = json && json.data && json.data.song && json.data.song.itemlist;
  return (Array.isArray(items) ? items : [])
    .slice(0, Math.max(1, Math.min(limit || 8, 12)))
    .map(mapQQSmartSong);
}

async function qqSongDetail(mid, fallback, cookieHeader) {
  if (!mid) return fallback;
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: mid },
    },
  }, cookieHeader);
  const data = json && json.songinfo && json.songinfo.data;
  return mapQQTrack(data && data.track_info, fallback);
}

function mapQQComment(raw) {
  raw = raw || {};
  const user = raw.commentnick || raw.nick || raw.user || {};
  const nickname = raw.nick || raw.commentnick || user.nickname || user.name || 'QQ 用户';
  const avatar = raw.headurl || raw.avatarurl || user.avatar || user.headurl || '';
  return {
    id: raw.commentid || raw.commentId || raw.id || '',
    content: decodeHtmlEntities(raw.rootcommentcontent || raw.commentcontent || raw.content || ''),
    likedCount: Number(raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
    time: Number(raw.time || raw.pubtime || 0) || 0,
    user: {
      id: raw.uin || user.uin || '',
      nickname,
      avatar,
    },
  };
}

function firstPositiveNumberFrom(objects, keys) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys) {
      const value = Number(obj[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}

function normalizeQQVipFields(profileBody, vipQueryBody, cookieHeader) {
  const cookieObj = parseCookieString(cookieHeader);
  const data = (profileBody && (profileBody.data || profileBody.profile || profileBody.creator || profileBody.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const vipInfo = data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo || {};
  const vipQueryData = (vipQueryBody && (vipQueryBody.req_0 && vipQueryBody.req_0.data)) || vipQueryBody || {};
  const infoMap = vipQueryData.infoMap || vipQueryData.map_userinfo || vipQueryData.mapUserInfo || {};
  const uin = qqCookieUin(cookieHeader);
  const uinKeys = [String(uin), uin ? `0${uin}` : '', ...Object.keys(infoMap || {})];
  let queryInfo = null;
  for (const key of uinKeys) {
    if (key && infoMap && infoMap[key]) {
      queryInfo = infoMap[key];
      break;
    }
  }
  if (!queryInfo && infoMap && typeof infoMap === 'object') {
    const values = Object.values(infoMap);
    queryInfo = values.length ? values[0] : null;
  }
  const objects = [cookieObj, data, creator, vipInfo, queryInfo, vipQueryData].filter(Boolean);
  let vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'music_vip_level', 'green_vip_level', 'luxury_vip_level', 'iGreenDiamondLevel',
    'iVipLevel', 'iSuperVip', 'iHugeVip', 'uHugeVipMask', 'uVipMask',
  ]);
  const vipFlag = objects.some((obj) => {
    if (!obj) return false;
    const flag = obj.isVip ?? obj.is_vip ?? obj.vipFlag ?? obj.vipflag ?? obj.iVipFlag;
    return flag === true || Number(flag) > 0 || String(flag || '').toLowerCase() === 'true';
  });
  const hugeVip = objects.some((obj) => obj && (
    Number(obj.uHugeVipMask || obj.iHugeVip || obj.huge_vip || obj.iSuperVip || 0) > 0
  ));
  if (!vipType && (vipFlag || hugeVip)) vipType = hugeVip ? 7 : 1;
  const isVip = vipType > 0 || vipFlag || hugeVip;
  const vipLevel = isVip ? 'vip' : 'none';
  return {
    vipType: vipType || (isVip ? 1 : 0),
    vipLevel,
    isVip,
    isSvip: false,
    vipLabel: isVip ? 'QQ VIP' : '无VIP',
  };
}

function normalizeQQProfile(body, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const data = (body && (body.data || body.profile || body.creator || body.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const profileNick = creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || '';
  const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || '';
  const cookieNick = qqCookieNickname(cookieHeader, uin);
  const nick = profileNick || cookieNick || '';
  const avatar = profileAvatar || qqCookieAvatar(cookieHeader, uin);
  const vip = normalizeQQVipFields(body, null, cookieHeader);
  return {
    provider: 'qq',
    loggedIn: !!(uin && qqCookieMusicKey(cookieHeader)),
    preview: false,
    userId: uin,
    uin,
    nickname: nick || (uin ? `QQ ${uin}` : 'QQ 音乐'),
    avatar,
    ...vip,
    hasCookie: !!cookieHeader,
    playbackKeyReady: !!qqCookiePlaybackKey(cookieHeader),
    profileSource: profileNick || profileAvatar ? 'qq-profile' : (cookieNick || avatar ? 'cookie' : 'fallback'),
  };
}

async function fetchQQProfileHomepage(uin, cookieHeader) {
  const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg');
  u.searchParams.set('cid', '205360838');
  u.searchParams.set('userid', uin);
  u.searchParams.set('reqfrom', '1');
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', uin);
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('format', 'json');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  return qqGetJSON(u.origin + u.pathname, Object.fromEntries(u.searchParams.entries()), cookieHeader);
}

async function fetchQQVipQuery(uin, cookieHeader) {
  const musicKey = qqCookieMusicKey(cookieHeader);
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  return qqMusicRequest({
    comm,
    req_0: {
      module: 'userInfo.VipQueryServer',
      method: 'SRFVipQuery_V2',
      param: { uin_list: [String(uin)] },
    },
  }, cookieHeader);
}

export async function warmQQLoginCookies() {
  try {
    await fetch('https://y.qq.com/', {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
    });
  } catch (_) {}
  clearCookieCache();
  return getQQCookie();
}

export async function getQQLoginStatus(cookieHeader) {
  if (!cookieHeader) {
    try { cookieHeader = await warmQQLoginCookies(); } catch (_) { cookieHeader = ''; }
  }
  const uin = qqCookieUin(cookieHeader);
  const musicKey = qqCookieMusicKey(cookieHeader);
  const fallback = normalizeQQProfile(null, cookieHeader);
  if (!uin || !musicKey) {
    return {
      ...fallback,
      loggedIn: false,
      missing: {
        uin: !uin,
        musicKey: !musicKey,
      },
      message: !uin && !musicKey
        ? '未检测到 QQ 音乐登录 Cookie，请先在 y.qq.com 扫码登录'
        : (!musicKey
          ? '已检测到 QQ 账号，但缺少 qm_keyst 播放票据，请在 y.qq.com 重新登录'
          : '缺少 QQ uin'),
    };
  }
  let profileBody = null;
  let vipQueryBody = null;
  try {
    [profileBody, vipQueryBody] = await Promise.all([
      fetchQQProfileHomepage(uin, cookieHeader).catch(() => null),
      fetchQQVipQuery(uin, cookieHeader).catch(() => null),
    ]);
  } catch (_) {}
  const info = normalizeQQProfile(profileBody, cookieHeader);
  const vip = normalizeQQVipFields(profileBody, vipQueryBody, cookieHeader);
  const merged = {
    ...info,
    ...vip,
    vipType: Math.max(Number(info.vipType || 0), Number(vip.vipType || 0)) || (vip.isVip ? 1 : 0),
    isVip: !!(info.isVip || vip.isVip),
    vipLevel: (info.isVip || vip.isVip) ? 'vip' : 'none',
    vipLabel: (info.isVip || vip.isVip) ? 'QQ VIP' : '无VIP',
  };
  if (profileBody && (profileBody.code === 1000 || profileBody.result === 301)) {
    return { ...merged, profileUnavailable: true };
  }
  if (!merged.vipType && !merged.isVip && vipQueryBody) {
    merged.vipSource = 'vip-query';
  } else if (merged.vipType > 0) {
    merged.vipSource = profileBody ? 'qq-profile' : 'cookie';
  }
  return merged;
}

export async function handleQQSearch(keywords, limit, cookieHeader, page) {
  const safeLimit = Math.max(4, Math.min(30, Number(limit) || 12));
  let songs = await qqDesktopSearch(keywords, safeLimit, page || 1, cookieHeader);
  if (!songs.length) {
    const base = await qqSmartboxSearch(keywords, safeLimit);
    await qqSongDetailsBatch(base, cookieHeader);
    songs = base;
  }
  const seen = new Set();
  return songs.filter((song) => {
    const key = song && (song.mid || song.id || `${song.name}|${song.artist}`);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!song.name;
  });
}

export async function handleQQSongUrl(mid, mediaMid, qualityPreference, cookieHeader) {
  const songmid = String(mid || '').trim();
  if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' };
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));
  const uin = qqCookieUin(cookieHeader) || '0';
  const musicKey = qqCookieMusicKey(cookieHeader);
  const playbackKey = qqCookiePlaybackKey(cookieHeader);
  // 新版 UrlGetVkey 的 uin 用的是音乐账号 id（str_musicid/musicid），不是 QQ 号。
  const musicId = qqCookieMusicId(cookieHeader);
  let fileMediaMid = String(mediaMid || '').trim();
  let detailMeta = null;
  if (!fileMediaMid) {
    try {
      const detail = await qqSongDetail(songmid, {}, cookieHeader);
      detailMeta = detail || null;
      fileMediaMid = String(detail && detail.mediaMid || '').trim();
    } catch (_) {}
  }
  if (!detailMeta) {
    try {
      detailMeta = await qqSongDetail(songmid, {}, cookieHeader);
    } catch (_) {}
  }
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const mediaIds = [];
  if (fileMediaMid) mediaIds.push(fileMediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);
  // 文件名必须是两段：prefix + songmid + media_mid + 扩展名。只给 media_mid 时
  // vkey 可能给 purl，但 CDN 仍会 403；VIP 歌也可能直接回 104003。
  const filenameFor = (item, mediaId) => item.prefix + songmid + (mediaId || songmid) + item.ext;
  const fileCandidates = mediaIds.flatMap((mediaId) =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
      .map((item) => ({ ...item, mediaId, filename: filenameFor(item, mediaId) })),
  );
  const filenames = fileCandidates.map((item) => item.filename);
  const param = {
    guid,
    songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
    songtype: filenames.length ? filenames.map(() => 0) : [0],
    uin,
    loginflag: 1,
    platform: '20',
  };
  if (filenames.length) param.filename = filenames;
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0, platform: 'yqq.json' };
  if (musicKey) comm.authst = musicKey;
  const vkeyPayload = {
    comm,
    req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param },
  };
  const readVkey = (response) => {
    const rows = response && response.req_0 && response.req_0.data && Array.isArray(response.req_0.data.midurlinfo)
      ? response.req_0.data.midurlinfo
      : [];
    return { data: response && response.req_0 && response.req_0.data, rows, info: rows.find((item) => item && item.purl) || rows[0] };
  };
  // 现场：账号有会员、官方 App 能播，我们这边同一批歌里有的 purl=true、有的每档音质都 104003。
  // 说明不是版权问题，而是**请求形态**（客户端类型 ct 与凭证种类）不匹配 —— 和当初写红心同一个教训。
  // 这里按顺序试几种形态，只要拿到 purl 就停；trace 记下哪种生效，报告里能直接看出来。
  const vkeyRequest = { req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param } };
  const urlVkeyRequest = {
    req_0: { module: 'music.vkey.GetVkey', method: 'UrlGetVkey', param: { ...param, uin: musicId || uin, ctx: 0 } },
  };
  const vkeyShapes = [
    { shape: 'ct19', comm, req_0: vkeyRequest.req_0 },
    { shape: 'ct24', comm: { ...comm, ct: 24 }, req_0: vkeyRequest.req_0 },
    { shape: 'web-plain', comm: { format: 'json', uin, ct: 24, cv: 0, platform: 'yqq.json' }, req_0: vkeyRequest.req_0 },
    // 新版播放协议：带会话用 UrlGetVkey；优先于 android 兜底，网页 p_skey 可用时就能拿到 VIP 链接。
    { shape: 'url-web', comm: musicId ? { ...comm, qq: musicId } : comm, req_0: urlVkeyRequest.req_0 },
  ];
  let json = null;
  let { data, rows: infos, info } = { data: null, rows: [], info: null };
  let purl = '';
  let vkeyShape = '';
  let vkeyAttempts = 0;
  let lastRestriction = null;
  const vkeySession = {
    hasSession: !!(uin && musicKey),
    hasPlaybackKey: !!(uin && playbackKey),
    hasWebAuth: qqCookieHasWebAuth(cookieHeader),
  };
  for (const candidate of vkeyShapes) {
    vkeyAttempts += 1;
    try {
      const response = await qqMusicRequest({ comm: candidate.comm, req_0: candidate.req_0 || vkeyRequest.req_0 }, cookieHeader);
      const read = readVkey(response);
      if (read.info && read.info.purl) {
        json = response;
        data = read.data;
        infos = read.rows;
        info = read.info;
        purl = read.info.purl;
        vkeyShape = candidate.shape;
        break;
      }
      data = read.data;
      infos = read.rows;
      info = read.info;
      lastRestriction = classifyQQPlaybackRestriction(info, vkeySession);
    } catch (_) {}
  }
  // 最后再试一次实测可用的 android 身份（设备 + QIMEI + uid/sid 会话 + g_tk）。
  // 注意：这不是原生扫码登录，登录仍然只走网页；这里只是用同一份网页 cookie 换一种 vkey 请求形态。
  if (!purl) {
    try {
      const device = await getQQRadioDevice();
      await ensureQQQimei(device);
      await ensureQQAndroidSession(device);
      const { candidates } = qqRadioLoginTypes(cookieHeader);
      const androidComm = {
        ...buildQQRadioComm(cookieHeader, device, candidates[0]),
        ...(musicKey ? { authst: musicKey } : {}),
      };
      for (const request of [vkeyRequest.req_0, urlVkeyRequest.req_0]) {
        vkeyAttempts += 1;
        const androidJson = await qqMusicRequest(
          { comm: androidComm, req_0: request },
          buildQQRadioCookie(cookieHeader),
          QQ_MUSICU_UA,
          { gTk: qqGtk(cookieHeader) },
        );
        const fallback = readVkey(androidJson);
        if (fallback.info && fallback.info.purl) {
          json = androidJson;
          data = fallback.data;
          infos = fallback.rows;
          info = fallback.info;
          purl = fallback.info.purl;
          vkeyShape = request.method === 'UrlGetVkey' ? 'android-url' : 'android';
          break;
        }
        data = fallback.data;
        infos = fallback.rows;
        info = fallback.info;
        lastRestriction = classifyQQPlaybackRestriction(info, vkeySession);
      }
    } catch (_) {}
  }
  // 最后一步：上面几种形态都拿不到 purl 时，说明问题可能不在身份，而在**请求的文件名/音质组合**。
  // 现场：失败歌的 qqCode=104003 但 rawMessage 为空、rows 有 4~6 行 —— 像是「这些文件不存在」而不是
  // 「没权限」。所以把全部音质模板（含无损 FLAC / Hi-Res）都塞进去再问一次，逐行看 QQ 怎么回。
  let rowDetail = '';
  if (!purl) {
    try {
      const allFileCandidates = mediaIds.flatMap((mediaId) =>
        QQ_QUALITY_CANDIDATE_TEMPLATES.map((item) => ({ ...item, mediaId, filename: filenameFor(item, mediaId) })),
      );
      const allParam = { ...param, filename: allFileCandidates.map((item) => item.filename) };
      const allResponse = await qqMusicRequest(
        { comm, req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: allParam } },
        cookieHeader,
      );
      const read = readVkey(allResponse);
      rowDetail = read.rows
        .slice(0, 5)
        .map((row) => `${String(row && row.filename || '').slice(-14)}:${String(row && (row.result ?? row.code ?? ''))}${row && row.purl ? '+url' : ''}`)
        .join(' ');
      if (read.info && read.info.purl) {
        json = allResponse;
        data = read.data;
        infos = read.rows;
        info = read.info;
        purl = read.info.purl;
        vkeyShape = 'allqualities';
      }
    } catch (_) {}
  }
  // 报告留痕：形状 / 是否拿到 purl / 试了几种 / QQ 原文码与说明 / 它自己的分类 / 各文件名的返回码。
  noteLibraryStep('qq', 'song-url:vkey', {
    shape: vkeyShape || 'none',
    purl: Boolean(purl),
    attempts: vkeyAttempts,
    rows: infos.length,
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').slice(0, 60),
    category: lastRestriction && lastRestriction.category ? lastRestriction.category : '',
    hasPlaybackKey: vkeySession.hasPlaybackKey,
    webAuth: vkeySession.hasWebAuth,
    hasMusicId: Boolean(musicId),
    mediaMid: fileMediaMid ? fileMediaMid.slice(0, 20) : '(none)',
    filename: info && info.filename,
    rowDetail: rowDetail.slice(0, 160),
  });
  if (purl) {
    const sip = (data.sip && data.sip[0]) || 'https://ws.stream.qqmusic.qq.com/';
    const fileMeta = fileCandidates.find((item) => item.filename === info.filename) || {};
    return {
      provider: 'qq',
      url: sip + purl,
      trial: false,
      playable: true,
      level: fileMeta.level || info.filename || '',
      quality: fileMeta.label || info.filename || '',
      filename: info.filename || '',
      requestedQuality,
      playbackKeyReady: !!(uin && playbackKey),
      loggedIn: !!(uin && musicKey),
      cover: detailMeta && detailMeta.cover || '',
      albumMid: detailMeta && detailMeta.albumMid || '',
      mid: songmid,
    };
  }
  const restriction = classifyQQPlaybackRestriction(info, {
    hasSession: !!(uin && musicKey),
    hasPlaybackKey: !!(uin && playbackKey),
    hasWebAuth: qqCookieHasWebAuth(cookieHeader),
  });
  return {
    provider: 'qq',
    url: '',
    playable: false,
    error: 'QQ_URL_UNAVAILABLE',
    loggedIn: !!(uin && musicKey),
    playbackKeyReady: !!(uin && playbackKey),
    restriction,
    reason: restriction.category,
    message: restriction.message,
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
    tried: fileCandidates.map((item) => item.label + ' · ' + item.filename),
    requestedQuality,
  };
}

export async function handleQQArtistDetail(mid, limit, cookieHeader) {
  const singerMid = String(mid || '').trim();
  const num = Math.max(10, Math.min(80, Number(limit) || 36));
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] };
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    singer: {
      module: 'music.web_singer_info_svr',
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid: singerMid, sin: 0, num },
    },
  }, cookieHeader);
  const block = json && json.singer;
  if (!block || Number(block.code || 0) !== 0) {
    return {
      provider: 'qq',
      error: (block && (block.message || block.msg || block.code)) || 'QQ_ARTIST_DETAIL_FAILED',
      artist: null,
      songs: [],
    };
  }
  const data = block.data || {};
  const info = data.singer_info || data.singerInfo || {};
  const rawSongs = Array.isArray(data.songlist) ? data.songlist : [];
  const songs = rawSongs
    .map((raw) => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
    .filter((song) => song && song.name && (song.mid || song.id));
  const artistMid = info.mid || singerMid;
  return {
    provider: 'qq',
    artist: {
      provider: 'qq',
      id: info.id || '',
      mid: artistMid,
      name: info.name || info.title || '',
      avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
      fans: Number(info.fans || 0) || 0,
      musicSize: Number(data.total_song || data.song_count || 0) || songs.length,
    },
    total: Number(data.total_song || data.song_count || 0) || songs.length,
    songs,
  };
}

export async function handleQQSongComments(id, mid, limit, offset, cookieHeader) {
  let topid = String(id || '').replace(/\D/g, '');
  if (!topid && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid }, cookieHeader);
      topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '');
    } catch (_) {}
  }
  if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] };
  try {
    const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
    const uin = qqCookieUin(cookieHeader) || '0';
    const body = await qqGetJSON('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
      g_tk: '5381',
      loginUin: uin,
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0',
      cid: '205360772',
      reqtype: '2',
      biztype: '1',
      topid,
      cmd: '8',
      needmusiccrit: '0',
      pagenum: String(page),
      pagesize: String(limit || 20),
    }, cookieHeader);
    const hotList = body && body.hot_comment && body.hot_comment.commentlist;
    const normalList = body && body.comment && body.comment.commentlist;
    const raw = offset === 0 && Array.isArray(hotList) && hotList.length ? hotList : normalList || [];
    const comments = raw.map(mapQQComment).filter((c) => c.content);
    const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length;
    return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length) };
  } catch (err) {
    return { provider: 'qq', error: err.message || String(err), id: topid, comments: [] };
  }
}

async function resolveQQSongNumericId(id, mid, cookieHeader) {
  let songId = '';
  const rawId = String(id || '').trim();
  if (rawId && !isQQSongMid(rawId)) songId = rawId.replace(/\D/g, '');
  if (!songId && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid }, cookieHeader);
      const fromQqId = String((detail && detail.qqId) || '').replace(/\D/g, '');
      if (fromQqId) {
        songId = fromQqId;
      } else {
        const detailId = String((detail && detail.id) || '').trim();
        if (detailId && !isQQSongMid(detailId)) songId = detailId.replace(/\D/g, '');
      }
    } catch (_) {}
  }
  return songId;
}

/**
 * QQ 网页 CGI 的 g_tk（bkn）。
 *
 * 算法只认 `skey` / `p_skey` —— 那是 QQ 登录的 CSRF token。以前这里拿 `qm_keyst` /
 * `qqmusic_key`（musickey，完全是另一套东西）去算，得到的是一个**错误的** g_tk，CGI 直接回
 * 403（现场 legacy 兜底那条 403 就是它）。没有 skey 时按惯例用 5381（正好等于 hash33("")），
 * 公开实现 jsososo/QQMusicApi 就是固定用这个值。
 */
function qqGtk(cookieHeader) {
  const obj = parseCookieString(cookieHeader);
  const key = obj.p_skey || obj.skey || '';
  if (!key) return 5381;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash += (hash << 5) + key.charCodeAt(i);
    hash &= 0x7fffffff;
  }
  return hash & 0x7fffffff;
}

function isQQSongMid(value) {
  const raw = String(value || '').trim();
  return /^[0-9A-Za-z]{10,20}$/.test(raw) && !/^\d+$/.test(raw);
}

function collectQQFavSets(body) {
  const idSet = new Set();
  const midSet = new Set();
  const idMap = (body && (body.map || (body.data && body.data.map))) || {};
  const midMap = (body && (body.mapmid || (body.data && body.data.mapmid))) || {};
  if (Array.isArray(idMap)) {
    idMap.forEach((id) => { if (id != null) idSet.add(String(id)); });
  } else if (idMap && typeof idMap === 'object') {
    Object.keys(idMap).forEach((key) => {
      idSet.add(String(key));
      if (idMap[key] != null) idSet.add(String(idMap[key]));
    });
    Object.values(idMap).forEach((val) => { if (val != null) idSet.add(String(val)); });
  }
  if (midMap && typeof midMap === 'object') {
    Object.keys(midMap).forEach((mid) => {
      midSet.add(String(mid));
      if (midMap[mid] != null) idSet.add(String(midMap[mid]));
    });
    Object.values(midMap).forEach((val) => { if (val != null) idSet.add(String(val)); });
  }
  return { idSet, midSet, idMap, midMap };
}

async function fetchQQFavCatalog(cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  let body = null;
  try {
    body = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg', {
      dirid: 201,
      dirinfo: 1,
      g_tk: gtk,
      format: 'json',
      loginUin: uin,
      hostUin: uin,
    }, cookieHeader);
  } catch (_) {}
  const sets = collectQQFavSets(body || {});
  if (!sets.idSet.size && !sets.midSet.size) {
    try {
      const json = await qqMusicRequest({
        comm: { uin, format: 'json' },
        req_0: {
          module: 'music.musicasset.SongFavRead',
          method: 'GetSongIdList',
          param: { uin: Number(uin) || uin, dirId: 201 },
        },
      }, cookieHeader);
      const list = (((json.req_0 || {}).data || {}).songIds) || (((json.req_0 || {}).data || {}).songIdList) || [];
      list.map(String).forEach((id) => sets.idSet.add(id));
    } catch (_) {}
  }
  return sets;
}

export async function handleQQSongLikeCheck(ids, cookieHeader) {
  const status = await getQQLoginStatus(cookieHeader);
  const liked = {};
  if (!status.loggedIn) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, liked, ids };
  const catalog = await fetchQQFavCatalog(cookieHeader);
  (ids || []).forEach((id) => {
    const raw = String(id || '').trim();
    const numeric = raw.replace(/\D/g, '');
    liked[id] = catalog.idSet.has(raw)
      || (numeric && catalog.idSet.has(numeric))
      || (isQQSongMid(raw) && catalog.midSet.has(raw));
  });
  return { provider: 'qq', loggedIn: true, ids, liked };
}

async function qqAddToFavByMid(songMid, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  const mid = String(songMid || '').trim();
  if (!mid) return null;
  const body = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg', {
    midlist: mid,
    typelist: '13',
    dirid: 201,
    addtype: '',
    formsender: 4,
    r2: 0,
    r3: 1,
    utf8: 1,
    g_tk: gtk,
    loginUin: uin,
    // 公开实现（jsososo/QQMusicApi）这个接口固定 hostUin=0；填自己的 uin 会被当成越权操作。
    hostUin: 0,
    format: 'json',
  }, cookieHeader);
  const code = Number(body && (body.code ?? body.ret ?? body.retCode ?? 0));
  if (code === 1000) return { ok: false, loginRequired: true, code, body };
  if (!code) return { ok: true, code: 0, body };
  return { ok: false, code, body };
}

async function qqDelFromFavById(songId, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  const id = String(songId || '').replace(/\D/g, '');
  if (!id) return null;
  const body = await qqGetJSON('https://c.y.qq.com/qzone/fcgi-bin/fcg_music_delbatchsong.fcg', {
    loginUin: uin,
    // 与公开实现一致：hostUin 固定 0（填自己的账号会被当成越权）。
    hostUin: 0,
    uin,
    dirid: 201,
    ids: id,
    types: '3',
    source: 103,
    formsender: 4,
    flag: 2,
    from: 3,
    utf8: 1,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.post',
    needNewCode: 0,
    g_tk: gtk,
  }, cookieHeader);
  const code = Number(body && (body.code ?? body.ret ?? body.retCode ?? 0));
  if (code === 1000) return { ok: false, loginRequired: true, code, body };
  if (!code) return { ok: true, code: 0, body };
  return { ok: false, code, body };
}

/**
 * 收藏 / 取消收藏单曲。形状照上游 qq-music-api 3.3.1 的 services/user/songLike：
 *   身份核对（get_song_detail_yqq）→ 读关系（SongFavRead / IsSongFanByMid）→ 已是目标状态直接回
 *   → 写（PlaylistDetailWrite / AddSonglist|DelSonglist，songType 固定 0）→ 再读一次确认。
 *
 * 以前这里发的是**网页 comm**，写的参数还自己加过参考里没有的 songType 13，失败又全被
 * `catch (_) {}` 吞掉，诊断里只剩一句 __foliaBridgeError。现在改用客户端模块那套
 * android comm + QQMusic UA，并且每一步都记 code/subcode，失败时能看出卡在哪一步。
 *
 * legacy CGI（fcg_music_add2songdir / delbatchsong）降级为兜底，且**必须靠同一套再读确认**才算成功 ——
 * 它自报成功不算数。
 */
export async function handleQQSongLike(id, mid, like, cookieHeader) {
  const status = await getQQLoginStatus(cookieHeader);
  if (!status.loggedIn) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false };
  const songMid = String(mid || (isQQSongMid(id) ? id : '') || '').trim();
  const songId = Number(await resolveQQSongNumericId(isQQSongMid(id) ? '' : id, songMid, cookieHeader)) || 0;
  if (!songMid || !songId) return { provider: 'qq', error: 'MISSING_QQ_SONG_ID', loggedIn: true, mid: songMid };
  const wantLiked = like !== false;

  const fail = (code, step, extra) => ({
    provider: 'qq',
    error: `QQ_${wantLiked ? 'LIKE' : 'UNLIKE'}_FAILED`,
    loggedIn: true,
    id: songId,
    mid: songMid,
    liked: !wantLiked,
    code,
    step,
    ...(extra || {}),
  });
  const loginRequired = () => ({ provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, mid: songMid });
  const done = (via) => ({ provider: 'qq', loggedIn: true, id: songId, mid: songMid, liked: wantLiked, code: 0, via });

  // 1) 身份核对：mid 与 id 必须指向同一首，对不上就不猜、不写。
  const detail = await qqAndroidMusicuCall(
    'music.pf_song_detail_svr', 'get_song_detail_yqq', { song_type: 0, song_mid: songMid }, cookieHeader,
  );
  const trackInfo = (detail.data && detail.data.track_info) || {};
  noteLibraryStep('qq', 'song-like:identity', {
    ok: detail.ok, code: detail.code, subcode: detail.subcode,
    matches: Number(trackInfo.id) === songId && String(trackInfo.mid || '') === songMid,
  });
  if (!detail.ok) return detail.loginRequired ? loginRequired() : fail(detail.code, 'identity');
  if (Number(trackInfo.id) !== songId || String(trackInfo.mid || '') !== songMid) {
    return fail(-1, 'identity-mismatch', { trackId: trackInfo.id, trackMid: trackInfo.mid });
  }

  // 2) 读当前关系（写完也用它确认）。
  const readLiked = async () => {
    const res = await qqAndroidMusicuCall(
      'music.musicasset.SongFavRead', 'IsSongFanByMid', { v_songMid: [songMid] }, cookieHeader,
    );
    const fan = (res.data && res.data.m_fan) || {};
    const value = typeof fan[songMid] === 'boolean' ? fan[songMid] : null;
    noteLibraryStep('qq', 'song-like:read', { ok: res.ok, code: res.code, subcode: res.subcode, liked: value });
    if (!res.ok) return { ok: false, loginRequired: res.loginRequired, code: res.code };
    if (value === null) return { ok: false, code: -1 };
    return { ok: true, liked: value };
  };

  const before = await readLiked();
  if (!before.ok) return before.loginRequired ? loginRequired() : fail(before.code, 'read');
  if (before.liked === wantLiked) return done('already');

  // 3) 写入候选端点，逐个试、每个都用再读关系确认（写接口自报成功不算数）。
  //
  // 第一候选就是**实测可用的形状**：android comm + 设备身份 + QIMEI + uid/sid 会话 +
  // QQMusic UA + 重建凭据 cookie，**并且带 g_tk**（见 qqMusicassetWriteCall 的注释：
  // 两个方案各对了一半，合起来才过）。加与删走同一个端点同一套形状，只是方法不同。
  const accountDirId = await resolveQQLikedDirId(cookieHeader);
  const dirId = accountDirId || 201;
  const uin = qqCookieUin(cookieHeader);
  const attempts = [
    {
      via: 'PlaylistDetailWrite',
      run: () => qqMusicassetWriteCall(
        'music.musicasset.PlaylistDetailWrite',
        wantLiked ? 'AddSonglist' : 'DelSonglist',
        { dirId, v_songInfo: [{ songId, songType: 0 }] },
        cookieHeader,
      ),
    },
    {
      // 网页 comm + g_tk：单独用回 80105，留作第二候选（换一种身份试一次，不再是主路径）。
      via: 'PlaylistDetailWriteWeb',
      run: () => qqWebCommWriteCall(
        'music.musicasset.PlaylistDetailWrite',
        wantLiked ? 'AddSonglist' : 'DelSonglist',
        { dirId, v_songInfo: [{ songId, songType: 0 }] },
        cookieHeader,
      ),
    },
    {
      via: 'SongFavWrite',
      run: () => qqMusicassetWriteCall(
        'music.musicasset.SongFavWrite',
        wantLiked ? 'AddSong' : 'DelSong',
        {
          uin: Number(uin) || uin,
          v_uin: Number(uin) || uin,
          dirId,
          ids: [songId],
          songTypes: [0],
        },
        cookieHeader,
      ),
    },
  ];

  let lastCode = 0;
  let anyAccepted = false;
  for (const attempt of attempts) {
    const write = await attempt.run();
    const writeData = (write.data && typeof write.data === 'object') ? write.data : {};
    noteLibraryStep('qq', 'song-like:write', {
      via: attempt.via,
      ok: write.ok, code: write.code, subcode: write.subcode,
      retCode: writeData.retCode, msg: write.msg, dirId,
    });
    if (write.loginRequired) return loginRequired();
    lastCode = write.ok ? (writeData.retCode || -1) : write.code;
    // 上游自报接受、关系却没变，与「上游直接拒」是两回事，留痕要分得开。
    if (write.ok && Number(writeData.retCode) === 0) anyAccepted = true;
    const after = await readLiked();
    if (after.ok && after.liked === wantLiked) return done(attempt.via);
  }

  // 4) 最后才试 legacy CGI（fcg_music_add2songdir / delbatchsong）。现场它一直回 403，
  // 但它是参考实现给「musicu 写接口不可用」时留下的退路，留着不亏；同样靠再读确认。
  const legacy = wantLiked
    ? await qqAddToFavByMid(songMid, cookieHeader).catch((error) => ({ ok: false, error: String(error && error.message || error) }))
    : await qqDelFromFavById(songId, cookieHeader).catch((error) => ({ ok: false, error: String(error && error.message || error) }));
  const afterLegacy = await readLiked();
  noteLibraryStep('qq', 'song-like:legacy', {
    ok: Boolean(legacy && legacy.ok),
    code: legacy && legacy.code,
    confirmed: afterLegacy.ok ? afterLegacy.liked === wantLiked : 'read-failed',
  });
  if (afterLegacy.ok && afterLegacy.liked === wantLiked) return done(wantLiked ? 'add2songdir' : 'delbatchsong');

  // 5) 还是拒：跑一次「形状矩阵」自检（每个会话一次），把余下候选形状一次试完 ——
  // 用户只需要点一次红心，报告里就带上全部原始回码，不必一轮一轮装包试。
  if (wantLiked) {
    const swept = await qqLikeShapeSweep(songMid, songId, cookieHeader, readLiked);
    if (swept) return done(swept);
  }

  return fail(
    anyAccepted ? -1 : lastCode,
    anyAccepted ? 'verify-mismatch' : 'write-rejected',
    // retCode 是最后一个写入端点的上游回码；verifyMismatch 表示「上游说接受、关系没变」。
    { dirId, retCode: lastCode, verifyMismatch: anyAccepted, legacyCode: legacy && legacy.code },
  );
}

/**
 * 红心写入失败时的「形状矩阵」自检。
 *
 * 现场证据已经把「字段缺失」排除了：凭证、身份核对、关系读取、android 会话、QIMEI、
 * 网页 comm、g_tk（真值）全部对齐，写入仍回业务码 80105（参考实现的码表把它登记为
 * 「第三方回报：往「我喜欢」加歌被拒，参数还是权限问题未知」，且是终态）。
 *
 * 剩下的可能只剩下「不同实现用的形状不同」。与其一轮试一种（每轮都要用户装包+反馈），
 * 不如一次把余下的候选形状全试完，每个都把上游原始回码写进留痕；任一个被再读确认成功就停。
 * 只在每个会话第一次失败时跑一次，避免请求风暴；只对「加」跑（「删」会动用户数据）。
 */
let qqWriteSweepDone = false;

async function qqLikeShapeSweep(songMid, songId, cookieHeader, readLiked) {
  if (qqWriteSweepDone) return null;
  qqWriteSweepDone = true;
  const uin = qqCookieUin(cookieHeader);
  const musicId = String(qqCookieMusicId(cookieHeader) || '').trim();
  const dirId = (await resolveQQLikedDirId(cookieHeader)) || 201;

  const record = (shape, res) => {
    const data = (res && res.data && typeof res.data === 'object') ? res.data : {};
    noteLibraryStep('qq', 'sweep:attempt', {
      shape,
      ok: res && res.ok,
      code: res && res.code,
      subcode: res && res.subcode,
      retCode: data.retCode,
      msg: typeof (res && res.msg) === 'string' ? res.msg.slice(0, 80) : undefined,
      dataKeys: Object.keys(data).slice(0, 8).join(','),
    });
  };

  const viaWebComm = (module, method, param, commUin) => qqWebCommWriteCall(
    module, method, param, cookieHeader, commUin,
  );

  const tests = [
    // 1) 网页 comm，但 uin 用音乐账号 id（str_musicid），而不是 cookie 里的 QQ 号。
    () => viaWebComm('music.musicasset.PlaylistDetailWrite', 'AddSonglist',
      { dirId, v_songInfo: [{ songId, songType: 0 }] }, musicId || uin),
    // 2) SongFavWrite/AddSong（批量式参数），走实测可用的形状。
    () => qqMusicassetWriteCall('music.musicasset.SongFavWrite', 'AddSong',
      { uin: Number(uin) || uin, v_uin: Number(uin) || uin, dirId, ids: [songId], songTypes: [0] },
      cookieHeader),
    // 3) dirId 0：参考实现把 `{dirId: 0, tid: 0}` 也当成成功形状，也许 0 才是「默认收藏」。
    () => viaWebComm('music.musicasset.PlaylistDetailWrite', 'AddSonglist',
      { dirId: 0, v_songInfo: [{ songId, songType: 0 }] }, uin),
    // 4) songType 13（历史上被猜过的类型码）。
    () => viaWebComm('music.musicasset.PlaylistDetailWrite', 'AddSonglist',
      { dirId, v_songInfo: [{ songId, songType: 13 }] }, uin),
  ];

  for (let index = 0; index < tests.length; index += 1) {
    let res = null;
    try {
      res = await tests[index]();
    } catch (error) {
      res = { ok: false, code: -1, msg: String((error && error.message) || error) };
    }
    record(`#${index + 1}`, res);
    if (res && res.loginRequired) return null;
    const after = await readLiked();
    if (after.ok && after.liked === true) return `sweep#${index + 1}`;
  }
  return null;
}

/**
 * 登录通道用的匿名 musicu 调用（原生扫码的 CreateQRCode 与 Login 交换都走它）。
 *
 * 与参考实现一致：不带凭据、只带设备与 QIMEI，调用方用 commOverrides 覆盖 ct/cv 或加
 * tmeLoginType。原生通道换来的凭据必须由它自己产生 —— 这正是这条通道存在的理由。
 */
export async function qqAnonymousMusicuCall(module, method, param, commOverrides) {
  const device = await getQQRadioDevice();
  await ensureQQQimei(device);
  const { tmeLoginType: _loginType, ...anonymousComm } = buildQQRadioComm('', device, undefined);
  return qqMusicuCall(
    module, method, param, '',
    { ...anonymousComm, ...(commOverrides || {}) },
    { ua: QQ_MUSICU_UA },
  );
}

/**
 * 账号真实的「我喜欢」目录号。
 *
 * 歌单写入一直是先 GetPlaylistByUin 查账号真实目录号再写，唯独红心写死 201（旧版收藏目录的
 * 约定值）。读关系（IsSongFanByMid）不需要目录号、一直是好的，所以这个值从没被验证过 ——
 * 先把它坐实并记进留痕，两者不一致时按账号的来。
 */
async function resolveQQLikedDirId(cookieHeader) {
  const owner = String(qqCookieMusicId(cookieHeader) || '').trim();
  if (!owner) return 0;
  const owned = await qqAndroidMusicuCall(
    'music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin: owner }, cookieHeader,
  );
  const rows = Array.isArray(owned.data && owned.data.v_playlist) ? owned.data.v_playlist : [];
  const candidate = rows.find((row) => {
    const name = String((row && (row.dirName || row.dirname || row.name || row.title)) || '');
    const dirId = Number(row && row.dirId);
    if (!Number.isSafeInteger(dirId) || dirId <= 0) return false;
    return /我喜欢|默认收藏|红心/i.test(name) || dirId === 201;
  });
  const dirId = Number(candidate && candidate.dirId);
  const resolved = Number.isSafeInteger(dirId) && dirId > 0 ? dirId : 0;
  noteLibraryStep('qq', 'song-like:dir', {
    rows: rows.length,
    dirId: resolved,
    name: String((candidate && (candidate.dirName || candidate.dirname || candidate.name)) || '').slice(0, 24),
  });
  return resolved;
}

function buildQQAuthComm(cookieHeader, extra) {
  const uin = qqCookieUin(cookieHeader) || '0';
  const musicKey = qqCookieMusicKey(cookieHeader);
  const comm = Object.assign({ uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0, platform: 'yqq.json' }, extra || {});
  if (musicKey) comm.authst = musicKey;
  // 微信扫码登录的凭据必须带着自己的 tmeLoginType 回来，否则上游按 QQ 通道解析会拿不到数据。
  // 会话里没写这个 cookie 时（QQ 通道）保持原样，不引入新字段。
  const loginType = Number(parseCookieString(cookieHeader).tmeLoginType);
  if (Number.isFinite(loginType) && loginType > 0) comm.tmeLoginType = loginType;
  return comm;
}

function normalizeQQPlaylistCover(cover) {
  let url = String(cover || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^http:\/\//i.test(url) && /(?:qlogo\.cn|qpic\.cn|qq\.com|gtimg\.cn)/i.test(url)) {
    url = `https://${url.slice(7)}`;
  }
  if (/y\.qq\.com\/music\/photo_new\//i.test(url)) {
    url = url.replace('://y.qq.com/music/photo_new/', '://y.gtimg.cn/music/photo_new/');
  }
  // Snap invalid photo_new sizes (80/120/320/400 → nearest official size).
  if (/\/music\/photo_new\/T00[12]R\d+x\d+M000/i.test(url)) {
    const m = url.match(/T00[12]R(\d+)x(\d+)M000/i);
    const cur = m ? Number(m[1]) : 0;
    const allowed = [68, 90, 126, 150, 180, 300, 500, 800];
    if (!cur || !allowed.includes(cur)) {
      const px = qqOfficialCoverSize(cur || 300);
      url = url.replace(/(T00[12]R)\d+x\d+(M000)/i, `$1${px}x${px}$2`);
    }
  }
  // QQ placeholder disc art — treat as empty so callers can fall back.
  if (/mediastyle\/(?:y|global)\/img\/cover_qzone/i.test(url)) return '';
  if (/T002R\d+x\d+M0000{10,}/i.test(url)) return '';
  return url;
}

function normalizeQQUserPlaylistRow(pl, opts) {
  opts = opts || {};
  if (!pl || typeof pl !== 'object') return null;
  const dirid = pl.dirid != null ? pl.dirid : (pl.dirId != null ? pl.dirId : pl.dir_id);
  const tid = pl.tid || pl.dissid || pl.diss_id || pl.dissId || pl.playlist_id || pl.playlistId;
  // Prefer real playlist tid; dirid-only rows (e.g. 我喜欢=201) still valid.
  const id = tid || pl.id || dirid;
  if (id == null || id === '') return null;
  // Upstream sometimes returns tid=0 for empty placeholders.
  if (String(id) === '0' && String(dirid || '') !== '201') return null;
  // GetPlaylistByUin uses camelCase dirName; older APIs use dissname/title.
  const name = String(
    pl.dirName || pl.dirname || pl.dir_name || pl.DissName || pl.dissname || pl.diss_name ||
    pl.Title || pl.title || pl.name || ''
  ).trim();
  const cover = normalizeQQPlaylistCover(
    pl.diss_cover || pl.logo || pl.picurl || pl.picUrl || pl.pic_url || pl.bigpicUrl || pl.bigpic_url ||
    pl.albumPicUrl || pl.album_pic_url || pl.cover || pl.pic || pl.headurl || pl.imgurl || pl.img || pl.portrait || ''
  );
  const trackCount = Number(
    pl.songNum || pl.songnum || pl.song_cnt || pl.song_num || pl.total_song_num ||
    pl.cnt || pl.total_num || pl.totalNum || 0
  ) || 0;
  const playCount = Number(
    pl.play_cnt || pl.playCnt || pl.listen_num || pl.listennum || pl.play_count || pl.playCount || pl.playcnt || 0
  ) || 0;
  const creator = pl.nickname || pl.nick || pl.creator || pl.host_nickname || pl.hostname || '';
  const subscribed = opts.subscribed != null
    ? !!opts.subscribed
    : !!(pl.subscribed || pl.isFav || pl.is_fav || pl.fav);
  const diridStr = dirid != null && dirid !== '' ? String(dirid) : '';
  return {
    id: String(id),
    qqId: String(tid || pl.dissid || id),
    dirid: diridStr,
    name: name || (diridStr === '201' ? '我喜欢' : '未命名歌单'),
    cover,
    trackCount,
    playCount,
    creator,
    provider: 'qq',
    subscribed,
  };
}

function qqPlaylistDedupeKey(pl) {
  if (!pl) return '';
  const dirid = String(pl.dirid || '');
  const id = String(pl.id || pl.qqId || '');
  // 「我喜欢」 always keyed by dirid so tid/dirid variants collapse.
  if (dirid === '201' || id === '201' || pl.name === '我喜欢') return 'liked:201';
  if (id) return `id:${id}`;
  if (dirid) return `dir:${dirid}`;
  return `name:${pl.name || ''}`;
}

function mergeQQUserPlaylists(lists) {
  const seen = new Set();
  const out = [];
  (lists || []).flat().forEach((pl) => {
    if (!pl) return;
    const key = qqPlaylistDedupeKey(pl);
    if (!key) return;
    if (seen.has(key)) {
      const idx = out.findIndex((item) => qqPlaylistDedupeKey(item) === key);
      if (idx < 0) return;
      const cur = out[idx];
        // Prefer "created/liked" (subscribed=false) when the same playlist appears in both feeds.
        out[idx] = Object.assign({}, cur, {
          name: (cur.name && cur.name !== '未命名歌单') ? cur.name : pl.name,
          cover: cur.cover || pl.cover,
          trackCount: Math.max(Number(cur.trackCount) || 0, Number(pl.trackCount) || 0),
          playCount: Math.max(Number(cur.playCount) || 0, Number(pl.playCount) || 0),
          dirid: cur.dirid || pl.dirid,
          qqId: cur.qqId || pl.qqId,
          subscribed: !!(cur.subscribed && pl.subscribed),
        });
      return;
    }
    seen.add(key);
    out.push(pl);
  });
  return out;
}

function ensureQQLikedPlaylist(playlists, uin) {
  const list = Array.isArray(playlists) ? playlists.slice() : [];
  const likedIdx = list.findIndex((pl) => qqPlaylistDedupeKey(pl) === 'liked:201');
  if (likedIdx >= 0) {
    const liked = Object.assign({}, list[likedIdx], {
      name: list[likedIdx].name || '我喜欢',
      dirid: '201',
      subscribed: false,
    });
    list.splice(likedIdx, 1);
    list.unshift(liked);
    return list;
  }
  list.unshift({
    id: '201',
    qqId: '201',
    dirid: '201',
    name: '我喜欢',
    cover: uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(String(uin))}&s=100` : '',
    trackCount: 0,
    playCount: 0,
    creator: '',
    provider: 'qq',
    subscribed: false,
  });
  return list;
}

async function fetchQQUserCreatedPlaylistsLegacy(uin, cookieHeader) {
  const gtk = qqGtk(cookieHeader);
  const body = await qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
    hostUin: 0,
    hostuin: uin,
    sin: 0,
    size: 200,
    g_tk: gtk,
    loginUin: uin,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
  }, cookieHeader);
  if (!body || body.code === 1000) return [];
  const list = (body.data && body.data.disslist) || [];
  return list.map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: false })).filter(Boolean);
}

async function fetchQQUserCreatedPlaylistsByUin(uin, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.PlaylistBaseRead',
      method: 'GetPlaylistByUin',
      param: { uin: String(uin) },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (code && code !== 0 && code !== 200) return [];
  const data = (block && block.data) || {};
  const list = data.v_playlist || data.vPlaylist || data.playlist || data.list || [];
  return (Array.isArray(list) ? list : [])
    .map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: false }))
    .filter(Boolean);
}

async function fetchQQUserCreatedPlaylists(uin, cookieHeader) {
  const primary = await fetchQQUserCreatedPlaylistsByUin(uin, cookieHeader).catch(() => []);
  if (primary && primary.length) return primary;
  return fetchQQUserCreatedPlaylistsLegacy(uin, cookieHeader).catch(() => []);
}

async function fetchQQUserCollectedPlaylistsLegacy(uin, cookieHeader) {
  const body = await qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
    ct: 20,
    cid: 205360956,
    userid: uin,
    reqtype: 3,
    sin: 0,
    ein: 200,
  }, cookieHeader);
  const list = (body && body.data && body.data.cdlist) || [];
  return list.map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: true })).filter(Boolean);
}

async function fetchQQUserCollectedPlaylistsFavApi(uin, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.PlaylistFavRead',
      method: 'CgiGetPlaylistFavInfo',
      param: { uin: String(uin), offset: 0, size: 200 },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (code && code !== 0 && code !== 200) return [];
  const data = (block && block.data) || {};
  const list = data.v_list || data.vList || data.list || data.cdlist || [];
  return (Array.isArray(list) ? list : [])
    .map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: true }))
    .filter(Boolean);
}

async function fetchQQUserCollectedPlaylists(uin, cookieHeader) {
  const [legacy, modern] = await Promise.all([
    fetchQQUserCollectedPlaylistsLegacy(uin, cookieHeader).catch(() => []),
    fetchQQUserCollectedPlaylistsFavApi(uin, cookieHeader).catch(() => []),
  ]);
  return mergeQQUserPlaylists([modern, legacy]);
}

async function fetchQQPersonalPlaylists(uin, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: { module: 'libPersonal.PersonalSvr', method: 'GetPlaylist', param: { uin, req_num: 200 } },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (code && code !== 0 && code !== 200) return [];
  const data = (block && block.data) || {};
  const list = data.cdlist || data.v_playlist || data.vPlaylist || [];
  return (Array.isArray(list) ? list : [])
    .map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: false }))
    .filter(Boolean);
}

export async function handleQQUserPlaylists(cookieHeader) {
  const status = await getQQLoginStatus(cookieHeader);
  if (!status.loggedIn) return { loggedIn: false, playlists: [] };
  const uin = status.uin || qqCookieUin(cookieHeader) || '0';
  let playlists = [];
  const createdResult = await fetchQQUserCreatedPlaylists(uin, cookieHeader).catch((error) => {
    noteQQLibraryStep('playlists:created:error', { message: error && error.message ? error.message : String(error) });
    return [];
  });
  const collectedResult = await fetchQQUserCollectedPlaylists(uin, cookieHeader).catch((error) => {
    noteQQLibraryStep('playlists:collected:error', { message: error && error.message ? error.message : String(error) });
    return [];
  });
  const personalResult = await fetchQQPersonalPlaylists(uin, cookieHeader).catch((error) => {
    noteQQLibraryStep('playlists:personal:error', { message: error && error.message ? error.message : String(error) });
    return [];
  });
  noteQQLibraryStep('playlists:sources', {
    created: createdResult.length,
    collected: collectedResult.length,
    personal: personalResult.length,
    loggedIn: true,
  });
  try {
    // Own playlists first (我喜欢 / 自建), then collected.
    playlists = mergeQQUserPlaylists([createdResult, personalResult, collectedResult]);
  } catch (error) {
    noteQQLibraryStep('playlists:merge:error', { message: error && error.message ? error.message : String(error) });
  }
  if (!playlists.length) {
    try {
      playlists = await fetchQQUserCreatedPlaylists(uin, cookieHeader);
    } catch (error) {
      noteQQLibraryStep('playlists:retry:error', { message: error && error.message ? error.message : String(error) });
    }
  }
  playlists = ensureQQLikedPlaylist(playlists, uin);
  noteQQLibraryStep('playlists:final', { count: playlists.length });
  return {
    loggedIn: true,
    playlists,
    provider: 'qq',
    count: playlists.length,
    createdCount: playlists.filter((pl) => !pl.subscribed).length,
    collectedCount: playlists.filter((pl) => pl.subscribed).length,
  };
}

function mapQQPlaylistSonglist(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => mapQQTrack(item, {}))
    .filter((song) => song.name || song.mid || song.qqId);
}

function extractQQPlaylistMeta(source) {
  const dirinfo = (source && source.dirinfo) || {};
  return {
    name: (source && (source.dissname || source.diss_title || source.title)) || dirinfo.title || '',
    cover: normalizeQQPlaylistCover((source && (source.logo || source.picurl)) || dirinfo.picurl || ''),
  };
}

async function fetchQQPlaylistTracksUcc(disstid, cookieHeader) {
  const uin = qqCookieUin(cookieHeader) || '0';
  const gtk = qqGtk(cookieHeader);
  const body = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1,
    json: 1,
    utf8: 1,
    onlysong: 0,
    new_format: 1,
    disstid,
    format: 'json',
    g_tk: gtk,
    loginUin: uin,
    hostUin: 0,
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, cookieHeader);
  if (!body || Number(body.code) !== 0 || Number(body.subcode) !== 0 || !body.cdlist || !body.cdlist[0]) return null;
  const cd = body.cdlist[0];
  const songs = mapQQPlaylistSonglist(cd.songlist);
  if (!songs.length) return null;
  return { meta: extractQQPlaylistMeta(cd), songs };
}

async function fetchQQPlaylistTracksUniform(disstid, cookieHeader, hostUin) {
  const json = await qqMusicRequest({
    comm: Object.assign(buildQQAuthComm(cookieHeader), { cv: 4747474, needNewCode: 1 }),
    req_1: {
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: {
        disstid: Number(disstid) || disstid,
        userinfo: 1,
        tag: 1,
        orderlist: 1,
        song_begin: 0,
        song_num: 300,
        onlysonglist: 0,
        enc_host_uin: hostUin || '',
      },
    },
  }, cookieHeader);
  const block = json && json.req_1;
  const code = Number(block && block.code);
  if (!block || (code && code !== 0 && code !== 200)) return null;
  const result = block.data || {};
  const songs = mapQQPlaylistSonglist(result.songlist);
  if (!songs.length) return null;
  return { meta: extractQQPlaylistMeta(result), songs };
}

async function fetchQQPlaylistTracksPlaza(disstid, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'playlist.PlayListPlazaServer',
      method: 'GetPlaylistById',
      param: { id: Number(disstid) || disstid, num: 300, onlysong: 0 },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (!block || (code && code !== 0 && code !== 200)) return null;
  const data = block.data || {};
  const songs = mapQQPlaylistSonglist(data.songlist || data.songList);
  if (!songs.length) return null;
  return {
    meta: {
      name: data.title || data.diss_title || '',
      cover: normalizeQQPlaylistCover(data.picurl || data.logo || ''),
    },
    songs,
  };
}

async function fetchQQDirPlaylistTracks(dirid, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  if (!uin || dirid == null || dirid === '') return null;
  const dirNum = Number(dirid);
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.PlaylistFavRead',
      method: 'GetSongList',
      param: { dirId: dirNum, uin: Number(uin) || uin, order: 1, begin: 0, num: 300 },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (!block || (code && code !== 0 && code !== 200)) return null;
  const data = block.data || {};
  const songs = mapQQPlaylistSonglist(data.songlist || data.songList || data.list);
  if (!songs.length) return null;
  return {
    meta: {
      name: data.title || data.diss_title || data.name || '',
      cover: normalizeQQPlaylistCover(data.picurl || data.logo || ''),
    },
    songs,
  };
}

async function fetchQQFavPlaylistTracks(cookieHeader) {
  const dirResult = await fetchQQDirPlaylistTracks(201, cookieHeader);
  if (dirResult && dirResult.songs.length) {
    return { meta: { name: '我喜欢', cover: dirResult.meta.cover || '' }, songs: dirResult.songs };
  }
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  try {
    const body = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg', {
      dirid: 201,
      dirinfo: 1,
      g_tk: gtk,
      format: 'json',
      loginUin: uin,
      hostUin: uin,
    }, cookieHeader);
    const midMap = (body && body.mapmid) || {};
    const mids = Object.keys(midMap).filter(Boolean);
    if (!mids.length) return null;
    const items = mids.slice(0, 300).map((mid) => ({ mid, songmid: mid, id: midMap[mid] }));
    await qqSongDetailsBatch(items, cookieHeader);
    const songs = mapQQPlaylistSonglist(items);
    if (!songs.length) return null;
    return { meta: { name: '我喜欢', cover: '' }, songs };
  } catch (_) {}
  return null;
}

export async function handleQQPlaylistTracks(id, cookieHeader, options) {
  options = options || {};
  const disstid = String(id || '').trim();
  const dirid = options.dirid != null ? String(options.dirid).trim() : '';
  if (!disstid && !dirid) {
    return { provider: 'qq', id: '', tracks: [], songs: [], playlist: { provider: 'qq', tracks: [] } };
  }

  let meta = { id: disstid || dirid, name: '', cover: '', provider: 'qq' };
  let songs = [];
  const attempts = [];

  if (dirid === '201' || disstid === '201') attempts.push(() => fetchQQFavPlaylistTracks(cookieHeader));
  if (dirid && dirid !== '201') attempts.push(() => fetchQQDirPlaylistTracks(dirid, cookieHeader));
  if (disstid) {
    attempts.push(() => fetchQQPlaylistTracksUcc(disstid, cookieHeader));
    attempts.push(() => fetchQQPlaylistTracksPlaza(disstid, cookieHeader));
    attempts.push(() => fetchQQPlaylistTracksUniform(disstid, cookieHeader, options.hostUin || ''));
  }
  if (dirid && dirid !== '201' && disstid) {
    attempts.push(() => fetchQQDirPlaylistTracks(dirid, cookieHeader));
  }

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && result.songs && result.songs.length) {
        if (result.meta) meta = { ...meta, ...result.meta };
        songs = result.songs;
        break;
      }
    } catch (_) {}
  }

  const outMeta = {
    ...meta,
    id: disstid || dirid,
    trackCount: songs.length,
    provider: 'qq',
  };
  return {
    ...outMeta,
    playlist: outMeta,
    tracks: songs,
    songs,
    provider: 'qq',
  };
}

export async function handleQQLyric(mid, id, cookieHeader) {
  const songMID = String(mid || '').trim();
  const songID = String(id || '').replace(/\D/g, '');
  if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' };
  let lyricText = '';
  let transText = '';
  try {
    const param = {};
    if (songMID) param.songMID = songMID;
    if (songID) param.songID = Number(songID);
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param,
      },
    }, cookieHeader);
    const data = json && json.lyric && json.lyric.data;
    lyricText = decodeQQLyricText(data && data.lyric);
    transText = decodeQQLyricText(data && data.trans);
  } catch (_) {}
  if (!lyricText && songMID) {
    try {
      const body = await qqGetJSON('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        songmid: songMID,
        songtype: '0',
        format: 'json',
        nobase64: '1',
        g_tk: '5381',
        loginUin: qqCookieUin(cookieHeader) || '0',
        hostUin: '0',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
      }, cookieHeader);
      lyricText = decodeQQLyricText(body && body.lyric);
      transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText;
    } catch (_) {}
  }
  return {
    provider: 'qq',
    id: songID,
    mid: songMID,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    source: lyricText ? 'qq-extension' : 'qq-empty',
  };
}

export { getQQCookie, mapQQTrack, qqSongDetail };
export { qqMusicRequest, qqGetJSON, buildQQAuthComm, qqSongDetailsBatch };

// ---- qq-music-api 3.2.0 / 3.3.0 的新路由：推荐与写入 ----
//
// module / method / param 一字不改照抄上游后端的 services/recommend 与 services/user，
// 差别只在凭据：上游后端是 Android 端会话（comm 里带设备信息），本地桥手里只有网页 /
// 扫码登录拿到的 cookie，所以沿用曲库一直在用的 buildQQAuthComm。推荐歌单实测匿名可读，
// 日推与猜你喜欢要登录 —— 没有会话时上游回 401，本地桥同样报 AUTH_REQUIRED，
// 不让「没登录」伪装成「没有推荐」。
//
// 与上游同一条约定：读不出来就是空结果（上游是 422 / 404，本地桥回空数组），
// 只有「明确说了没改动」才回 changed:false —— 前端据此报错，不会假装成功。

/** QQ 上游表示「不认这个凭据」的业务码。 */
const QQ_LOGIN_REQUIRED_CODE = 1000;

/**
 * musicu 的两层码：整体一个，req_0 里还有一个（外加 subcode）。
 * 任一层非零都不是成功；1000 单独认出来，交给调用方当成「登录失效」而不是空数据。
 */
function qqMusicuRead(json) {
  const gatewayCode = Number(json && json.code);
  if (!json || !Number.isFinite(gatewayCode) || gatewayCode !== 0) {
    return { ok: false, loginRequired: false, code: gatewayCode, data: null, subcode: undefined, msg: json && json.msg };
  }
  const block = json.req_0;
  if (!block || typeof block !== 'object') return { ok: false, loginRequired: false, code: -1, data: null, subcode: undefined, msg: undefined };
  const code = Number(block.code);
  const subcode = block.subcode === undefined ? 0 : Number(block.subcode);
  // subcode / msg 一起带出来：只看 code=1000 分不清「确实没登录」和「模块拒了这次请求」。
  const msg = typeof block.msg === 'string' ? block.msg : undefined;
  if (!Number.isFinite(code) || code !== 0 || (Number.isFinite(subcode) && subcode !== 0)) {
    return { ok: false, loginRequired: code === QQ_LOGIN_REQUIRED_CODE, code, data: null, subcode, msg };
  }
  return { ok: true, loginRequired: false, code: 0, data: block.data, subcode, msg };
}

async function qqMusicuCall(module, method, param, cookieHeader, extraComm, options = {}) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader, extraComm),
    req_0: { module, method, param },
  }, options.cookie || cookieHeader, options.ua);
  return qqMusicuRead(json);
}

const qqAuthRequired = (where) => ({
  __foliaBridgeError: 'AUTH_REQUIRED',
  message: `QQ ${where}: login required`,
});

const qqBridgeFailure = (where, code) => ({
  __foliaBridgeError: 'NETWORK',
  message: `QQ ${where} failed (code ${code})`,
});

/** 加密 / 字符串形态的音乐账号 id：android comm 的 `qq` 用它，不是 QQ 号本身。 */
function qqCookieMusicId(cookieHeader) {
  const obj = parseCookieString(cookieHeader);
  const candidates = [obj.str_musicid, obj.musicid, obj.encryptUin, obj.encrypt_uin];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && value !== '0') return value;
  }
  return '';
}

/** 手机 QQ 扫码通道的 tmeLoginType；微信通道是 1（参考实现的 MOBILE_LOGIN_TYPE / WECHAT_LOGIN_TYPE）。 */
const QQ_MOBILE_LOGIN_TYPE = 6;
/** 带凭证的 musicu 请求用的 UA；参考实现固定发这个，我们以前发的是浏览器 UA。 */
const QQ_MUSICU_UA = 'QQMusic 14090008(android 10)';
const QQ_RADIO_DEVICE_KEY = 'qqRadioDevice';

function qqRandomHex(length) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out.slice(0, length);
}

function qqRandomDigits(length) {
  const bytes = new Uint8Array(length);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += String(byte % 10);
  return out;
}

let qqRadioDeviceCache = null;

/**
 * 电台请求要一套**稳定**的合成设备身份。参考实现的 android comm 一直带
 * OpenUDID / aid / os_ver / phonetype / rom 这些字段，并在首次使用时生成后持久化。
 * 每次随机会让服务端把每次请求都当成新设备 —— 电台是设备维度的推荐服务，这本身就可能是拒绝理由。
 */
async function getQQRadioDevice() {
  if (qqRadioDeviceCache) return qqRadioDeviceCache;
  try {
    const stored = await chrome.storage.local.get([QQ_RADIO_DEVICE_KEY]);
    const candidate = stored && stored[QQ_RADIO_DEVICE_KEY];
    if (candidate && candidate.openUdid && candidate.androidId) {
      qqRadioDeviceCache = candidate;
      return qqRadioDeviceCache;
    }
  } catch (_) {}
  const device = {
    openUdid: qqRandomHex(32),
    androidId: qqRandomHex(16),
    imei: qqRandomDigits(15),
    model: 'MI 6',
    brand: 'Xiaomi',
    osRelease: '10',
    sdk: 29,
    fingerprint: `xiaomi/iarim/sagit:10/eomam.200122.001/${qqRandomDigits(7)}:user/release-keys`,
    procVersion: `Linux 5.4.0-54-generic-${qqRandomHex(8)} (android-build@google.com)`,
  };
  qqRadioDeviceCache = device;
  try { await chrome.storage.local.set({ [QQ_RADIO_DEVICE_KEY]: device }); } catch (_) {}
  return device;
}

/**
 * 电台（私人 FM）与 musicasset 写入模块共用的 android 形态 comm。
 *
 * 参考实现对「带凭证的 musicu 请求」统一用 android 形态（ct=11、cv/v=14090008、chid、
 * tmeAppID、qq=音乐账号 id、authst、tmeLoginType，外加一整套设备身份），而我们的 comm 是
 * 网页形态（ct=19/24、没有 qq、没有设备字段）。电台与收藏写入这类「客户端模块」只认前者 ——
 * 网页 comm 能过的是日推与推荐歌单那种查询接口。
 *
 * 另外两点按参考实现对齐：android comm **不带 uin**（只带 qq），所以这里显式把 uin 置空
 * （JSON 序列化会丢掉 undefined 键）；tmeLoginType 必须补默认值，因为 QQ 扫码登录会把这个
 * cookie 删掉（防止上一条微信会话的 login_type=2 / tmeLoginType=1 串味）。
 */
function buildQQRadioComm(cookieHeader, device, loginTypeOverride) {
  const jar = parseCookieString(cookieHeader);
  const musicId = qqCookieMusicId(cookieHeader);
  const explicit = Number(jar.tmeLoginType);
  const loginType = loginTypeOverride
    ?? (Number.isFinite(explicit) && explicit > 0 ? explicit : QQ_MOBILE_LOGIN_TYPE);
  return {
    ct: 11,
    cv: 14090008,
    v: 14090008,
    chid: '10003505',
    tmeAppID: 'qqmusic',
    QIMEI: device.qimei || '',
    QIMEI36: device.qimei36 || '',
    OpenUDID: device.openUdid,
    udid: device.openUdid,
    OpenUDID2: device.openUdid,
    aid: device.androidId,
    os_ver: device.osRelease,
    phonetype: device.model,
    devicelevel: String(device.sdk),
    newdevicelevel: String(device.sdk),
    rom: device.fingerprint,
    tmeLoginType: loginType,
    uin: undefined,
    // 参考实现的 buildAndroidComm 在拿到 android 会话后会把 uid/sid 一起送出去（见
    // ensureQQAndroidSession）。读接口不带也能过，写入类模块被严格校验，缺了会被业务码拒收。
    ...(device.sessionUid ? { uid: device.sessionUid } : {}),
    ...(device.sessionSid ? { sid: device.sessionSid } : {}),
    ...(musicId ? { qq: musicId } : {}),
  };
}

/**
 * 两个通道标记都试一次。`tmeLoginType` 是从 cookie 罐读的，而 QQ 扫码登录会把这个 cookie 删掉
 * （只写 login_type=1），所以罐里那个值可能是上一条微信会话的残留 —— 带着它就会让服务端把
 * QQ 凭证按微信解析，正是电台回 1000 的形态。这里按「本会话自己的 login_type」优先，
 * 失败再用另一个标记试一次，哪个能出歌就用哪个。
 */
function qqRadioLoginTypes(cookieHeader) {
  const jar = parseCookieString(cookieHeader);
  const channel = Number(jar.login_type);
  const jarType = Number(jar.tmeLoginType);
  const primary = channel === 2 ? 1
    : channel === 1 ? QQ_MOBILE_LOGIN_TYPE
      : (Number.isFinite(jarType) && jarType > 0 ? jarType : QQ_MOBILE_LOGIN_TYPE);
  return {
    channel,
    jarType,
    candidates: primary === QQ_MOBILE_LOGIN_TYPE ? [primary, 1] : [primary, QQ_MOBILE_LOGIN_TYPE],
  };
}

// ---------------------------------------------------------------------------
// QIMEI 设备指纹。
//
// 参考实现的 android comm 一直带 QIMEI / QIMEI36（它的认证流程会先 bootstrap 再拿真值），
// 我们以前发空字符串。现场证据是：凭证、身份核对、关系读取、android 会话（uid/sid）全部到位，
// 写入仍被业务码 500026 拒 —— 剩下没对齐的就是这个设备指纹。
//
// 协议：MD5 签名 + AES-128-CBC 载荷 + RSAES-PKCS1-v1_5 包裹随机密钥。本机已用真实接口验证
// 整条链路（HTTP 200 / code 0 / 拿到 q16 与 q36）。
// ---------------------------------------------------------------------------
const QQ_QIMEI_URL = 'https://api.tencentmusic.com/tme/trpc/proxy';
const QQ_QIMEI_SECRET = 'ZdJqM15EeO2zWc08';
const QQ_QIMEI_APP_KEY = '0AND0HD6FE4HY80F';
const QQ_QIMEI_CHANNEL_ID = '10003505';
const QQ_QIMEI_PACKAGE_ID = 'com.tencent.qqmusic';
const QQ_QIMEI_TTL_MS = 24 * 60 * 60 * 1000;
const QQ_QIMEI_STORAGE_KEY = 'qqQimei';
// 腾讯 bootstrap 公钥的模数（公开常量，不是每设备值；参考实现离线提取后写死）。
const QQ_QIMEI_RSA_N_HEX = 'c4231830a2eb5fc2827170641e79d80fec51bda9a22e4b4ab37d1f205a4ae44d928cda25879f66a3429051663312a12'
  + '7faf8a246bdaaf63918417e90d7c95b5908aa6a2d0f852e4a6770294a548ac1c2fe8f1f252fb826f4ac86ab9a00e7ce4'
  + '7d002a56e7c4b51eb889acc60ca6adbc9f72e81f4d31b1dd7464805264530ab1d';

const qqMd5Hex = (...values) => CryptoJS.MD5(values.join('')).toString();

function qqHexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * RSAES-PKCS1-v1_5（RFC 8017 §7.2.1）。Web Crypto 的 subtle 只提供 RSA-OAEP，加密侧的
 * PKCS1v1.5 填充没有原语，所以照参考实现用 BigInt 模幂自己实现。
 */
function qqRsaPkcs1Encrypt(message) {
  const modulus = BigInt(`0x${QQ_QIMEI_RSA_N_HEX}`);
  const k = QQ_QIMEI_RSA_N_HEX.length / 2;
  if (message.length > k - 11) throw new Error('QQ QIMEI: payload too long for the bootstrap key');
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

  const exponent = 65537n;
  let value = 0n;
  for (const byte of block) value = (value << 8n) | BigInt(byte);
  let result = 1n;
  let base = value % modulus;
  let exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % modulus;
    exp >>= 1n;
    base = (base * base) % modulus;
  }
  return qqHexToBytes(result.toString(16).padStart(k * 2, '0'));
}

/** AES-128-CBC，密钥与 IV 都是同一个 16 字节密钥材料（QIMEI 协议自己的约定）。 */
function qqAesCbcEncrypt(keyBytes, plaintext) {
  const key = CryptoJS.lib.WordArray.create(keyBytes);
  const params = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plaintext), key, {
    iv: key,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return CryptoJS.enc.Base64.stringify(params.ciphertext);
}

function qqBeaconId(now) {
  const month = `${now.toISOString().slice(0, 7)}-01`;
  const first = qqRandomDigits(6);
  const second = qqRandomDigits(9);
  const dated = new Set([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38]);
  const fields = [];
  for (let key = 1; key <= 40; key += 1) {
    if (dated.has(key)) fields.push(`k${key}:${month}${first}.${second}`);
    else if (key === 3) fields.push('k3:0000000000000000');
    else if (key === 4) fields.push(`k4:${qqRandomHex(16).replace(/0/g, '1')}`);
    else fields.push(`k${key}:${Math.floor(Math.random() * 10000)}`);
  }
  return `${fields.join(';')};`;
}

function buildQQQimeiPayload(device, now) {
  const uptime = new Date(now.getTime() - Math.floor(Math.random() * 14401) * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  const reserved = {
    harmony: '0', clone: '0', containe: '',
    oz: 'UhYmelwouA+V2nPWbOvLTgN2/m8jwGB+yUB5v9tysQg=',
    oo: 'Xecjt+9S1+f8Pz2VLSxgpw==', kelong: '0', uptimes: uptime, multiUser: '0',
    bod: device.brand, dv: device.device || 'sagit', firstLevel: '', manufact: device.brand,
    name: device.model, host: 'se.infra', kernel: device.procVersion,
  };
  return {
    androidId: device.androidId, platformId: 1, appKey: QQ_QIMEI_APP_KEY, appVersion: '14.9.0.8',
    beaconIdSrc: qqBeaconId(now), brand: device.brand, channelId: QQ_QIMEI_CHANNEL_ID, cid: '',
    imei: device.imei, imsi: '', mac: '', model: device.model, networkType: 'unknown',
    oaid: '', osVersion: `Android ${device.osRelease},level ${device.sdk}`, qimei: '', qimei36: '',
    sdkVersion: '1.2.13.6', targetSdkVersion: '33', audit: '', userId: '{}',
    packageId: QQ_QIMEI_PACKAGE_ID, deviceType: 'Phone', sdkName: '', reserved: JSON.stringify(reserved),
  };
}

/** 一次 QIMEI bootstrap 往返，返回 { qimei, qimei36 }（取不到就是空串）。 */
async function requestQQQimei(device) {
  const now = new Date();
  const cryptKey = qqRandomHex(16);
  const nonce = qqRandomHex(16);
  const timestamp = Math.floor(now.getTime() / 1000);
  const keyBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) keyBytes[i] = cryptKey.charCodeAt(i);

  const key = CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.create(qqRsaPkcs1Encrypt(keyBytes)));
  const params = qqAesCbcEncrypt(keyBytes, JSON.stringify(buildQQQimeiPayload(device, now)));
  const extra = JSON.stringify({ appKey: QQ_QIMEI_APP_KEY });

  const response = await fetch(QQ_QIMEI_URL, {
    method: 'POST',
    headers: {
      method: 'GetQimei',
      service: 'trpc.tme_datasvr.qimeiproxy.QimeiProxy',
      appid: 'qimei_qq_android',
      sign: qqMd5Hex('qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH', String(timestamp)),
      'user-agent': 'QQMusic',
      timestamp: String(timestamp),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app: 0,
      os: 1,
      qimeiParams: {
        key,
        params,
        time: String(timestamp),
        nonce,
        sign: qqMd5Hex(key, params, String(timestamp * 1000), nonce, QQ_QIMEI_SECRET, extra),
        extra,
      },
    }),
  });
  const outer = await response.json();
  // 服务端的 data 是「JSON 字符串套 JSON 字符串」，所以要解两层。
  const inner = typeof outer?.data === 'string' ? JSON.parse(outer.data) : outer?.data;
  const payload = inner?.data ?? {};
  return {
    qimei: typeof payload.q16 === 'string' ? payload.q16 : '',
    qimei36: typeof payload.q36 === 'string' ? payload.q36 : '',
    outerCode: outer?.code,
    innerCode: inner?.code,
  };
}

/** 取 QIMEI，带 24 小时缓存；失败只是留空，不阻断请求。 */
async function ensureQQQimei(device) {
  if (device.qimei) return { qimei: device.qimei, qimei36: device.qimei36 || '' };
  const fresh = (cached) => cached && cached.qimei
    && Number.isFinite(cached.savedAt)
    && Date.now() - cached.savedAt < QQ_QIMEI_TTL_MS;
  try {
    const stored = await chrome.storage.local.get([QQ_QIMEI_STORAGE_KEY]);
    const cached = stored && stored[QQ_QIMEI_STORAGE_KEY];
    if (fresh(cached)) {
      device.qimei = cached.qimei;
      device.qimei36 = cached.qimei36 || '';
      return { qimei: device.qimei, qimei36: device.qimei36 };
    }
  } catch (_) {}
  try {
    const result = await requestQQQimei(device);
    noteLibraryStep('qq', 'qimei:bootstrap', {
      code: result.outerCode,
      innerCode: result.innerCode,
      q16Length: result.qimei.length,
      q36Length: result.qimei36.length,
    });
    if (!result.qimei) return { qimei: '', qimei36: '' };
    device.qimei = result.qimei;
    device.qimei36 = result.qimei36;
    try {
      await chrome.storage.local.set({
        [QQ_QIMEI_STORAGE_KEY]: { qimei: result.qimei, qimei36: result.qimei36, savedAt: Date.now() },
      });
    } catch (_) {}
    return { qimei: result.qimei, qimei36: result.qimei36 };
  } catch (error) {
    noteLibraryStep('qq', 'qimei:error', { message: String(error && error.message || error) });
    return { qimei: '', qimei36: '' };
  }
}

/**
 * 「客户端模块」的 musicu 调用：android comm + QQMusic UA + 重建后的凭据 cookie。
 *
 * 参考实现给这些模块统一用 createSessionMusicuClient（同一套形态），我们以前只有查询接口
 * 能过、电台与收藏写入都失败。设备身份与 QIMEI 按需生成并持久化，所以这里 await 一次即可。
 */
async function qqAndroidMusicuCall(module, method, param, cookieHeader) {
  const device = await getQQRadioDevice();
  await ensureQQQimei(device);
  const { candidates } = qqRadioLoginTypes(cookieHeader);
  return qqMusicuCall(
    module, method, param, cookieHeader,
    buildQQRadioComm(cookieHeader, device, candidates[0]),
    { ua: QQ_MUSICU_UA, cookie: buildQQRadioCookie(cookieHeader) },
  );
}

const QQ_ANDROID_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
let qqAndroidSessionCache = null;

/**
 * android 会话（uid / sid / vkey）。
 *
 * 参考实现有一整套 `refreshAndroidSession`：调 `music.getSession.session` 的 `GetSession`
 * （**不带凭据**，只带设备），拿回 session.uid / session.sid / vkey 存进设备上下文，之后
 * `buildAndroidComm` 再把 uid / sid 一起送出去。我们以前两个都没有 —— 读接口不在意，但
 * 写入类模块（红心、收藏）被严格校验：现场报告里 song-like 的 identity 与 read 都是 code=0，
 * 只有 write 回 `500026`，正好是「凭证对、设备会话缺」的形态。
 *
 * 只缓存在设备上下文里，报告只记「有没有」与长度，不落 uid/sid 原文。
 */
async function ensureQQAndroidSession(device) {
  const fresh = qqAndroidSessionCache
    && Date.now() - qqAndroidSessionCache.at < QQ_ANDROID_SESSION_TTL_MS;
  if (fresh) {
    device.sessionUid = qqAndroidSessionCache.uid;
    device.sessionSid = qqAndroidSessionCache.sid;
    return true;
  }
  if (device.sessionUid && device.sessionSid && Number.isFinite(device.sessionSavedAt)
    && Date.now() - device.sessionSavedAt < QQ_ANDROID_SESSION_TTL_MS) {
    qqAndroidSessionCache = { uid: device.sessionUid, sid: device.sessionSid, at: device.sessionSavedAt };
    return true;
  }

  // 匿名 comm：不带 authst / qq / tmeLoginType，与参考实现这一路请求一致。
  const { tmeLoginType: _loginType, ...anonymousComm } = buildQQRadioComm('', device, undefined);
  try {
    const result = await qqMusicuCall(
      'music.getSession.session', 'GetSession',
      { uid: device.sessionUid || '', vkey: 0, caller: 0 },
      '',
      anonymousComm,
      { ua: QQ_MUSICU_UA },
    );
    const session = (result.data && result.data.session) || {};
    const uid = String(session.uid || '').trim();
    const sid = String(session.sid || '').trim();
    noteLibraryStep('qq', 'android-session:done', {
      ok: result.ok, code: result.code, hasUid: Boolean(uid), hasSid: Boolean(sid),
      uidLength: uid.length, sidLength: sid.length,
    });
    if (!result.ok || !uid || !sid) return false;
    device.sessionUid = uid;
    device.sessionSid = sid;
    device.sessionVkey = session.vkey;
    device.sessionSavedAt = Date.now();
    qqAndroidSessionCache = { uid, sid, at: device.sessionSavedAt };
    try { await chrome.storage.local.set({ [QQ_RADIO_DEVICE_KEY]: { ...device } }); } catch (_) {}
    return true;
  } catch (error) {
    noteLibraryStep('qq', 'android-session:error', { message: String(error && error.message || error) });
    return false;
  }
}

/**
 * musicasset 写入的**可用形状**（现场实测出来的，见下）。
 *
 * 两个方案各对了一半，只有合起来才过：
 *   - 参考实现的 android comm + 设备身份 + QIMEI + `uid/sid` 会话 + QQMusic UA + 重建后的
 *     凭据 cookie，但**没有 g_tk** → 现场一直回业务码 500026；
 *   - 一个现代可用实现（baoozak/qqmusic-mcp）的 g_tk（放 query 里，QQ 的 CSRF token，
 *     算法只吃 skey/p_skey）+ 网页 comm → 现场回 80105。
 *
 * 2026-10 的现场矩阵自检给出了答案：**android 身份 + g_tk** 的组合 `retCode=0`，并且再读关系
 * 确认 liked 从 false 变成 true（连读两次都是 true）。所以写入统一走这个形状。
 *
 * 每条写入都必须靠再读关系确认 —— 上游自报成功不算数。
 */
async function qqMusicassetWriteCall(module, method, param, cookieHeader) {
  const device = await getQQRadioDevice();
  await ensureQQQimei(device);
  await ensureQQAndroidSession(device);
  const { candidates } = qqRadioLoginTypes(cookieHeader);
  return qqMusicuRead(await qqMusicRequest(
    {
      comm: buildQQRadioComm(cookieHeader, device, candidates[0]),
      req_0: { module, method, param },
    },
    buildQQRadioCookie(cookieHeader),
    QQ_MUSICU_UA,
    { gTk: qqGtk(cookieHeader) },
  ));
}

/**
 * 同一套 g_tk，但配**网页形态**的 comm（ct 24 / cv 0 / uin + 浏览器 UA + 完整 cookie）。
 * 现场它单独用回 80105，不是可用形状；保留为写入的第二候选，不做默认。
 */
async function qqWebCommWriteCall(module, method, param, cookieHeader, uinOverride) {
  const uin = uinOverride || qqCookieUin(cookieHeader);
  const gTk = qqGtk(cookieHeader);
  noteLibraryStep('qq', 'web-comm:write-comm', {
    ct: 24,
    uinPresent: Boolean(uin),
    gTk,
    hasSkey: /(?:^|;\s*)(?:p_skey|skey)=/.test(String(cookieHeader || '')),
    module,
    method,
  });
  const json = await qqMusicRequest(
    { comm: { ct: 24, cv: 0, uin }, req_0: { module, method, param } },
    cookieHeader,
    UA,
    { gTk },
  );
  return qqMusicuRead(json);
}

/**
 * 参考实现对带凭证的 musicu 请求会**重建** Cookie 头，只用四个键，且 uin 是音乐账号 id
 * 的裸值（没有登录时写进去的 `o` 前缀）：
 *   uin=<musicid>; qqmusic_uin=<musicid>; qm_keyst=<key>; qqmusic_key=<key>
 * 我们以前直接发 cookie 罐原串（`uin=o<musicid>` 等），是这个模块少见的差异之一。
 * 拿不到 id 或 key 时退回原串，不把请求打死。
 */
function buildQQRadioCookie(cookieHeader) {
  const jar = parseCookieString(cookieHeader);
  const musicId = qqCookieMusicId(cookieHeader) || qqCookieUin(cookieHeader);
  const key = jar.qm_keyst || jar.qqmusic_key || jar.music_key || '';
  if (!musicId || !key) return cookieHeader;
  return [`uin=${musicId}`, `qqmusic_uin=${musicId}`, `qm_keyst=${key}`, `qqmusic_key=${key}`].join('; ');
}

// 导出给单测：这几个纯函数决定电台请求的线上形状，出过多次问题，需要能被钉住。
export { buildQQRadioComm, buildQQRadioCookie, qqRadioLoginTypes };

/** 私人 FM（猜你喜欢）。上游实测 num 再大也只回 5 首，参数照抄。 */
export async function handleQQGuessYouLike(cookieHeader) {
  const device = await getQQRadioDevice();
  await ensureQQQimei(device);
  const { channel, jarType, candidates } = qqRadioLoginTypes(cookieHeader);
  const cookie = buildQQRadioCookie(cookieHeader);
  let last = null;
  for (const loginType of candidates) {
    const comm = buildQQRadioComm(cookieHeader, device, loginType);
    const result = await qqMusicuCall(
      'music.radioProxy.MbTrackRadioSvr', 'get_radio_track',
      { id: 99, firstplay: 1, num: 15 },
      cookieHeader,
      comm,
      { ua: QQ_MUSICU_UA, cookie },
    );
    // 记下上游码与实际发出去的字段：只看到 __foliaBridgeError 时无法区分
    // 「上游说没登录」和「模块拒了这次请求」。
    noteLibraryStep('qq', 'guess-you-like:result', {
      ok: result.ok,
      code: result.code,
      subcode: result.subcode,
      msg: result.msg,
      loginRequired: result.loginRequired,
      tracks: Array.isArray(result.data && result.data.tracks) ? result.data.tracks.length : 0,
      hasMusicId: Boolean(comm.qq),
      loginType,
      channelLoginType: channel === 2 ? 'wechat' : channel === 1 ? 'qq' : 'none',
      jarTmeLoginType: Number.isFinite(jarType) ? jarType : 'none',
      hasDevice: Boolean(comm.OpenUDID),
    });
    if (result.ok) {
      const tracks = Array.isArray(result.data && result.data.tracks) ? result.data.tracks : [];
      return { code: 0, songs: tracks };
    }
    last = result;
    // 不是「登录失效」就没必要换标记再试。
    if (!result.loginRequired) return { code: 0, songs: [] };
  }
  return {
    ...qqAuthRequired('guess-you-like'),
    message: `QQ guess-you-like: login required (code ${last ? last.code : 'n/a'}, tried loginType ${candidates.join('/')})`,
  };
}

/** 每日 30 首。dirid 202 是上游实测的「日推」目录。 */
export async function handleQQDailySongs(cookieHeader) {
  const result = await qqMusicuCall(
    'music.srfDissInfo.aiDissInfo', 'uniform_get_Dissinfo',
    { dirid: 202, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
    cookieHeader,
  );
  if (!result.ok) return result.loginRequired ? qqAuthRequired('daily-songs') : { code: 0, songs: [] };
  const songs = Array.isArray(result.data && result.data.songlist) ? result.data.songlist : [];
  return { code: 0, songs };
}

/** 推荐歌单一次最多 60 张（上游实测）。 */
const QQ_RECOMMEND_PLAYLISTS_MAX = 60;

/**
 * `/recommend/playlists` 的条目摊平成歌单列表认得的样子（tid / title / picurl / songnum /
 * creator）。没有可用 tid 的条目读不了歌，跳过 —— 与上游同一个判定。
 */
function qqRecommendPlaylistRow(entry) {
  const basic = entry && entry.Playlist && entry.Playlist.basic;
  const tid = Number(basic && basic.tid);
  if (!Number.isSafeInteger(tid) || tid <= 0) return null;
  const cover = basic.cover && typeof basic.cover === 'object' ? basic.cover : {};
  const creator = basic.creator && typeof basic.creator === 'object' ? basic.creator : {};
  const songnum = Number(basic.song_cnt);
  const playCount = Number(basic.play_cnt);
  return {
    tid,
    title: String(basic.title || ''),
    desc: String(basic.desc || ''),
    picurl: String(cover.default_url || cover.big_url || cover.medium_url || cover.small_url || ''),
    ...(Number.isSafeInteger(songnum) && songnum >= 0 ? { songnum } : {}),
    ...(Number.isSafeInteger(playCount) && playCount >= 0 ? { play_cnt: playCount } : {}),
    creator: {
      ...(creator.uin !== undefined ? { uin: creator.uin } : {}),
      ...(creator.encrypt_uin !== undefined ? { encrypt_uin: creator.encrypt_uin } : {}),
      ...(creator.nick !== undefined ? { nick: creator.nick } : {}),
      ...(creator.avatar !== undefined ? { avatar: creator.avatar } : {}),
    },
  };
}

export async function handleQQRecommendPlaylists(limit, cookieHeader) {
  const size = Math.min(
    QQ_RECOMMEND_PLAYLISTS_MAX,
    Math.max(1, Math.floor(Number(limit)) || 25),
  );
  const result = await qqMusicuCall(
    'music.playlist.PlaylistSquare', 'GetRecommendFeed',
    { From: 0, Size: size },
    cookieHeader,
  );
  if (!result.ok) {
    return result.loginRequired ? qqAuthRequired('recommend-playlists') : { code: 0, playlists: [] };
  }
  const list = Array.isArray(result.data && result.data.List) ? result.data.List : [];
  return {
    code: 0,
    playlists: list.map(qqRecommendPlaylistRow).filter(Boolean).slice(0, size),
    more: result.data.HasMore === true,
  };
}

/**
 * 往自建歌单加歌删歌。与上游同一条准入：先按 uin 取回本人目录，只有目录号 1–199、
 * 没有系统类型标记、tid 对得上的歌单才写 —— 「我喜欢」是 201，另有红心接口，不走这里。
 */
export async function handleQQPlaylistTracksWrite(input, cookieHeader) {
  const tid = Number(input && input.tid);
  const op = String((input && input.op) || '');
  const songs = Array.isArray(input && input.songs) ? input.songs : [];
  if (!Number.isSafeInteger(tid) || tid <= 0 || (op !== 'add' && op !== 'del')
    || songs.length === 0 || songs.length > 100) {
    return { __foliaBridgeError: 'UNSUPPORTED', message: 'QQ playlist tracks: bad input' };
  }
  const owner = String(qqCookieMusicId(cookieHeader) || '').trim();
  if (!owner) return qqAuthRequired('playlist-tracks');
  const vSongInfo = songs.map((song) => ({
    songId: Number(song && song.id),
    songType: Number(song && song.type) || 0,
  }));
  if (vSongInfo.some((song) => !Number.isSafeInteger(song.songId) || song.songId <= 0)) {
    return { __foliaBridgeError: 'UNSUPPORTED', message: 'QQ playlist tracks: bad song id' };
  }

  const owned = await qqAndroidMusicuCall(
    'music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin',
    { uin: owner },
    cookieHeader,
  );
  if (!owned.ok) return owned.loginRequired ? qqAuthRequired('playlist-tracks') : { code: 0, changed: false };
  const rows = Array.isArray(owned.data && owned.data.v_playlist) ? owned.data.v_playlist : [];
  const playlist = rows.find((row) => Number(row && row.tid) === tid);
  const dirId = Number(playlist && playlist.dirId);
  // 「加入歌单」以前完全不留痕：写入被拒时只回 changed:false，报告里看不出上游给了什么码。
  // 红心那条路径每一步都有码可查，这条同样要能查 —— 否则拿它做对照实验等于白测。
  if (!playlist || !Number.isSafeInteger(dirId) || dirId < 1 || dirId >= 200) {
    noteLibraryStep('qq', 'playlist-tracks:guard', {
      tid, found: Boolean(playlist), dirId: Number.isSafeInteger(dirId) ? dirId : 0, rows: rows.length,
    });
    return { code: 0, changed: false };
  }
  if (playlist.dirType !== undefined && Number(playlist.dirType) !== 0) {
    noteLibraryStep('qq', 'playlist-tracks:guard', { tid, dirId, dirType: Number(playlist.dirType) });
    return { code: 0, changed: false };
  }

  const write = await qqMusicassetWriteCall(
    'music.musicasset.PlaylistDetailWrite',
    op === 'add' ? 'AddSonglist' : 'DelSonglist',
    { dirId, v_songInfo: vSongInfo },
    cookieHeader,
  );
  if (!write.ok) {
    noteLibraryStep('qq', 'playlist-tracks:write', {
      dirId, op, songs: vSongInfo.length,
      ok: false, code: write.code, subcode: write.subcode, msg: write.msg,
    });
    return write.loginRequired ? qqAuthRequired('playlist-tracks') : { code: 0, changed: false };
  }
  const data = write.data && typeof write.data === 'object' ? write.data : {};
  // 上游的逐首 existed 实测不能说明歌曲原本在不在，所以只看整体：回了同一个目录 / 歌单才算改动，
  // 全零是「删空了」那种成功。前端遇到 changed:false 会报错，不会假装更新成功。
  const changed = (Number(data.dirId) === dirId && Number(data.tid) === tid)
    || (Number(data.dirId) === 0 && (data.tid === 0 || String(data.tid) === '0'));
  noteLibraryStep('qq', 'playlist-tracks:write', {
    dirId, op, songs: vSongInfo.length,
    ok: true, code: write.code, retCode: data.retCode, changed,
  });
  return { code: 0, changed };
}

/** 收藏 / 取消收藏歌单（不是「我喜欢」，那是目录 201）。 */
export async function handleQQPlaylistSubscribe(input, cookieHeader) {
  const tid = Number(input && input.tid);
  const subscribed = (input && input.subscribed) === true || String((input && input.subscribed)) === 'true';
  if (!Number.isSafeInteger(tid) || tid <= 0) {
    return { __foliaBridgeError: 'UNSUPPORTED', message: 'QQ playlist subscribe: bad tid' };
  }
  // uin 用 str_musicid 的裸值：qqCookieUin 是带 `o` 前缀的 o002774749，参考实现从不拿它当 uin。
  const owner = String(qqCookieMusicId(cookieHeader) || '').trim();
  if (!owner) return qqAuthRequired('playlist-subscribe');
  const result = await qqMusicassetWriteCall(
    'music.musicasset.PlaylistFavWrite',
    subscribed ? 'FavPlaylist' : 'CancelFavPlaylist',
    { uin: owner, v_playlistId: [tid] },
    cookieHeader,
  );
  if (!result.ok) {
    return result.loginRequired
      ? qqAuthRequired('playlist-subscribe')
      : qqBridgeFailure('playlist-subscribe', result.code);
  }
  // 上游用 v_failedPlaylistId 报告逐个失败；回了 result 0 但列表非空就是没成功。
  const data = result.data && typeof result.data === 'object' ? result.data : {};
  const failed = Array.isArray(data.v_failedPlaylistId) ? data.v_failedPlaylistId : [];
  noteLibraryStep('qq', 'playlist-subscribe:write', { result: data.result, failed: failed.length });
  if (Number(data.result) !== 0 || failed.length > 0) {
    return qqBridgeFailure('playlist-subscribe', data.result);
  }
  return { code: 0, subscribed };
}

/**
 * 查收藏状态。查不出来回 unknown，前端会报错而不是当成「没收藏」—— 收藏按钮宁可空着，
 * 也不能显示成未收藏然后一点就取消。
 */
export async function handleQQSubscriptionStatus(type, ids, cookieHeader) {
  const requested = String(ids || '').split(',').map((id) => id.trim()).filter(Boolean);
  if (requested.length === 0 || requested.length > 100) return { code: 0, items: [] };
  const owner = String(qqCookieMusicId(cookieHeader) || '').trim();
  if (!owner) return qqAuthRequired('subscription-status');

  // 三类各有自己的参数形态（上游 STATUS_PROTOCOLS）：歌单只送 v_tid、专辑要 uin 的数字形态、
  // 单曲只送 v_songMid。以前歌单和专辑都塞了带 `o` 前缀的 uin。
  const statusUin = /^\d{1,19}$/.test(owner) && BigInt(owner) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(owner)
    : owner;
  const protocol = type === 'playlist'
    ? {
      module: 'music.musicasset.PlaylistFavRead',
      method: 'IsPlaylistFan',
      param: { v_tid: requested.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0) },
    }
    : {
      module: 'music.musicasset.AlbumFavRead',
      method: 'IsAlbumFan',
      param: { uin: statusUin, v_albumMid: requested },
    };
  if (protocol.param.v_tid && protocol.param.v_tid.length === 0) return { code: 0, items: [] };

  const result = await qqAndroidMusicuCall(protocol.module, protocol.method, protocol.param, cookieHeader);
  if (!result.ok) {
    return result.loginRequired ? qqAuthRequired('subscription-status') : { code: 0, items: [] };
  }
  const fan = result.data && result.data.m_fan && typeof result.data.m_fan === 'object'
    ? result.data.m_fan
    : {};
  return {
    code: 0,
    items: requested.map((id) => ({
      id,
      status: fan[id] === true ? 'subscribed' : fan[id] === false ? 'not-subscribed' : 'unknown',
    })),
  };
}

/**
 * 红心 / 取消红心（上游 qq-music-api 3.3.1 的 user_song_like）。
 * 后端要数字 id 与 songmid 一起核对；只有回包的 liked 对上目标值才算成功，结果不明就报错，
 * 不假装写入成功（写入可能已经生效，上层据此不会重送）。
 */
export async function handleQQSongLikeWrite(input, cookieHeader) {
  const song = (input && input.song) || {};
  const songId = Number(song.id);
  const songMid = String(song.mid || '').trim();
  const liked = (input && input.liked) === true || String(input && input.liked) === 'true';
  if (!Number.isSafeInteger(songId) || songId <= 0 || !isQQSongMid(songMid)) {
    return { __foliaBridgeError: 'UNSUPPORTED', message: 'QQ song like: bad input' };
  }
  const result = await handleQQSongLike(songId, songMid, liked, cookieHeader);
  if (result && result.error === 'LOGIN_REQUIRED') return qqAuthRequired('song-like');
  if (!result || result.error || result.liked !== liked) {
    return qqBridgeFailure('song-like', result && result.code);
  }
  return { code: 0, liked };
}

/**
 * 收藏 / 取消收藏专辑（上游 qq-music-api 3.3.1 的 user_album_subscribe），按专辑 mid 送。
 *
 * 形状照参考实现：
 *   读关系（AlbumFavRead / IsAlbumFan，uin 用 **number** 形态）→ 已是目标状态直接回
 *   → 写（AlbumFavWrite / FavAlbum|CancelFavAlbum，uin 用 **string** 形态）→ 再读一次确认。
 *
 * 两处以前是错的：一是 uin 取了 `qqCookieUin` 的值，而那是带 `o` 前缀的 `o002774749`；
 * 参考实现用的是 str_musicid 的裸数字（它的注释写了「不从已经失真的 number 回建账号」）。
 * 二是发的是网页 comm —— 这是 musicasset 客户端模块，认的是 android comm。
 */
export async function handleQQAlbumSubscribe(input, cookieHeader) {
  const albumMid = String((input && input.id) || '').trim();
  const subscribed = (input && input.subscribed) === true || String(input && input.subscribed) === 'true';
  if (!/^[A-Za-z0-9]{1,64}$/.test(albumMid)) {
    return { __foliaBridgeError: 'UNSUPPORTED', message: 'QQ album subscribe: bad album mid' };
  }
  const owner = String(qqCookieMusicId(cookieHeader) || '').trim();
  if (!/^\d{1,19}$/.test(owner) || BigInt(owner) === 0n) return qqAuthRequired('album-subscribe');
  // 只在安全范围内转 number，超出就沿用字符串（与参考实现同一判断）。
  const statusUin = BigInt(owner) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(owner) : owner;

  const read = async () => {
    const res = await qqAndroidMusicuCall(
      'music.musicasset.AlbumFavRead', 'IsAlbumFan', { uin: statusUin, v_albumMid: [albumMid] }, cookieHeader,
    );
    const fan = (res.data && res.data.m_fan) || {};
    const value = typeof fan[albumMid] === 'boolean' ? fan[albumMid] : null;
    noteLibraryStep('qq', 'album-subscribe:read', { ok: res.ok, code: res.code, subcode: res.subcode, subscribed: value });
    if (!res.ok) return { ok: false, loginRequired: res.loginRequired, code: res.code };
    if (value === null) return { ok: false, code: -1 };
    return { ok: true, subscribed: value };
  };

  const before = await read();
  if (!before.ok) {
    return before.loginRequired ? qqAuthRequired('album-subscribe') : qqBridgeFailure('album-subscribe', before.code);
  }
  if (before.subscribed === subscribed) return { code: 0, subscribed };

  const write = await qqMusicassetWriteCall(
    'music.musicasset.AlbumFavWrite',
    subscribed ? 'FavAlbum' : 'CancelFavAlbum',
    { uin: owner, v_albumMid: [albumMid] },
    cookieHeader,
  );
  const data = (write.data && typeof write.data === 'object') ? write.data : {};
  const failed = (Array.isArray(data.v_failedAlbumId) && data.v_failedAlbumId.length > 0)
    || (Array.isArray(data.v_failedAlbumMid) && data.v_failedAlbumMid.length > 0);
  noteLibraryStep('qq', 'album-subscribe:write', {
    ok: write.ok, code: write.code, subcode: write.subcode, result: data.result, failed,
  });
  if (write.loginRequired) return qqAuthRequired('album-subscribe');
  if (!write.ok) return qqBridgeFailure('album-subscribe', write.code);
  if (Number(data.result) !== 0 || failed) return qqBridgeFailure('album-subscribe', data.result);

  // 写接口回成功不等于真的生效，再读一次确认（上游同此）。
  const after = await read();
  if (!after.ok || after.subscribed !== subscribed) {
    noteLibraryStep('qq', 'album-subscribe:verify', { ok: after.ok, subscribed: after.subscribed });
    return qqBridgeFailure('album-subscribe', after.code);
  }
  return { code: 0, subscribed };
}

// ── 探索页（0.7.21 新增）────────────────────────────────────────────────
// qqExplore.ts 用的这批路由在 .196 的桥里没有，之前整页报「bridge does not implement」。
// 按 qq-music-api 3.3.3 的 module/method/param（node_modules 里的实现）搬到内置桥：
// 雷达、相似歌曲、新歌速递、新碟上架、排行榜清单/单榜、歌单分类/分类歌单、电台清单/电台曲目。
// 推荐内容一律匿名读；电台清单带登录态时会话 cookie 本来就在。

const qqExploreTrackList = data => (
    Array.isArray(data?.songlist) ? data.songlist
        : Array.isArray(data?.songs) ? data.songs
            : Array.isArray(data?.songInfoList) ? data.songInfoList
                : Array.isArray(data?.track_list) ? data.track_list
                    : []
);

const qqExploreToplistCard = entry => {
    const id = Number(entry?.topId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const period = typeof entry?.period === 'string' && entry.period ? entry.period : undefined;
    return {
        id,
        title: String(entry?.title ?? ''),
        ...(period ? { period } : {}),
        // 封面字段名各版本不同：全空时卡片会是白图。
        cover: String(entry?.headPicUrl ?? entry?.frontPicUrl ?? entry?.musichallPicUrl ?? entry?.picUrl ?? entry?.cover ?? entry?.imgurl ?? ''),
        total: Number(entry?.totalNum) || 0,
        listenNum: Number(entry?.listenNum) || 0,
        intro: typeof entry?.intro === 'string' ? entry.intro : '',
    };
};

/** 刷歌模式（客户端「雷达」）：一页约 10 首，匿名也读。 */
export async function handleQQRecommendRadar(page, cookieHeader) {
    const pageNumber = Math.max(1, Math.min(100, Math.floor(Number(page)) || 1));
    const result = await qqMusicuCall(
        'music.recommend.TrackRelationServer', 'GetRadarSong',
        { Page: pageNumber, ReqType: 0, FavSongs: [], EntranceSongs: [] },
        cookieHeader,
    );
    if (!result.ok) return { code: 0, songs: [], more: false };
    const entries = Array.isArray(result.data?.VecSongs) ? result.data.VecSongs : [];
    // 上游把曲目放在 `Track` 里，但不同版本字段名换过（track / TrackInfo / 平铺）；
    // 只认 `Track.mid` 会在上游换名时把整页刷歌模式缩成 1 首（报告里 songs=1）。
    const songs = entries.map((entry) => {
        const track = entry && (entry.Track || entry.track || entry.TrackInfo || entry.track_info || entry);
        if (!track || typeof track !== 'object') return null;
        const mid = track.mid || track.songmid || track.songMid || track.songMid;
        return typeof mid === 'string' && mid ? { ...track, mid } : null;
    }).filter(Boolean);
    noteLibraryStep('qq', 'radar:decode', { entries: entries.length, songs: songs.length });
    return { code: 0, songs, more: result.data?.HasMore === true };
}

/** 相似歌曲：`songid` 认数字歌曲 id。 */
export async function handleQQSimilarSongs(id, cookieHeader) {
    const result = await qqMusicuCall(
        'music.recommend.TrackRelationServer', 'GetSimilarSongs',
        { songid: Number(id) || 0 },
        cookieHeader,
    );
    if (!result.ok) return { code: 0, songs: [] };
    return { code: 0, songs: Array.isArray(result.data?.songs) ? result.data.songs : [] };
}

/** 电台清单（要登录态）。 */
export async function handleQQRadioList(cookieHeader) {
    const uin = qqCookieMusicId(cookieHeader) || qqCookieUin(cookieHeader) || 0;
    const result = await qqMusicuCall('pf.radiosvr', 'GetRadiolist', { uin: Number(uin) || 0 }, cookieHeader);
    if (!result.ok) return { code: 0, groups: [] };
    const groups = Array.isArray(result.data?.radio_list) ? result.data.radio_list : [];
    return {
        code: 0,
        groups: groups.map(group => ({
            id: String(group?.group_id ?? group?.id ?? ''),
            title: String(group?.group_name ?? group?.title ?? ''),
            radios: (Array.isArray(group?.radios) ? group.radios : []).map(radio => ({
                id: Number(radio?.id ?? radio?.radio_id) || 0,
                title: String(radio?.title ?? radio?.name ?? radio?.radio_name ?? ''),
                picurl: String(radio?.pic_url ?? radio?.picurl ?? ''),
            })).filter(radio => radio.id > 0 && radio.title),
        })).filter(group => group.id && group.title && group.radios.length > 0),
    };
}

/** 一个电台的一批歌（点开电台卡片时读）。 */
export async function handleQQRadioTracks(id, cookieHeader) {
    const result = await qqMusicuCall(
        'pf.radiosvr', 'GetRadiosonglist',
        { id: Number(id) || 0, firstplay: 0, num: 30 },
        cookieHeader,
    );
    if (!result.ok) return { code: 0, songs: [] };
    return { code: 0, songs: qqExploreTrackList(result.data) };
}

/** 新歌速递：type 5 是上游的「最新」。 */
export async function handleQQRecommendNewSongs(area, cookieHeader) {
    const result = await qqMusicuCall(
        'newsong.NewSongServer', 'get_new_song_info',
        { type: Number(area) || 5 },
        cookieHeader,
    );
    if (!result.ok) return { code: 0, songs: [] };
    return { code: 0, songs: qqExploreTrackList(result.data) };
}

/** 新碟上架：地区 1 是华语，暂只取这一区。 */
export async function handleQQRecommendNewAlbums(offset, limit, cookieHeader) {
    const size = Math.max(1, Math.min(40, Math.floor(Number(limit)) || 12));
    const start = Math.max(0, Math.floor(Number(offset)) || 0);
    const result = await qqMusicuCall(
        'newalbum.NewAlbumServer', 'get_new_album_info',
        { area: 1, sin: 0, start, num: size },
        cookieHeader,
    );
    if (!result.ok) return { code: 0, albums: [], more: false };
    const entries = Array.isArray(result.data?.albums) ? result.data.albums : [];
    const albums = entries.map(item => {
        const mid = typeof item?.mid === 'string' ? item.mid : '';
        if (!mid) return null;
        return {
            mid,
            name: String(item?.name ?? ''),
            singers: (Array.isArray(item?.singers) ? item.singers : [])
                .map(singer => ({ mid: String(singer?.mid ?? ''), name: String(singer?.name ?? '') }))
                .filter(singer => singer.mid),
            ...(item?.release_time ? { publishDate: String(item.release_time) } : {}),
            ...(Number.isFinite(Number(item?.ex?.track_nums)) ? { trackCount: Number(item.ex.track_nums) } : {}),
        };
    }).filter(Boolean);
    const total = Number(result.data?.total);
    return {
        code: 0,
        albums,
        more: Number.isFinite(total) ? start + entries.length < total : false,
    };
}

/** 榜单清单（分组，组里是榜卡片）。 */
export async function handleQQRecommendToplists(cookieHeader) {
    const result = await qqMusicuCall('musicToplist.ToplistInfoServer', 'GetAll', {}, cookieHeader);
    if (!result.ok) return { code: 0, groups: [] };
    const groups = Array.isArray(result.data?.group) ? result.data.group : [];
    return {
        code: 0,
        groups: groups.map(group => ({
            toplists: (Array.isArray(group?.toplist) ? group.toplist : [])
                .map(qqExploreToplistCard).filter(Boolean),
        })).filter(group => group.toplists.length > 0),
    };
}

/** 一个榜的一批歌；`period` 传榜单卡片记下的期数，空串是最新一期。 */
export async function handleQQRecommendToplist(id, offset, limit, period, cookieHeader) {
    const size = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 12));
    const start = Math.max(0, Math.floor(Number(offset)) || 0);
    const result = await qqMusicuCall(
        'musicToplist.ToplistInfoServer', 'GetDetail',
        { topid: Number(id) || 0, offset: start, num: size, period: typeof period === 'string' ? period : '' },
        cookieHeader,
    );
    if (!result.ok) return { code: 0, songs: [], more: false };
    const songs = Array.isArray(result.data?.songInfoList) ? result.data.songInfoList : [];
    const total = Number(result.data?.data?.totalNum);
    return {
        code: 0,
        songs,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        more: Number.isFinite(total) && total >= 0 ? start + songs.length < total : false,
    };
}

/** 歌单分类（热门分组）。 */
export async function handleQQRecommendCategories() {
    const result = await qqMusicuCall('music.web_category_svr', 'get_hot_category', {}, '');
    if (!result.ok) return { code: 0, groups: [] };
    const groups = Array.isArray(result.data?.category) ? result.data.category : [];
    return {
        code: 0,
        groups: groups.map(group => ({
            id: Number(group?.group_id) || 0,
            name: String(group?.group_name ?? ''),
            categories: (Array.isArray(group?.items) ? group.items : [])
                .map(item => ({ id: Number(item?.item_id) || 0, name: String(item?.item_name ?? '') }))
                .filter(category => category.id > 0 && category.name),
        })).filter(group => group.id > 0 && group.categories.length > 0),
    };
}

/** 一个分类下的一页歌单。 */
export async function handleQQRecommendCategoryPlaylists(id, page, limit, cookieHeader) {
    const size = Math.max(1, Math.min(40, Math.floor(Number(limit)) || 12));
    const pageNumber = Math.max(1, Math.floor(Number(page)) || 1);
    const result = await qqMusicuCall(
        'music.playlist.PlayListCategory', 'get_category_content',
        { caller: '0', category_id: Number(id) || 0, page: pageNumber - 1, size, use_page: 1 },
        cookieHeader,
    );
    if (!result.ok) return { code: 0, playlists: [], more: false };
    const content = result.data?.content ?? {};
    const entries = Array.isArray(content.v_item) ? content.v_item : [];
    const playlists = entries.map(entry => qqRecommendPlaylistRow(entry)).filter(Boolean);
    const total = Number(content.total_cnt);
    return {
        code: 0,
        playlists,
        more: Number.isFinite(total) && pageNumber * size < total,
    };
}
