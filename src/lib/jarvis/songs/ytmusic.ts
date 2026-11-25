import "server-only";
import crypto from "node:crypto";
import { getSetting, setSetting } from "@/lib/jarvis/sync/store";
import { encrypt, decrypt } from "@/lib/jarvis/v2/crypto";

// "What is playing on YouTube Music right now?"
//
// iOS never tells one app what another app is playing, and YouTube Music has
// no official API for it. What does work: YouTube Music writes a song to your
// listening history as soon as it starts, so the top of the history is the
// song in your ears. We read it the way the YouTube Music website does, with
// the owner's own signed-in browser cookie (the same approach as the
// open-source ytmusicapi library). The cookie is pasted once on
// /jarvis/songs, stored encrypted, and lasts until you sign out of YouTube
// Music in that browser.

const ORIGIN = "https://music.youtube.com";
const SETTING = "songs_ytmusic_auth";
// Any recent web client version works; YouTube accepts older ones for months.
const CLIENT_VERSION = "1.20251110.01.00";

export type YtAuth = {
  cookie: string;
  authUser?: string; // which signed-in Google account in that browser (0, 1, ...)
  pageId?: string; // brand account id, only if you listen as a brand channel
  savedAt?: string;
};

export type Track = {
  videoId: string;
  title: string;
  artist: string | null;
  album: string | null;
  thumbnail: string | null;
};

export async function getYtAuth(): Promise<YtAuth | null> {
  const raw = await getSetting(SETTING).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(decrypt(raw) ?? "null") as YtAuth | null;
  } catch {
    return null;
  }
}

// Accepts a bare cookie string, a "Cookie: ..." line, or a whole block of
// request headers copied from the browser, and keeps only the cookie.
export function cleanCookie(input: string): string {
  const text = input.replace(/\r/g, "").trim();
  const lines = text.split("\n");
  // Chrome "Copy request headers" puts the name and value on one line;
  // Firefox's raw view does too. Some views put the value on the next line.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^cookie:/i.test(l)) return l.replace(/^cookie:\s*/i, "").trim();
    if (/^cookie$/i.test(l) && lines[i + 1]) return lines[i + 1].trim();
  }
  return text.replace(/^cookie:\s*/i, "").trim();
}

export async function saveYtAuth(auth: YtAuth | null): Promise<void> {
  if (!auth) {
    await setSetting(SETTING, "");
    return;
  }
  await setSetting(SETTING, encrypt(JSON.stringify({ ...auth, savedAt: new Date().toISOString() })));
}

function sapisid(cookie: string): string | null {
  const m = cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/);
  return m ? m[1] : null;
}

function headers(auth: YtAuth): Record<string, string> {
  const sid = sapisid(auth.cookie);
  if (!sid) throw new Error("The cookie has no SAPISID. Copy it again from music.youtube.com while signed in.");
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash("sha1").update(`${ts} ${sid} ${ORIGIN}`).digest("hex");
  const h: Record<string, string> = {
    "content-type": "application/json",
    cookie: auth.cookie,
    authorization: `SAPISIDHASH ${ts}_${hash}`,
    origin: ORIGIN,
    "x-origin": ORIGIN,
    "x-goog-authuser": auth.authUser || "0",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    "x-youtube-client-name": "67",
    "x-youtube-client-version": CLIENT_VERSION,
  };
  if (auth.pageId) h["x-goog-pageid"] = auth.pageId;
  return h;
}

type Run = { text?: string; navigationEndpoint?: { browseEndpoint?: { browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } } }; watchEndpoint?: { videoId?: string } } };
type Item = {
  flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Run[] } } }[];
  playlistItemData?: { videoId?: string };
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: { url: string; width?: number }[] } } };
  overlay?: { musicItemThumbnailOverlayRenderer?: { content?: { musicPlayButtonRenderer?: { playNavigationEndpoint?: { watchEndpoint?: { videoId?: string } } } } } };
};

// Walks the response in document order and collects every song row, so small
// layout changes on YouTube's side do not break it.
function collectItems(node: unknown, out: Item[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectItems(n, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.musicResponsiveListItemRenderer) {
    out.push(obj.musicResponsiveListItemRenderer as Item);
    return;
  }
  for (const v of Object.values(obj)) collectItems(v, out);
}

const runsOf = (it: Item, i: number): Run[] => it.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];

export function parseItem(it: Item): Track | null {
  const titleRuns = runsOf(it, 0);
  const title = titleRuns.map((r) => r.text ?? "").join("").trim();
  const videoId =
    it.playlistItemData?.videoId ||
    titleRuns[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
    it.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!title || !videoId) return null;

  const second = runsOf(it, 1);
  const pageType = (r: Run) => r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const artists = second.filter((r) => pageType(r) === "MUSIC_PAGE_TYPE_ARTIST" || pageType(r) === "MUSIC_PAGE_TYPE_USER_CHANNEL").map((r) => r.text ?? "");
  const artist = artists.length ? artists.join(", ") : (second.map((r) => r.text ?? "").join("").split(" • ")[0] || null);
  const albumRun = [...second, ...runsOf(it, 2)].find((r) => pageType(r) === "MUSIC_PAGE_TYPE_ALBUM");
  const thumbs = it.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
  return {
    videoId,
    title,
    artist: artist?.trim() || null,
    album: albumRun?.text ?? null,
    thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : null,
  };
}

export class YtAuthError extends Error {}

// Most recent plays, newest first. The first one is what is playing now.
export async function recentPlays(limit = 6): Promise<Track[]> {
  const auth = await getYtAuth();
  if (!auth?.cookie) throw new YtAuthError("YouTube Music is not connected. Paste your cookie on abiolaonikoyi.com/jarvis/songs.");
  const res = await fetch(`${ORIGIN}/youtubei/v1/browse?alt=json&prettyPrint=false`, {
    method: "POST",
    headers: headers(auth),
    body: JSON.stringify({
      context: { client: { clientName: "WEB_REMIX", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" }, user: {} },
      browseId: "FEmusic_history",
    }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new YtAuthError("YouTube Music turned the cookie down. Copy a fresh one on /jarvis/songs.");
  if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`);
  const json = (await res.json()) as unknown;
  const items: Item[] = [];
  collectItems(json, items);
  const tracks: Track[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const t = parseItem(it);
    if (t && !seen.has(t.videoId)) {
      seen.add(t.videoId);
      tracks.push(t);
    }
    if (tracks.length >= limit) break;
  }
  if (!tracks.length) {
    // Signed-out responses still come back 200, just without any songs.
    const signedOut = JSON.stringify(json).includes("Sign in");
    throw signedOut
      ? new YtAuthError("YouTube Music treated Jarvis as signed out. Copy a fresh cookie on /jarvis/songs.")
      : new Error("Your YouTube Music history is empty or paused (YouTube, Settings, Privacy, History).");
  }
  return tracks;
}

// ── Links (the fallback that always works) ───────────────────────────────────

export function videoIdFromUrl(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Title and channel for any public video without signing in (oEmbed).
export async function trackFromVideoId(videoId: string): Promise<Track> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("YouTube does not know that link.");
  const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  let title = (j.title ?? "").trim();
  let artist = (j.author_name ?? "").replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim() || null;
  // "Artist - Song (Official Video)" style titles
  const dash = title.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (dash && (!artist || dash[1].toLowerCase().includes(artist.toLowerCase().slice(0, 5)))) {
    artist = dash[1].trim();
    title = dash[2].trim();
  }
  title = title.replace(/\s*[([](official|lyric|audio|video|visualizer)[^)\]]*[)\]]/gi, "").trim();
  return { videoId, title: title || "Unknown song", artist, album: null, thumbnail: j.thumbnail_url ?? null };
}

// ── Search (screenshots and typed titles) ────────────────────────────────────

// ytmusicapi's "songs only" filter for the search endpoint.
const SONGS_FILTER = "EgWKAQIIAWoMEA4QChADEAQQCRAF";

// Songs matching a query, best first. Works signed out; uses the owner's
// cookie when there is one so results match their region.
export async function searchSongs(query: string, limit = 5): Promise<Track[]> {
  const auth = await getYtAuth().catch(() => null);
  let h: Record<string, string>;
  try {
    h = auth?.cookie ? headers(auth) : {};
  } catch {
    h = {};
  }
  if (!h.cookie) {
    h = {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
      "x-youtube-client-name": "67",
      "x-youtube-client-version": CLIENT_VERSION,
    };
  }
  const res = await fetch(`${ORIGIN}/youtubei/v1/search?alt=json&prettyPrint=false`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      context: { client: { clientName: "WEB_REMIX", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" }, user: {} },
      query,
      params: SONGS_FILTER,
    }),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const items: Item[] = [];
  collectItems((await res.json()) as unknown, items);
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const t = parseItem(it);
    if (t && !seen.has(t.videoId)) {
      seen.add(t.videoId);
      out.push(t);
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ── Song facts (length, year, lyrics) ────────────────────────────────────────

export type SongDetails = {
  durationSec: number | null;
  year: string | null;
  album: string | null;
  byline: string | null; // "Wizkid • Made In Lagos • 2020"
  lyrics: string | null; // for analysis only; never shown, stored or reused
  lyricsSource: string | null;
};

function findAll(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key) out.push(v);
    else findAll(v, key, out);
  }
  return out;
}

type Runs = { runs?: { text?: string }[] };
const runsText = (r: Runs | undefined) => (r?.runs ?? []).map((x) => x.text ?? "").join("");

// What YouTube Music shows beside the player: length, album, year and the
// lyrics tab (Musixmatch / LyricFind). Works signed out. Every part is
// optional; a failure returns what was found.
export async function songDetails(videoId: string): Promise<SongDetails> {
  const out: SongDetails = { durationSec: null, year: null, album: null, byline: null, lyrics: null, lyricsSource: null };
  const h = {
    "content-type": "application/json",
    origin: ORIGIN,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    "x-youtube-client-name": "67",
    "x-youtube-client-version": CLIENT_VERSION,
  };
  const context = { client: { clientName: "WEB_REMIX", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" }, user: {} };
  const post = async (ep: string, body: Record<string, unknown>) => {
    const res = await fetch(`${ORIGIN}/youtubei/v1/${ep}?alt=json&prettyPrint=false`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ context, ...body }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`);
    return (await res.json()) as unknown;
  };
  try {
    const next = await post("next", {
      videoId,
      isAudioOnly: true,
      playlistId: `RDAMVM${videoId}`,
      enablePersistentPlaylistPanel: true,
      tunerSettingValue: "AUTOMIX_SETTING_NORMAL",
    });
    const panel = (findAll(next, "playlistPanelVideoRenderer") as { videoId?: string; lengthText?: Runs; longBylineText?: Runs }[]).find(
      (p) => p.videoId === videoId,
    );
    if (panel) {
      const len = runsText(panel.lengthText).match(/^(?:(\d+):)?(\d+):(\d{2})$/);
      if (len) out.durationSec = Number(len[1] ?? 0) * 3600 + Number(len[2]) * 60 + Number(len[3]);
      out.byline = runsText(panel.longBylineText) || null;
      const parts = (out.byline ?? "").split(" • ").map((s) => s.trim());
      out.year = parts.find((p) => /^(19|20)\d{2}$/.test(p)) ?? null;
      if (parts.length >= 3) out.album = parts[1] || null;
    }
    const tabs = findAll(next, "tabRenderer") as { title?: string; endpoint?: { browseEndpoint?: { browseId?: string } } }[];
    const lyricsId = tabs.find((t) => /lyric/i.test(t.title ?? ""))?.endpoint?.browseEndpoint?.browseId;
    if (lyricsId) {
      const page = await post("browse", { browseId: lyricsId });
      const shelf = (findAll(page, "musicDescriptionShelfRenderer") as { description?: Runs; footer?: Runs }[])[0];
      const text = runsText(shelf?.description).trim();
      if (text) {
        out.lyrics = text.slice(0, 12000);
        out.lyricsSource = runsText(shelf?.footer).replace(/^Source:\s*/i, "").trim() || null;
      }
    }
  } catch {
    // Partial facts are still useful.
  }
  return out;
}
