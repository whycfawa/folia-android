"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // electron/appleMusic/companionQueue.cjs
  var require_companionQueue = __commonJS({
    "electron/appleMusic/companionQueue.cjs"(exports, module) {
      "use strict";
      async function controlQueue(mk, operation, params) {
        const idOf = (item) => item?.attributes?.playParams?.catalogId || item?.id || "";
        const currentId = idOf(mk.nowPlayingItem);
        const items = Array.isArray(mk.queue?.items) ? mk.queue.items : [];
        const position = Number.isInteger(mk.queue?.position) ? mk.queue.position : items.findIndex((item) => idOf(item) === currentId);
        if (operation === "prepareNext") {
          if (currentId !== params.catalogId) return { ok: false, error: currentId ? "stale-request" : "not-ready" };
          if (typeof mk.queue?.clearAfterCurrent !== "function" || typeof mk.playLater !== "function") return { ok: false, error: "unsupported" };
          const tail = items.slice(position + 1).map(idOf);
          if (JSON.stringify(tail) !== JSON.stringify(params.nextIds)) {
            const extendsTail = tail.length <= params.nextIds.length && tail.every((id, index) => id === params.nextIds[index]);
            const appendIds = extendsTail ? params.nextIds.slice(tail.length) : params.nextIds;
            if (!extendsTail) await mk.queue.clearAfterCurrent();
            if (appendIds.length) await mk.playLater({ songs: appendIds });
          }
          if (idOf(mk.nowPlayingItem) !== params.catalogId) return { ok: false, error: "stale-request" };
          window.__foliaPreparedQueue = [params.catalogId, ...params.nextIds];
          return { ok: true, data: {} };
        }
        const plan = window.__foliaPreparedQueue;
        const repeated = params.requestKey && window.__foliaLastPlay?.requestKey === params.requestKey && window.__foliaLastPlay.catalogId === params.catalogId;
        if (currentId === params.catalogId && params.startSec === 0 && (repeated || params.adoptCurrent === true)) {
          window.__foliaLastPlay = { requestKey: params.requestKey, catalogId: params.catalogId };
          return { ok: true, data: { reusedQueue: true, isPlaying: mk.isPlaying === true } };
        }
        if (params.startSec === 0 && Array.isArray(plan) && plan[0] !== params.catalogId && plan.includes(params.catalogId)) {
          const index = items.findIndex((item, index2) => index2 >= position && idOf(item) === params.catalogId);
          if (index < 0) return null;
          if (currentId !== params.catalogId) {
            if (typeof mk.changeToMediaAtIndex !== "function") return null;
            try {
              await mk.changeToMediaAtIndex(index);
            } catch {
              if (idOf(mk.nowPlayingItem) !== params.catalogId || mk.isPlaying !== true) {
                window.__foliaPreparedQueue = [params.catalogId];
                console.warn("[AppleMusic] Prepared switch rejected; loading the song normally");
                return null;
              }
            }
          }
          window.__foliaPreparedQueue = plan.slice(plan.indexOf(params.catalogId));
          window.__foliaLastPlay = { requestKey: params.requestKey, catalogId: params.catalogId };
          return { ok: true, data: { reusedQueue: true, isPlaying: mk.isPlaying === true } };
        }
        window.__foliaPreparedQueue = [params.catalogId];
        return null;
      }
      module.exports = { controlQueue };
    }
  });

  // electron/appleMusic/companionFavorites.cjs
  var require_companionFavorites = __commonJS({
    "electron/appleMusic/companionFavorites.cjs"(exports, module) {
      "use strict";
      async function updateFavorite(call, params) {
        try {
          const result = await call("v1/me/favorites", { "ids[songs]": params.catalogId }, {
            fetchOptions: { method: params.liked ? "POST" : "DELETE" }
          });
          const status = Number(result?.status);
          if (!Number.isInteger(status) || status < 200 || status >= 300 || result?.data?.errors?.length || result?.errors?.length) {
            return { ok: false, error: status === 401 ? "auth-required" : "upstream-error", httpStatus: Number.isInteger(status) ? status : null };
          }
          return { ok: true, data: {} };
        } catch {
          return { ok: false, error: "request-failed" };
        }
      }
      module.exports = { updateFavorite };
    }
  });

  // electron/appleMusic/companionPlaylist.cjs
  var require_companionPlaylist = __commonJS({
    "electron/appleMusic/companionPlaylist.cjs"(exports, module) {
      "use strict";
      async function addPlaylistTracks(call, params) {
        const failure = (result) => {
          const status = Number(result?.status);
          return { ok: false, error: status === 401 ? "auth-required" : "upstream-error", httpStatus: Number.isInteger(status) ? status : null };
        };
        const succeeded = (result) => Number.isInteger(result?.status) && result.status >= 200 && result.status < 300 && !result?.data?.errors?.length && !result?.errors?.length;
        try {
          const path = "v1/me/library/playlists/" + encodeURIComponent(params.playlistId);
          const detail = await call(path, { extend: "tags" });
          if (!succeeded(detail)) return failure(detail);
          const playlist = detail?.data?.data?.find((item) => item.id === params.playlistId && item.type === "library-playlists");
          if (!playlist) return { ok: false, error: "invalid-response" };
          if (playlist.attributes?.canEdit !== true || playlist.attributes?.tags?.includes("favorited")) {
            return { ok: false, error: "unsupported" };
          }
          const result = await call(path + "/tracks", { representation: "resources" }, {
            fetchOptions: { method: "POST", body: JSON.stringify({ data: params.catalogIds.map((id) => ({ id, type: "songs" })) }) }
          });
          if (!succeeded(result)) return failure(result);
          return { ok: true, data: {} };
        } catch {
          return { ok: false, error: "request-failed" };
        }
      }
      module.exports = { addPlaylistTracks };
    }
  });

  // electron/appleMusic/companionRadio.cjs
  var require_companionRadio = __commonJS({
    "electron/appleMusic/companionRadio.cjs"(exports, module) {
      "use strict";
      async function readPersonalStation(call, store) {
        const stations = await call("v1/catalog/" + encodeURIComponent(store) + "/stations", { "filter[identity]": "personal", limit: 1 });
        if (Number(stations?.status) >= 400 || stations?.data?.errors?.length) return stations;
        const rows = stations?.data?.data;
        if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.type !== "stations" || typeof rows[0]?.id !== "string" || !/^ra\.[a-zA-Z0-9._-]{1,196}$/.test(rows[0].id)) {
          return { status: 502, data: { errors: [{}] } };
        }
        return call("v1/me/stations/next-tracks/" + encodeURIComponent(rows[0].id), { limit: 2 }, { fetchOptions: { method: "POST" } });
      }
      module.exports = { readPersonalStation };
    }
  });

  // electron/appleMusic/companionRequests.cjs
  var require_companionRequests = __commonJS({
    "electron/appleMusic/companionRequests.cjs"(exports, module) {
      "use strict";
      var { controlQueue } = require_companionQueue();
      var { updateFavorite } = require_companionFavorites();
      var { addPlaylistTracks } = require_companionPlaylist();
      var { readPersonalStation } = require_companionRadio();
      var REQUEST_ID = /^[a-zA-Z0-9_-]{1,64}$/;
      var RESOURCE_ID = /^[a-zA-Z0-9._-]{1,200}$/;
      var PLAYBACK_COMMANDS = /* @__PURE__ */ new Set(["playStation", "playSong", "pause", "resume", "seek", "setVolume", "prepareNext"]);
      var OPERATIONS = /* @__PURE__ */ new Set(["songOriginal", "catalogSong", "catalogAlbum", "catalogAlbumTracks", "catalogArtist", "catalogArtistSongs", "catalogArtistAlbums", "libraryAlbums", "libraryAlbumTracks", "stations", "station", "personalFm", "showWindow", "hideWindow", "logout", "accountStatus", "search", "playlists", "playlistTracks", "playlistTrackCount", "lyrics", "playbackStatus", "likeSong", "addPlaylistTracks", ...PLAYBACK_COMMANDS]);
      function validateRequest(message) {
        if (!message || typeof message !== "object" || Array.isArray(message)) return null;
        const { id, operation, params = {} } = message;
        if (typeof id !== "string" || !REQUEST_ID.test(id) || !OPERATIONS.has(operation)) return null;
        if (!params || typeof params !== "object" || Array.isArray(params)) return null;
        if (["showWindow", "hideWindow", "logout", "accountStatus"].includes(operation)) return { id, operation, params: {} };
        if (operation === "stations") return { id, operation, params: { limit: 20, offset: 0 } };
        if (operation === "station" || operation === "playStation") {
          if (typeof params.stationId !== "string" || !/^ra\.[a-zA-Z0-9._-]{1,196}$/.test(params.stationId)) return null;
          return { id, operation, params: { stationId: params.stationId, limit: 1, offset: 0 } };
        }
        if (operation === "personalFm") return { id, operation, params: { limit: 2, offset: 0 } };
        if (operation === "playbackStatus" || ["pause", "resume"].includes(operation)) return { id, operation, params: {} };
        if (operation === "seek") {
          if (typeof params.seconds !== "number" || !Number.isFinite(params.seconds) || params.seconds < 0 || params.seconds > 604800) return null;
          return { id, operation, params: { seconds: params.seconds } };
        }
        if (operation === "setVolume") {
          if (typeof params.volume !== "number" || !Number.isFinite(params.volume) || params.volume < 0 || params.volume > 1) return null;
          return { id, operation, params: { volume: params.volume } };
        }
        if (operation === "addPlaylistTracks") {
          if (typeof params.playlistId !== "string" || !/^p\.[a-zA-Z0-9._-]{1,198}$/.test(params.playlistId) || !Array.isArray(params.catalogIds) || params.catalogIds.length < 1 || params.catalogIds.length > 100 || params.catalogIds.some((id2) => typeof id2 !== "string" || !/^\d{1,40}$/.test(id2))) return null;
          return { id, operation, params: { playlistId: params.playlistId, catalogIds: [...new Set(params.catalogIds)] } };
        }
        if (operation === "likeSong") {
          if (typeof params.catalogId !== "string" || !/^\d{1,40}$/.test(params.catalogId) || typeof params.liked !== "boolean") return null;
          return { id, operation, params: { catalogId: params.catalogId, liked: params.liked } };
        }
        if (operation === "prepareNext") {
          if (typeof params.catalogId !== "string" || !/^\d{1,40}$/.test(params.catalogId) || !Array.isArray(params.nextIds) || params.nextIds.length > 2 || params.nextIds.some((id2) => typeof id2 !== "string" || !/^\d{1,40}$/.test(id2)) || (/* @__PURE__ */ new Set([params.catalogId, ...params.nextIds])).size !== params.nextIds.length + 1) return null;
          return { id, operation, params: { catalogId: params.catalogId, nextIds: params.nextIds.slice() } };
        }
        if (operation === "playSong") {
          const { catalogId, startSec = 0, requestKey, adoptCurrent = false } = params;
          if (typeof catalogId !== "string" || !/^\d{1,40}$/.test(catalogId)) return null;
          if (typeof startSec !== "number" || !Number.isFinite(startSec) || startSec < 0 || startSec > 604800) return null;
          if (requestKey !== void 0 && (typeof requestKey !== "string" || !REQUEST_ID.test(requestKey))) return null;
          if (typeof adoptCurrent !== "boolean") return null;
          return { id, operation, params: {
            catalogId,
            startSec,
            ...requestKey !== void 0 ? { requestKey } : {},
            ...adoptCurrent ? { adoptCurrent } : {}
          } };
        }
        if (operation === "lyrics") {
          if (typeof params.songId !== "string" || !RESOURCE_ID.test(params.songId)) return null;
          return { id, operation, params: { songId: params.songId } };
        }
        const { offset = 0, limit = 25 } = params;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e5 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
        if (operation === "search") {
          if (typeof params.query !== "string" || !params.query.trim() || params.query.length > 200) return null;
          return { id, operation, params: { query: params.query.trim(), offset, limit } };
        }
        if (["songOriginal", "catalogSong", "catalogAlbum", "catalogAlbumTracks", "catalogArtist", "catalogArtistSongs", "catalogArtistAlbums"].includes(operation)) {
          if (typeof params.catalogId !== "string" || !/^\d{1,40}$/.test(params.catalogId)) return null;
          return { id, operation, params: { catalogId: params.catalogId, offset, limit } };
        }
        if (operation === "libraryAlbumTracks") {
          if (typeof params.albumId !== "string" || !/^l\.[a-zA-Z0-9._-]{1,198}$/.test(params.albumId)) return null;
          return { id, operation, params: { albumId: params.albumId, offset, limit } };
        }
        if (operation === "playlistTracks" || operation === "playlistTrackCount") {
          if (typeof params.playlistId !== "string" || !RESOURCE_ID.test(params.playlistId)) return null;
          return { id, operation, params: { playlistId: params.playlistId, offset, limit } };
        }
        return { id, operation, params: { offset, limit } };
      }
      async function readFromPage(request, controlQueue2, updateFavorite2, addPlaylistTracks2, readPersonalStation2) {
        try {
          const mk = window.MusicKit?.getInstance();
          const modern = mk?.api?.v3;
          const legacy = mk?.api;
          const call = typeof modern?.music === "function" ? modern.music.bind(modern) : typeof legacy?.music === "function" ? (path2, query, options2) => options2 ? legacy.music(path2, query, options2.fetchOptions) : legacy.music(path2, query) : null;
          if (!call) return { ok: false, error: "not-ready" };
          if (request.operation === "addPlaylistTracks") return await addPlaylistTracks2(call, request.params);
          if (request.operation === "likeSong") return await updateFavorite2(call, request.params);
          if (request.operation === "prepareNext") return await controlQueue2(mk, request.operation, request.params);
          if (request.operation === "playbackStatus") {
            const pendingStart = window.__foliaStart;
            if (pendingStart?.pending && mk.isPlaying === true) pendingStart.pending = false;
            if (pendingStart?.pending && !pendingStart.cancelled && Date.now() - pendingStart.startedAt >= 6e4) {
              pendingStart.pending = false;
              pendingStart.cancelled = true;
              pendingStart.failed = true;
            }
            if (window.__foliaStart?.failed) return { ok: false, error: "playback-failed", playbackStage: "play" };
            const item = mk.nowPlayingItem;
            const params = item?.attributes?.playParams || {};
            const liveStation = typeof window.__foliaLiveStation === "string" ? window.__foliaLiveStation : "";
            const position = liveStation ? 0 : Number(mk.currentPlaybackTime);
            const duration = Number(item?.attributes?.durationInMillis);
            const state = Number(mk.playbackState);
            const queue = mk.queue;
            const queueLength = Number.isInteger(queue?.length) ? queue.length : Array.isArray(queue?.items) ? queue.items.length : null;
            return { ok: true, data: {
              itemId: liveStation || (typeof item?.id === "string" ? item.id : ""),
              ...liveStation ? { live: true } : {},
              catalogId: liveStation || (typeof params.catalogId === "string" ? params.catalogId : ""),
              isPlaying: mk.isPlaying === true,
              ...window.__foliaStart?.pending && !window.__foliaStart.cancelled ? { starting: true } : {},
              // MusicKit's own state tells "stopped" and "ended" apart from a pause.
              state: Number.isInteger(state) ? state : null,
              queueLength,
              queueKeys: queue ? Object.keys(queue).slice(0, 12) : null,
              positionMs: Number.isFinite(position) && position >= 0 ? Math.round(position * 1e3) : 0,
              durationMs: !liveStation && Number.isFinite(duration) && duration >= 0 ? duration : 0
            } };
          }
          if (request.operation === "playStation") {
            window.__foliaStart = null;
            if (typeof mk.setQueue !== "function" || typeof mk.play !== "function") return { ok: false, error: "unsupported" };
            try {
              if (mk.setQueue !== window.__foliaStationQueueHook) {
                const originalSetQueue = mk.setQueue;
                const clearStationOnQueueChange = function(...args) {
                  window.__foliaLiveStation = "";
                  return originalSetQueue.apply(this, args);
                };
                mk.setQueue = clearStationOnQueueChange;
                window.__foliaStationQueueHook = clearStationOnQueueChange;
              }
              await mk.setQueue({ station: request.params.stationId, startPlaying: false });
              window.__foliaLiveStation = request.params.stationId;
              window.__foliaPreparedQueue = [];
              await mk.play();
              return { ok: true, data: {} };
            } catch {
              return { ok: false, error: "playback-failed" };
            }
          }
          if (request.operation === "setVolume") {
            if (typeof mk.volume !== "number") return { ok: false, error: "unsupported" };
            mk.volume = request.params.volume;
            return { ok: true, data: {} };
          }
          const methods = { pause: "pause", resume: "play", seek: "seekToTime" };
          if (request.operation === "playSong") {
            if (typeof mk.setQueue !== "function" || typeof mk.play !== "function") return { ok: false, error: "unsupported" };
            window.__foliaStart = null;
            let playbackStage = "prepared-queue";
            try {
              const reused = await controlQueue2(mk, request.operation, request.params);
              if (reused) return reused;
              playbackStage = "configure";
              if (typeof mk.setShuffleMode === "function") mk.setShuffleMode(0);
              if (typeof mk.setRepeatMode === "function") mk.setRepeatMode(0);
              playbackStage = "queue";
              console.info("[AppleMusic] Playback stage: queue");
              window.__foliaLiveStation = "";
              await mk.setQueue({ song: request.params.catalogId, startPlaying: false, startTime: request.params.startSec });
              playbackStage = "play";
              console.info("[AppleMusic] Playback stage: play");
              const attempt = { failed: false, cancelled: false, sought: false, pending: true, startedAt: Date.now() };
              window.__foliaStart = attempt;
              Promise.resolve(mk.play()).then(async () => {
                if (window.__foliaStart !== attempt) return;
                if (attempt.cancelled) {
                  await mk.pause();
                  return;
                }
                if (!attempt.sought && request.params.startSec > 0 && typeof mk.seekToTime === "function" && !(Number(mk.currentPlaybackTime) >= request.params.startSec - 1)) await mk.seekToTime(request.params.startSec);
              }).catch(() => {
                if (window.__foliaStart === attempt && !attempt.cancelled) attempt.failed = true;
              }).finally(() => {
                attempt.pending = false;
              });
            } catch {
              console.warn("[AppleMusic] Playback command rejected", { operation: request.operation });
              return { ok: false, error: "playback-failed", playbackStage };
            }
            window.__foliaLastPlay = { requestKey: request.params.requestKey, catalogId: request.params.catalogId };
            return { ok: true, data: {
              state: Number.isInteger(mk.playbackState) ? mk.playbackState : null,
              isPlaying: mk.isPlaying === true,
              itemId: typeof mk.nowPlayingItem?.id === "string" ? mk.nowPlayingItem.id : "",
              queueKeys: mk.queue ? Object.keys(mk.queue).slice(0, 12) : null
            } };
          }
          if (Object.prototype.hasOwnProperty.call(methods, request.operation)) {
            const method = mk[methods[request.operation]];
            if (typeof method !== "function") return { ok: false, error: "unsupported" };
            if (request.operation === "seek" && window.__foliaStart) window.__foliaStart.sought = true;
            if (request.operation === "pause" && window.__foliaStart) window.__foliaStart.cancelled = true;
            if (request.operation === "resume") {
              const previous = window.__foliaStart;
              if (previous?.pending && !previous.cancelled && Date.now() - previous.startedAt < 6e4) return { ok: true, data: {} };
              if (previous) previous.cancelled = true;
              const attempt = { failed: false, cancelled: false, pending: true, startedAt: Date.now() };
              window.__foliaStart = attempt;
              try {
                Promise.resolve(method.call(mk)).then(async () => {
                  if (window.__foliaStart === attempt && attempt.cancelled) await mk.pause();
                }).catch(() => {
                  if (window.__foliaStart === attempt && !attempt.cancelled) attempt.failed = true;
                }).finally(() => {
                  attempt.pending = false;
                });
              } catch {
                attempt.pending = false;
                attempt.failed = true;
                return { ok: false, error: "playback-failed" };
              }
              return { ok: true, data: {} };
            }
            try {
              await method.call(mk, ...request.operation === "seek" ? [request.params.seconds] : []);
            } catch {
              console.warn("[AppleMusic] Playback command rejected", { operation: request.operation });
              return { ok: false, error: "playback-failed" };
            }
            return { ok: true, data: {} };
          }
          let account = window.__foliaStorefront;
          if (!account || request.operation === "accountStatus") {
            account = await call("v1/me/storefront");
            const id = account?.data?.data?.[0]?.id;
            window.__foliaStorefront = typeof id === "string" && /^[a-z]{2}$/.test(id) ? account : null;
          }
          const store = account?.data?.data?.[0]?.id;
          if (typeof store !== "string" || !/^[a-z]{2}$/.test(store)) {
            const status2 = Number(account?.status);
            return { ok: false, error: status2 === 401 || status2 === 403 ? "auth-required" : "storefront-unavailable" };
          }
          if (request.operation === "accountStatus") {
            const profile = await call("v1/me/social-profile");
            const item = profile?.data?.data?.[0];
            let identity = typeof item?.id === "string" && item.id && item.id.length <= 512 ? item.id : "";
            const nickname = typeof item?.attributes?.name === "string" ? item.attributes.name.slice(0, 256) : "";
            if (!identity) {
              const token = typeof mk.musicUserToken === "string" ? mk.musicUserToken : "";
              if (token) identity = "music-user-token:" + token;
            }
            if (!identity) return { ok: false, error: "identity-unavailable" };
            const bytes = new TextEncoder().encode("folia-apple-music:" + identity);
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
            const artwork = item?.attributes?.artwork?.url;
            let avatarUrl = "";
            if (typeof artwork === "string" && artwork.length <= 2048) {
              try {
                const url = new URL(artwork);
                if (url.protocol === "https:" && !url.username && !url.password) avatarUrl = artwork;
              } catch {
              }
            }
            return { ok: true, data: { id, nickname, storefront: store, avatarUrl } };
          }
          const p = request.params;
          if (request.operation === "songOriginal") {
            if (store !== "cn") return { ok: true, data: null };
            const cache = window.__foliaOriginalCache ||= /* @__PURE__ */ new Map();
            if (cache.has(p.catalogId)) return { ok: true, data: await cache.get(p.catalogId) };
            const pending = (async () => {
              const original = await call("v1/catalog/jp/songs/" + encodeURIComponent(p.catalogId), { l: "ja" });
              const status2 = Number(original?.status) || 0;
              if (status2 === 404) return null;
              if (status2 >= 400 || original?.data?.errors?.length) throw new Error("catalog unavailable");
              const a = original?.data?.data?.[0]?.attributes;
              if (!a || typeof a.name !== "string" || typeof a.artistName !== "string") return null;
              return { name: a.name.slice(0, 1024), artistName: a.artistName.slice(0, 1024), albumName: typeof a.albumName === "string" ? a.albumName.slice(0, 1024) : "" };
            })();
            cache.set(p.catalogId, pending);
            try {
              return { ok: true, data: await pending };
            } catch {
              if (cache.get(p.catalogId) === pending) cache.delete(p.catalogId);
              return { ok: false, error: "request-failed" };
            }
          }
          const base = "v1/catalog/" + encodeURIComponent(store);
          let path;
          let options;
          if (request.operation === "stations") {
            path = base + "/stations";
            options = { "filter[featured]": "apple-music-live-radio", limit: p.limit };
          } else if (request.operation === "station") {
            path = base + "/stations/" + encodeURIComponent(p.stationId);
            options = {};
          } else if (request.operation === "search") {
            path = base + "/search";
            options = { term: p.query, types: "songs", limit: p.limit, offset: p.offset };
          } else if (["catalogSong", "catalogAlbum", "catalogAlbumTracks", "catalogArtist", "catalogArtistSongs", "catalogArtistAlbums"].includes(request.operation)) {
            const paths = {
              catalogSong: "/songs/",
              catalogAlbum: "/albums/",
              catalogAlbumTracks: "/albums/",
              catalogArtist: "/artists/",
              catalogArtistSongs: "/artists/",
              catalogArtistAlbums: "/artists/"
            };
            const suffixes = { catalogAlbumTracks: "/tracks", catalogArtistSongs: "/view/top-songs", catalogArtistAlbums: "/albums" };
            path = base + paths[request.operation] + encodeURIComponent(p.catalogId) + (suffixes[request.operation] || "");
            options = ["catalogSong", "catalogAlbum", "catalogArtist"].includes(request.operation) ? {} : { limit: p.limit, offset: p.offset };
          } else if (request.operation === "libraryAlbums") {
            path = "v1/me/library/albums";
            options = { limit: p.limit, offset: p.offset };
          } else if (request.operation === "libraryAlbumTracks") {
            path = "v1/me/library/albums/" + encodeURIComponent(p.albumId) + "/tracks";
            options = { limit: p.limit, offset: p.offset, include: "catalog" };
          } else if (request.operation === "playlists") {
            path = "v1/me/library/playlists";
            options = { limit: p.limit, offset: p.offset, extend: "tags" };
          } else if (request.operation === "playlistTracks" || request.operation === "playlistTrackCount") {
            path = "v1/me/library/playlists/" + encodeURIComponent(p.playlistId) + "/tracks";
            options = request.operation === "playlistTrackCount" ? { limit: 1 } : { limit: p.limit, offset: p.offset };
          } else {
            path = base + "/songs/" + encodeURIComponent(p.songId) + "/syllable-lyrics";
          }
          const result = request.operation === "personalFm" ? await readPersonalStation2(call, store) : await call(path, options);
          const status = Number(result?.status) || 0;
          if (status >= 400 || result?.data?.errors?.length) {
            if (request.operation === "lyrics" && status === 404) return { ok: false, error: "lyrics-unavailable", httpStatus: 404 };
            return { ok: false, error: status === 401 ? "auth-required" : "upstream-error", httpStatus: status || null };
          }
          if (request.operation === "playlistTrackCount") {
            const total = result?.data?.meta?.total;
            return { ok: true, data: { total: Number.isSafeInteger(total) && total >= 0 ? total : null } };
          }
          if (request.operation === "lyrics") {
            const ttml = result?.data?.data?.[0]?.attributes?.ttml;
            if (typeof ttml !== "string") return { ok: false, error: "lyrics-unavailable" };
            if (ttml.length > 2 * 1024 * 1024) return { ok: false, error: "invalid-response" };
            return { ok: true, data: { ttml } };
          }
          const results = result?.data?.results;
          const page = request.operation === "search" ? results && typeof results === "object" && !Array.isArray(results) && results.songs === void 0 ? { data: [] } : results?.songs : result?.data;
          if (!Array.isArray(page?.data) || page.data.length > request.params.limit) return { ok: false, error: "invalid-response" };
          const string = (value) => typeof value === "string" ? value.slice(0, 4096) : "";
          const items = page.data.map((item) => {
            const a = item?.attributes || {};
            const p2 = a.playParams || {};
            return {
              id: string(item?.id),
              type: string(item?.type),
              attributes: {
                playbackAvailable: typeof a.playParams?.id === "string" && a.playParams.id.length > 0,
                ...typeof a.canEdit === "boolean" ? { canEdit: a.canEdit } : {},
                isLive: a.isLive === true,
                isFavoritePlaylist: Array.isArray(a.tags) && a.tags.includes("favorited"),
                name: string(a.name),
                artistName: string(a.artistName),
                albumName: string(a.albumName),
                durationInMillis: Number.isFinite(a.durationInMillis) ? a.durationInMillis : 0,
                trackCount: Number.isSafeInteger(a.trackCount) && a.trackCount >= 0 ? a.trackCount : null,
                artwork: { url: string(a.artwork?.url) },
                isrc: string(a.isrc),
                catalogAlbums: (Array.isArray(item?.relationships?.albums?.data) ? item.relationships.albums.data : []).slice(0, 10).map((x) => ({ id: string(x?.id), name: string(x?.attributes?.name) })),
                catalogArtists: (Array.isArray(item?.relationships?.artists?.data) ? item.relationships.artists.data : []).slice(0, 10).map((x) => ({ id: string(x?.id), name: string(x?.attributes?.name) })),
                playParams: { id: string(p2.id), kind: string(p2.kind), catalogId: string(p2.catalogId || item?.relationships?.catalog?.data?.[0]?.id), isLibrary: p2.isLibrary === true }
              }
            };
          });
          const hasMore = typeof page.next === "string" && page.next.length > 0;
          if (hasMore && items.length === 0) return { ok: false, error: "invalid-response" };
          let nextOffset = request.params.offset + items.length;
          if (hasMore) {
            const next = new URL(page.next, "https://api.music.apple.com");
            const offsetText = next.searchParams.get("offset");
            const suppliedOffset = offsetText && /^\d+$/.test(offsetText) ? Number(offsetText) : NaN;
            if (!Number.isSafeInteger(suppliedOffset) || suppliedOffset < request.params.offset + items.length || suppliedOffset <= request.params.offset || suppliedOffset > 1e5) {
              return { ok: false, error: "invalid-response" };
            }
            nextOffset = suppliedOffset;
          }
          return { ok: true, data: { items, hasMore, nextOffset } };
        } catch {
          return { ok: false, error: "request-failed" };
        }
      }
      function requestExpression(request) {
        return `(${readFromPage.toString()})(${JSON.stringify(request)}, (${controlQueue.toString()}), (${updateFavorite.toString()}), (${addPlaylistTracks.toString()}), (${readPersonalStation.toString()}))`;
      }
      function createRequestDispatcher(getContents, timeoutMs = 2e4, getGeneration = () => 0, recoverPlayback = async () => false) {
        let scope;
        let recovery = null;
        return async (message) => {
          const request = validateRequest(message);
          if (!request) return { ok: false, error: "invalid-request" };
          if (recovery) return { ok: false, error: "not-ready" };
          const contents = getContents();
          if (!contents || contents.isDestroyed()) return { ok: false, error: "not-ready" };
          try {
            const url = new URL(contents.getURL());
            if (url.protocol !== "https:" || url.hostname !== "music.apple.com") return { ok: false, error: "not-ready" };
          } catch {
            return { ok: false, error: "not-ready" };
          }
          const generation = getGeneration();
          if (!scope || scope.contents !== contents || scope.generation !== generation) {
            scope = { contents, generation, running: 0, chain: Promise.resolve(), invalid: false, preparing: false, pausing: false, playRevision: 0 };
          }
          const current = scope;
          if (current.invalid) return { ok: false, error: "not-ready" };
          const urgentPause = request.operation === "pause" && current.preparing && !current.pausing;
          const foreground = request.operation === "playbackStatus" || PLAYBACK_COMMANDS.has(request.operation) && request.operation !== "prepareNext";
          if (current.running >= (foreground ? 4 : 2) && !urgentPause) return { ok: false, error: "busy" };
          current.running++;
          if (request.operation === "playSong" || request.operation === "playStation") current.playRevision++;
          const playRevision = current.playRevision;
          if (urgentPause) current.pausing = true;
          let expired = false;
          const playback = PLAYBACK_COMMANDS.has(request.operation);
          const run = () => {
            if (request.operation === "prepareNext" && current.playRevision !== playRevision) {
              return { ok: false, error: "stale-request" };
            }
            if (expired || current.invalid || getGeneration() !== generation || getContents() !== contents || contents.isDestroyed()) {
              return { ok: false, error: "not-ready" };
            }
            const preparing = request.operation === "prepareNext";
            if (preparing) current.preparing = true;
            return Promise.resolve().then(() => contents.executeJavaScript(requestExpression(request), true)).catch(() => ({ ok: false, error: "request-failed" })).finally(() => {
              if (preparing) current.preparing = false;
            });
          };
          const work = playback && !urgentPause ? current.chain.then(run, run) : Promise.resolve().then(run);
          if (playback && !urgentPause) current.chain = work.then(() => {
          }, () => {
          });
          const settled = work.finally(() => {
            current.running--;
            if (urgentPause) current.pausing = false;
          });
          let timer;
          const result = await Promise.race([
            settled,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), timeoutMs);
            })
          ]);
          clearTimeout(timer);
          if (result.error === "timeout") {
            expired = true;
            if (!current.invalid && getGeneration() === generation && getContents() === contents && !contents.isDestroyed()) {
              current.invalid = true;
              console.warn("[AppleMusic] Page request timed out; replacing its document", { operation: request.operation });
              recovery = Promise.resolve().then(() => {
                if (getGeneration() !== generation || getContents() !== contents || contents.isDestroyed()) return true;
                return recoverPlayback(contents);
              }).then((recovered) => {
                if (recovered === true) recovery = null;
              }).catch((error) => {
                console.warn("[AppleMusic] Playback recovery failed", error);
              });
            }
            return result;
          }
          if (current.invalid || getGeneration() !== generation || getContents() !== contents || contents.isDestroyed()) {
            return { ok: false, error: request.operation === "addPlaylistTracks" ? "request-failed" : "not-ready" };
          }
          return result;
        };
      }
      module.exports = { validateRequest, requestExpression, createRequestDispatcher };
    }
  });

  // dev/appleMusicBridgeEntry.cjs
  var require_appleMusicBridgeEntry = __commonJS({
    "dev/appleMusicBridgeEntry.cjs"() {
      var { validateRequest, requestExpression } = require_companionRequests();
      window.__foliaAppleMusicBuild = function(message) {
        const request = validateRequest(message);
        return request ? requestExpression(request) : null;
      };
    }
  });
  require_appleMusicBridgeEntry();
})();
