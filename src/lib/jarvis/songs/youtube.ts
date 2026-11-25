import "server-only";
import { getSetting, setSetting } from "@/lib/jarvis/sync/store";
import { encrypt, decrypt } from "@/lib/jarvis/v2/crypto";

// Saves liked songs to a playlist on the Novale YouTube channel with the
// official YouTube Data API. Connected once from /jarvis/songs (Google lets
// you pick the channel). Kept apart from JarvisConnection on purpose: the
// listener treats every connection row as a mailbox.
//
// Quota: a playlist insert costs 50 of the default 10,000 daily units, so
// about 190 likes a day.

const SETTING = "songs_youtube";
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
export const PLAYLIST_TITLE = "Novale Likes";

export type YoutubeLink = { refreshToken: string; channelId: string; channelTitle: string; playlistId?: string };

export async function getYoutube(): Promise<YoutubeLink | null> {
  const raw = await getSetting(SETTING).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(decrypt(raw) ?? "null") as YoutubeLink | null;
  } catch {
    return null;
  }
}

export async function saveYoutube(s: YoutubeLink | null): Promise<void> {
  await setSetting(SETTING, s ? encrypt(JSON.stringify(s)) : "");
}

type TokenResponse = { access_token?: string; refresh_token?: string; error?: string; error_description?: string };

export async function exchangeToken(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    ...params,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

async function yt<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${j.error?.message ?? "request failed"}`);
  return j;
}

export async function channelFor(token: string): Promise<{ id: string; title: string }> {
  const j = await yt<{ items?: { id: string; snippet: { title: string } }[] }>(token, "channels?part=snippet&mine=true");
  const c = j.items?.[0];
  if (!c) throw new Error("That Google account has no YouTube channel.");
  return { id: c.id, title: c.snippet.title };
}

async function ensurePlaylist(token: string, s: YoutubeLink): Promise<string> {
  if (s.playlistId) return s.playlistId;
  const mine = await yt<{ items?: { id: string; snippet: { title: string } }[] }>(token, "playlists?part=snippet&mine=true&maxResults=50");
  const found = mine.items?.find((p) => p.snippet.title === PLAYLIST_TITLE);
  const id =
    found?.id ??
    (
      await yt<{ id: string }>(token, "playlists?part=snippet,status", {
        method: "POST",
        body: JSON.stringify({
          snippet: { title: PLAYLIST_TITLE, description: "Songs I liked while listening. Inspiration for Novale. Saved by Jarvis." },
          status: { privacyStatus: "private" },
        }),
      })
    ).id;
  await saveYoutube({ ...s, playlistId: id });
  return id;
}

// "added" | "skipped: <why>" | "error: <why>"; never throws.
export async function addToPlaylist(videoId: string): Promise<string> {
  try {
    const s = await getYoutube();
    if (!s) return "skipped: YouTube channel not connected";
    const tok = await exchangeToken({ grant_type: "refresh_token", refresh_token: s.refreshToken });
    if (!tok.access_token) {
      return `error: ${tok.error === "invalid_grant" ? "reconnect YouTube on /jarvis/songs" : (tok.error ?? "token refresh failed")}`;
    }
    const playlistId = await ensurePlaylist(tok.access_token, s);
    await yt(tok.access_token, "playlistItems?part=snippet", {
      method: "POST",
      body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
    });
    return "added";
  } catch (e) {
    return `error: ${e instanceof Error ? e.message.slice(0, 200) : "failed"}`;
  }
}
