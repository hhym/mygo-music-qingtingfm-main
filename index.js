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

// Signing in with the app's QR code leaves an access token, and the mobile
// site sends it back as cookies, which is what the webapi reads.
const USER = "https://user.qtfm.cn";
const session = () => load("session", null);

function headers() {
  const h = { "User-Agent": UA };
  const s = session();
  if (s && s.access_token) {
    h.Cookie = `access_token=${s.access_token}; qingting_id=${s.qingting_id}`;
  }
  return h;
}

// Every request takes a page from webapi.qingting.fm, which answers JSON.
async function get(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { ...headers(), Referer: "https://m.qingting.fm/" },
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
  if (page === "me") return myPage();
  if (page === "history") return historyPage();
  if (page === "radio") return radioPage();

  const region = /^radio\/(\d+)$/.exec(page || "");
  if (region) return regionPage(region[1]);

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
  return Object.fromEntries(ids.map((id) => [String(id), liked.has(String(id))]));
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

// A play is remembered with when it happened: the history page groups by day.
const HISTORY_MAX = 100;

export function played({ id }) {
  const track = cached(id);
  if (!track) return;
  const entry = { ...track, at: Date.now() };
  const recent = load("recent", []).filter((t) => t && t.id !== id);
  recent.unshift(entry);
  save("recent", recent.slice(0, HISTORY_MAX));
}

export function recent() {
  return load("recent", []);
}

// ---- signing in, by scanning a code with the 蜻蜓FM app --------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What the code holds, which the app's scan page answers: the web client
// builds the same URL from the code id, and the picture the service offers
// decodes to it.
const qrText = (codeId) =>
  `https://scan.qtfm.cn/home?title=授权登录&requires_login=true&code_id=${codeId}`;

// The generate call sets qr_skey, a cookie the status call asks for. A plugin
// keeps no cookie jar, so it's read from the answer and sent along.
function skeyOf(res) {
  const many = res.headers && typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = many.length ? many.join("\n") : (res.headers && res.headers.get("set-cookie")) || "";
  const m = /qr_skey=([^;,\s]+)/.exec(raw);
  return m ? m[1] : "";
}

async function qrStatus(codeId, skey) {
  const res = await fetch(
    `${USER}/u2/api/v4/users/qrcode/status_query?code_id=${encodeURIComponent(codeId)}`,
    { headers: { "User-Agent": UA, Cookie: `qr_skey=${skey}` } },
  );
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw fail("signIn", text.slice(0, 120));
  }
}

// The profile is one more call the web client makes; when it doesn't answer,
// the id is a good enough name.
async function profileOf(s) {
  try {
    const res = await fetch(
      `${USER}/u2/api/v4/user/${s.qingting_id}?mode=vital&device_id=MOBILESITE&qingting_id=${s.qingting_id}`,
      { headers: { ...headers(), authuser: s.access_token } },
    );
    const d = await res.json();
    const u = d && (d.data || d.user);
    if (u) return { name: u.username || u.nickname || u.name || "", imageUrl: image(u.avatar) };
  } catch {
    // Not signed in far enough to ask, or the route answered nothing.
  }
  return null;
}

export async function signIn() {
  if (typeof host.signInPrompt !== "function") throw fail("unsupported", t("No QR window"));
  if (session() && session().access_token) return;

  const res = await fetch(`${USER}/u2/api/v4/users/qrcode/generate`, { headers: { "User-Agent": UA } });
  const body = await res.json();
  if (!body || body.errorno !== 0 || !body.data || !body.data.code_id) {
    throw fail("signIn", (body && body.errormsg) || t("Couldn't get a code"));
  }
  const codeId = body.data.code_id;
  const skey = skeyOf(res);
  if (!skey) throw fail("signIn", t("The sign-in service gave no key"));

  host.signInPrompt({ qr: qrText(codeId), text: t("Scan with the 蜻蜓FM app") });

  // The key lasts eight minutes; the window says so and starts again after.
  const deadline = Date.now() + 5 * 60 * 1000;
  let scanning = false;
  while (Date.now() < deadline) {
    await sleep(2000);
    let st;
    try {
      st = await qrStatus(codeId, skey);
    } catch {
      continue; // a hiccup of the network isn't the end of the sign-in
    }
    if (st && st.errorno === 200) break; // expired
    if (!st || st.errorno !== 0 || !st.data) continue;
    const status = st.data.qrcode_status;
    if (status === "scanning" && !scanning) {
      scanning = true;
      host.signInPrompt({ qr: qrText(codeId), text: t("Scanned — confirm it on your phone") });
      continue;
    }
    if (status !== "authorize") continue;

    const data = st.data;
    if (!data.access_token) break;
    const s = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      qingting_id: String(data.qingting_id || ""),
      name: data.nickname || data.username || "",
      expires: Number(data.expires_in || 0) ? Date.now() + Number(data.expires_in) * 1000 : 0,
    };
    const profile = await profileOf(s);
    if (profile) {
      if (profile.name) s.name = profile.name;
      if (profile.imageUrl) s.imageUrl = profile.imageUrl;
    }
    save("session", s);
    return;
  }

  throw fail("signIn", t("The code has expired. Try again."));
}

export function signOut() {
  host.storage.remove("session");
}

export function account() {
  const s = session();
  if (!s || !s.access_token) return null;
  return {
    id: String(s.qingting_id || ""),
    name: s.name || t("蜻蜓FM listener"),
    imageUrl: s.imageUrl,
    page: "me",
  };
}

// The history page: what was played lately, one section per day, newest first.
// The app has no page of its own for a source's plays, so this is a browse page.
const DAY = 86400000;
const startOfDay = (ts) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function dayLabel(at) {
  if (!at) return t("Earlier");
  const day = startOfDay(at);
  const today = startOfDay(Date.now());
  if (day >= today) return t("Today");
  if (day >= today - DAY) return t("Yesterday");
  const d = new Date(day);
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function historyPage() {
  const items = [...load("recent", [])]
    .filter(Boolean)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const sections = [];
  for (const it of items) {
    const title = dayLabel(it.at);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.tracks.push(it);
    else sections.push({ title, tracks: [it] });
  }
  return {
    title: t("History"),
    subtitle: items.length ? `${t("Recently played")} · ${items.length}` : t("Nothing played yet"),
    sections,
  };
}

// ---- live radio, the 广播 the app keeps playing without end -----------------

// A station plays as one endless track: the 64k MP3 the lhttp host serves.
// The path needs no signature, so it's built straight from the channel id.
const LIVE = "https://lhttp-hw.qtfm.cn";
const liveURL = (id) => `${LIVE}/live/${id}/64k.mp3?app_id=web`;

function toStation(c) {
  const id = String((c && (c.id ?? c.content_id)) ?? "");
  if (!/^\d+$/.test(id)) return null;
  return {
    id,
    name: c.name || c.title || t("Untitled"),
    description: plain(c.desc || c.description),
    imageUrl: image(c.cover),
  };
}

// The sidebar's radio page: the ones played most, then every region to browse.
export async function stations() {
  const [hot, net] = await Promise.all([
    get("/radio").catch(() => ({ channels: [] })),
    get("/radiopage/list/407").catch(() => ({ radioList: [] })),
  ]);
  const all = [...((hot && hot.channels) || []), ...((net && net.radioList) || [])]
    .map(toStation)
    .filter(Boolean);
  const seen = new Set();
  return all.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

// What a station gives the player: the stream, under the programme on air.
export async function stationNext({ id }) {
  const cid = String(id || "");
  if (!/^\d+$/.test(cid)) throw fail("unavailable", t("No such station"));

  let name = "";
  let cover = "";
  let title = "";
  try {
    const d = await get(`/radio/channels/${cid}/from/${Math.floor(Date.now() / 1000)}`);
    const ch = d && d.channelInfo;
    const cur = d && d.current;
    if (ch) {
      name = ch.name || "";
      cover = ch.cover || "";
    }
    if (cur) title = cur.title || "";
  } catch {
    // A station that doesn't answer still plays; it just goes unnamed.
  }

  // The live stream is one track that never ends, so the app asks for no more.
  return [
    {
      id: `live:${cid}`,
      name: title || name || t("On air"),
      album: { id: cid, name: name || "", imageUrl: image(cover) },
      duration: 0,
      description: t("Live radio"),
    },
  ];
}

// The regions a station is in, from the radio filters.
async function regions() {
  const d = await get("/radio/filter");
  return ((d && d.regionsRes) || []).filter((r) => r && r.id);
}

async function radioPage() {
  const hot = await get("/radio").catch(() => null);
  const sections = [];
  const list = ((hot && hot.channels) || []).map(toStation).filter(Boolean);
  if (list.length) sections.push({ title: t("Popular stations"), stations: list });

  const rs = await regions();
  if (rs.length) {
    sections.push({
      title: t("By region"),
      links: rs.map((r) => ({ title: r.title, page: `radio/${r.id}` })),
    });
  }

  return { title: t("Radio"), sections };
}

async function regionPage(id) {
  const d = await get(`/radiopage/list/${id}`);
  const list = ((d && d.radioList) || []).map(toStation).filter(Boolean);
  if (!list.length) throw fail("unavailable", t("No stations here"));

  let title = t("Radio");
  try {
    const r = (await regions()).find((x) => String(x.id) === String(id));
    if (r) title = r.title;
  } catch {}

  return { title, sections: [{ title: t("Stations"), stations: list }] };
}

// My Page: who's signed in, the channels kept here, and the episodes liked.
function myPage() {
  const s = session();
  if (!s || !s.access_token) throw fail("signIn", t("Sign in to see your page"));

  const sections = [];
  const shows = load("shows", []).map((x) => ({ ...x, subscribed: true }));
  if (shows.length) sections.push({ title: t("Subscribed"), shows });
  const tracks = load("liked", []).map(cached).filter(Boolean);
  if (tracks.length) sections.push({ title: t("Liked episodes"), tracks });

  return {
    title: s.name || t("My 蜻蜓FM"),
    subtitle: s.qingting_id ? `${t("蜻蜓FM account")} ${s.qingting_id}` : undefined,
    imageUrl: s.imageUrl,
    sections,
  };
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
  const raw = String(id || "");

  // A station's track is a live stream that never ends, already AAC-free MP3.
  if (raw.startsWith("live:")) {
    const cid = raw.slice(5);
    if (!/^\d+$/.test(cid)) throw fail("unavailable", t("No such station"));
    return { url: liveURL(cid), type: "mp3" };
  }

  const [channelId, programId] = raw.split(":");
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
