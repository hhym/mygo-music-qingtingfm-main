// 蜻蜓FM for MyGo Music.
//
// A channel on 蜻蜓FM is a show, and its programs are the episodes: the app's
// podcast pages show them, and every episode plays through the audio URL the
// channel's program API answers with, fresh each time it's asked for.

const API = "https://webapi.qingting.fm/api/mobile";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const PER_PAGE = 30; // programs a page of programs holds
const PER_SEARCH = 20; // results a page of search holds
const CACHE_SIZE = 600; // tracks kept by id, for like and recent

const t = host.t;

const fail = (code, message) => {
  const e = new Error(message || code);
  e.code = code;
  return e;
};
const load = (key, fallback) => {
  const v = host.storage.get(key);
  return v === undefined || v === null ? fallback : v;
};
const save = (key, value) => host.storage.set(key, value);

// Every request takes a page from webapi.qingting.fm, which answers JSON.
async function get(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Referer: "https://m.qingting.fm/" },
  });
  const text = await res.text();
  if (!res.ok) throw fail("unavailable", `${url.pathname} ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw fail("unavailable", text.slice(0, 120));
  }
}

// Pictures are served from a CDN whose !200 style shrinks them; the base URL
// holds the size the app wants.
const image = (u) => (typeof u === "string" && u ? u.replace(/!\d+$/, "") : undefined);

const plain = (s) =>
  typeof s === "string"
    ? s
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
    : "";

function channelIdOf(scheme) {
  const m = /\/vchannels\/(\d+)/.exec(scheme || "") || /channel_id=(\d+)/.exec(scheme || "");
  return m ? m[1] : "";
}

// A channel as the cards of Home, a category and the charts have it.
function fromCard(c) {
  const id = String((c.link && c.link.content) || channelIdOf(c.urlScheme));
  if (!/^\d+$/.test(id)) return null;
  return {
    id,
    name: c.title || t("Untitled"),
    imageUrl: image(c.imgUrl),
    description: plain(c.desc || c.recWords),
  };
}

// A channel as a search answers it.
function fromHit(c) {
  if (c.type && c.type !== "channel_ondemand") return null;
  return {
    id: String(c.id),
    name: c.title || t("Untitled"),
    imageUrl: image(c.cover),
    description: plain(c.description),
    publisher: c.podcaster,
  };
}

function podcasterOf(channel) {
  const p = channel.podcasters;
  if (Array.isArray(p) && p.length) return p[0].name;
  if (typeof p === "string") {
    const m = /'name':\s*'([^']+)'/.exec(p) || /"name":\s*"([^"]+)"/.exec(p);
    if (m) return m[1];
  }
  return "";
}

// The tracks by their id, so like and recent can keep them without asking again.
function remember(track) {
  if (!track || !track.id) return track;
  const cache = load("tracks", {});
  cache[track.id] = track;
  const ids = Object.keys(cache);
  if (ids.length > CACHE_SIZE) for (const id of ids.slice(0, ids.length - CACHE_SIZE)) delete cache[id];
  save("tracks", cache);
  return track;
}
const cached = (id) => load("tracks", {})[id];

function toTrack(p, channelId, channelName, cover) {
  const programId = p.programId ?? p.id;
  if (!programId) return null;
  const track = {
    id: `${channelId}:${programId}`,
    name: p.title || p.name || t("Untitled"),
    artists: channelName ? [{ id: String(channelId), name: channelName }] : [],
    album: { id: String(channelId), name: channelName || "", imageUrl: image(cover) },
    duration: Number(p.duration || 0) * 1000,
    showId: String(channelId),
    description: plain(p.description),
    url: `https://m.qingting.fm/vchannels/${channelId}/programs/${programId}`,
  };
  return remember(track);
}

function subscribedIds() {
  return load("subscribed", []);
}
const isSubscribed = (id) => subscribedIds().includes(String(id));

async function channelOf(id) {
  const d = await get(`/channels/${id}`);
  const ch = d && d.channel;
  if (!ch) throw fail("unavailable", t("No such channel"));
  return ch;
}

function toShow(ch, id) {
  return {
    id: String(id),
    name: ch.title || t("Untitled"),
    imageUrl: image(ch.cover || ch.img),
    description: plain(ch.description || ch.desc),
    publisher: podcasterOf(ch),
    episodeCount: Number(ch.program_count || ch.programCount || 0),
    subscribed: isSubscribed(id),
  };
}

// From the banner of a category page, and the modules under it.
function sectionsOfCategory(d) {
  const sections = [];
  const banner = d.banner && d.banner.data && d.banner.data.data;
  if (Array.isArray(banner) && banner.length) {
    const shows = banner.map(fromCard).filter(Boolean);
    if (shows.length) sections.push({ title: t("Featured"), shows });
  }
  for (const m of d.recommend || []) {
    const items = (m.data && m.data.data) || [];
    const shows = items.map(fromCard).filter(Boolean);
    if (shows.length) sections.push({ title: (m.data && m.data.title) || t("Recommended"), shows });
  }
  // A few categories list their channels flat instead of in modules.
  const flat = (d.channels || d.data || []).map(fromCard).filter(Boolean);
  if (flat.length) sections.push({ title: t("Channels"), shows: flat });
  return sections;
}

export async function home() {
  const [hp, rank] = await Promise.all([
    get("/homepage/new"),
    get("/rank/hotSaleWeekly").catch(() => ({ rankinglist: [] })),
  ]);

  const sections = [];
  const charts = (rank.rankinglist || []).map(fromCard).filter(Boolean);
  if (charts.length) sections.push({ title: t("Trending"), shows: charts, morePage: "rank" });

  for (const s of hp.sections || []) {
    const shows = (s.data || []).map(fromCard).filter(Boolean);
    if (shows.length) sections.push({ title: s.name, shows });
  }

  const links = (hp.sections || [])
    .map((s) => {
      const id = /\/categories\/(\d+)/.exec(s.urlScheme || "");
      return id ? { title: s.name, page: `category/${id[1]}/${encodeURIComponent(s.name || "")}` } : null;
    })
    .filter(Boolean);
  if (links.length) sections.push({ title: t("Categories"), links });

  return { title: t("蜻蜓FM"), sections };
}

export async function browse({ page }) {
  if (page === "rank") {
    const d = await get("/rank/hotSaleWeekly");
    return {
      title: t("Trending"),
      subtitle: t("What everyone is listening to this week"),
      sections: [{ title: t("Channels"), shows: (d.rankinglist || []).map(fromCard).filter(Boolean) }],
    };
  }

  const category = /^category\/(\d+)(?:\/(.+))?/.exec(page || "");
  if (category) {
    const d = await get(`/categories/new/${category[1]}`);
    const title = category[2] ? decodeURIComponent(category[2]) : t("Category");
    const sections = sectionsOfCategory(d);
    if (!sections.length) throw fail("unavailable", t("This category is empty"));
    return { title, sections };
  }

  throw fail("unavailable", t("No such page"));
}

export async function search({ query, kind, offset }) {
  const trimmed = (query || "").trim();
  if (!trimmed) return { more: false };
  const page = Math.floor((offset || 0) / PER_SEARCH) + 1;
  const d = await get(`/search/keyword/${encodeURIComponent(trimmed)}`, { page });

  switch (kind) {
    case "shows": {
      const hits = ((d.channels && d.channels.data) || []).map(fromHit).filter(Boolean);
      const total = Number((d.channels && d.channels.total) || 0);
      return { shows: hits, more: page * PER_SEARCH < total };
    }
    case "tracks": {
      const hits = [];
      for (const p of (d.programs && d.programs.data) || []) {
        if (!p.parent_id) continue;
        // A search hit names the channel in its description, "来自专辑《…》".
        const album = /来自专辑《([^》]+)》/.exec(p.description || "");
        const track = toTrack(p, p.parent_id, album ? album[1] : "", p.cover);
        if (track) hits.push(track);
      }
      const total = Number((d.programs && d.programs.total) || 0);
      return { tracks: hits, more: page * PER_SEARCH < total };
    }
    default:
      // 蜻蜓FM has no albums, artists or playlists to search.
      return { more: false, [kind]: [] };
  }
}

const suggestCache = new Map();

export async function suggest({ query }) {
  const q = (query || "").trim();
  const d = await get("/search/layer", { keyword: q });
  const hot = (d.hotKeyword || []).filter((w) => w && w.startsWith(q));
  if (hot.length || q.length < 2) return hot.slice(0, 10);

  // Nothing hot starts with what's typed: ask what a search would find.
  const cached = suggestCache.get(q);
  if (cached && Date.now() - cached.at < 300000) return cached.words;
  try {
    const s = await get(`/search/keyword/${encodeURIComponent(q)}`);
    const words = [];
    for (const c of (s.channels && s.channels.data) || []) if (c.title) words.push(c.title);
    for (const p of (s.programs && s.programs.data) || []) if (p.title) words.push(p.title);
    const picked = [...new Set(words)].slice(0, 10);
    suggestCache.set(q, { at: Date.now(), words: picked });
    return picked;
  } catch {
    return hot.slice(0, 10);
  }
}

export async function shows() {
  const shows = load("shows", []);
  return shows.map((s) => ({ ...s, subscribed: true }));
}

export async function show({ id, offset }) {
  const ch = await channelOf(id);
  const page = Math.floor((offset || 0) / PER_PAGE) + 1;
  const d = await get(`/player/channels/${id}/pages/${page}`);
  const episodes = (d.programs || []).map((p) => toTrack(p, id, ch.title, ch.cover)).filter(Boolean);
  const total = Number(d.total || 0);
  return {
    show: toShow(ch, id),
    episodes,
    more: page * PER_PAGE < total,
  };
}

export async function subscribeShow({ id, on }) {
  const ids = new Set(subscribedIds().map(String));
  if (on) {
    if (!ids.has(String(id))) {
      const ch = await channelOf(id);
      save("shows", [...load("shows", []).filter((s) => s.id !== String(id)), toShow(ch, id)]);
      ids.add(String(id));
    }
  } else {
    save("shows", load("shows", []).filter((s) => s.id !== String(id)));
    ids.delete(String(id));
  }
  save("subscribed", [...ids]);
}

function likedIds() {
  return load("liked", []);
}

export function liked({ offset }) {
  const tracks = likedIds()
    .map(cached)
    .filter(Boolean);
  return { tracks: offset > 0 ? [] : tracks, more: false };
}

export function isLiked({ ids }) {
  const liked = new Set(likedIds());
  return Object.fromEntries(ids.map((id) => [id, liked.has(String(id))]));
}

function toggled(key, id, on) {
  const set = new Set(load(key, []).map(String));
  if (on) set.add(String(id));
  else set.delete(String(id));
  save(key, [...set]);
  return set;
}

export function like({ id, on }) {
  toggled("liked", id, on);
}
export const likeEpisode = like;

export function played({ id }) {
  const track = cached(id);
  if (!track) return;
  const recent = load("recent", []).filter((t) => t.id !== id);
  recent.unshift(track);
  save("recent", recent.slice(0, 50));
}

export function recent() {
  return load("recent", []);
}

// 蜻蜓FM serves its audio as HE-AAC (SBR), which the app's AAC decoder can't
// play, so the episode is transcoded to AAC-LC in the plugin's data folder
// first. The slots keep a few episodes ready without ever growing.
const SLOTS = 8;
const slotOf = (id) => {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % SLOTS;
  return h;
};

function transcodeOn() {
  const v = host.setting("transcode");
  return v === undefined || v === null || v === "" ? true : String(v) !== "0";
}

const isWindows = /win/i.test(host.platform || "");
const SEP = isWindows ? "\\" : "/";
const fileFor = (slot) => `${host.dataDir.replace(/[\\/]+$/, "")}${SEP}qingting-${slot}.m4a`;

// The app parses what a stream answers as a URL, so the path becomes a proper
// file URL: backslashes turned around, a drive spelled /C:/, and anything odd
// escaped.
function fileURL(path) {
  let p = String(path).replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) p = "/" + p;
  if (!p.startsWith("/")) p = "/" + p;
  return (
    "file://" +
    p
      .split("/")
      // Each part is escaped, but the colon of a drive stays as it is.
      .map((part) => encodeURIComponent(part).replace(/%3A/gi, ":"))
      .join("/")
  );
}

// A desktop app starts with a PATH that has none of brew or the usual install
// folders, so ffmpeg is looked for by name and then where it's usually put.
const FFMPEG_DIRS = {
  darwin: ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"],
  linux: ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"],
  win32: ["ffmpeg.exe", "C:\\ffmpeg\\bin\\ffmpeg.exe", "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe"],
};

function candidates() {
  const set = host.setting("ffmpegPath");
  const list = [];
  if (set) list.push(String(set));
  if (isWindows) list.push("ffmpeg.exe", "ffmpeg");
  else list.push("ffmpeg");
  for (const p of FFMPEG_DIRS[isWindows ? "win32" : host.platform] || []) list.push(p);
  return [...new Set(list)];
}

// ffmpeg turns HE-AAC into the AAC-LC the app decodes.
async function transcode(url, path) {
  if (typeof host.spawn !== "function") throw new Error("host.spawn is not available");

  let last = "";
  for (const bin of candidates()) {
    let p;
    try {
      p = host.spawn(bin, [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        url,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-movflags",
        "+faststart",
        path,
      ]);
    } catch (e) {
      last = `${bin}: ${e}`;
      continue;
    }
    if (!p) {
      last = `${bin}: spawn refused`;
      continue;
    }
    let code = 0;
    try {
      code = await p.wait();
    } catch (e) {
      last = `${bin}: ${e}`;
      continue;
    }
    let said = "";
    try {
      said = (await p.errorOutput()) || "";
    } catch {}
    // ffmpeg says nothing when all went well, and an exit code of 0 means the
    // file is whole.
    if (code === undefined || code === null || code === 0) {
      if (!said) return;
    }
    last = `${bin}: ${String(said).trim().slice(0, 160) || `exit ${code}`}`;
    console.log(`ffmpeg attempt failed — ${last}`);
  }
  throw new Error(last || "ffmpeg not found");
}

// The audio URL is signed and short-lived, so it's asked for each time the
// episode plays. It answers with a redirect to the file itself.
export async function stream({ id }) {
  const [channelId, programId] = String(id).split(":");
  if (!channelId || !programId) throw fail("unavailable", t("No such episode"));

  const d = await get(`/channels/${channelId}/programs/${programId}`);
  const info = d && d.programInfo;
  if (!info || !info.audioUrl) throw fail("unavailable", t("This episode needs buying first"));

  if (d.channelInfo) {
    remember({
      ...(cached(id) || {}),
      id: String(id),
      name: info.title || t("Untitled"),
      artists: [{ id: String(channelId), name: d.channelInfo.title || "" }],
      album: { id: String(channelId), name: d.channelInfo.title || "", imageUrl: image(d.channelInfo.cover) },
      duration: Number(info.duration || 0) * 1000,
      showId: String(channelId),
      url: `https://m.qingting.fm/vchannels/${channelId}/programs/${programId}`,
    });
  }

  let url = info.audioUrl;
  try {
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA } });
    const loc = res.headers && res.headers.get && res.headers.get("location");
    if (loc) url = loc;
  } catch {
    // The app follows the redirect itself.
  }

  if (transcodeOn()) {
    const slots = load("slots", []);
    let slot = slots.indexOf(String(id));
    if (slot < 0) {
      slot = slots.findIndex((k) => !k);
      if (slot < 0) slot = slotOf(id);
      try {
        await transcode(url, fileFor(slot));
        slots[slot] = String(id);
        save("slots", slots);
        return { url: fileURL(fileFor(slot)), type: "m4a" };
      } catch (e) {
        console.log(`transcode failed: ${e && e.message ? e.message : e}`);
        throw fail(
          "setup",
          `${t("蜻蜓FM 的音频是 HE-AAC，要装好 ffmpeg 并在设置里允许它才能播放")} — ${e && e.message ? e.message : e}`,
        );
      }
    }
    return { url: fileURL(fileFor(slot)), type: "m4a" };
  }

  const type = /\.mp3($|\?)/i.test(url) ? "mp3" : "m4a";
  return { url, type };
}
