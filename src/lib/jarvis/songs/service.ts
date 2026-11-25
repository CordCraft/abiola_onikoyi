import "server-only";
import type { JarvisSong, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/jarvis/sync/store";
import { sendPushToAll } from "@/lib/jarvis/push";
import { ensureSongTables } from "@/lib/jarvis/songs/setup";
import { recentPlays, trackFromVideoId, videoIdFromUrl, type Track } from "@/lib/jarvis/songs/ytmusic";
import { addToPlaylist } from "@/lib/jarvis/songs/youtube";
import { writeSongPack, type AcePack, type SongAnalysis, type SunoPack } from "@/lib/jarvis/songs/write";
import { pollAce, submitAce, type Generation } from "@/lib/jarvis/songs/fal";

// The "like this song" flow:
// 1. likeSong(): find the song (YouTube Music history, or a pasted link), save
//    it, and answer at once (the Control Center button waits on this).
// 2. finishLike() in after(): add it to the Novale playlist, write the Suno
//    pack with Claude, push "ready" to the phone.

export const STYLE_NOTES_KEY = "songs_style_notes";
// A writing job older than this was cut off by the platform; let it be retried.
const STALE_MS = 3 * 60_000;

export type SunoStored = SunoPack & { ace: AcePack };

export type SongView = {
  id: string;
  videoId: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  thumbnail: string | null;
  source: string;
  status: string;
  analysis: SongAnalysis | null;
  suno: SunoStored | null;
  direction: string | null;
  playlistStatus: string | null;
  alternatives: Track[];
  generations: Generation[];
  error: string | null;
  link: string | null;
  createdAt: string;
};

export function view(s: JarvisSong): SongView {
  const stale = s.status === "writing" && Date.now() - s.updatedAt.getTime() > STALE_MS;
  return {
    id: s.id,
    videoId: s.videoId,
    title: s.title,
    artist: s.artist,
    album: s.album,
    thumbnail: s.thumbnail,
    source: s.source,
    status: stale ? "error" : s.status,
    analysis: (s.analysis as SongAnalysis | null) ?? null,
    suno: (s.suno as SunoStored | null) ?? null,
    direction: s.direction,
    playlistStatus: s.playlistStatus,
    alternatives: ((s.alternatives as Track[] | null) ?? []).filter((t) => t.videoId !== s.videoId),
    generations: (s.generations as Generation[] | null) ?? [],
    error: stale ? "Writing took too long and was cut off. Tap Rewrite." : s.error,
    link: s.videoId ? `https://music.youtube.com/watch?v=${s.videoId}` : null,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listSongs(limit = 50): Promise<SongView[]> {
  await ensureSongTables();
  const rows = await prisma.jarvisSong.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(view);
}

export async function getSong(id: string): Promise<JarvisSong | null> {
  await ensureSongTables();
  return prisma.jarvisSong.findUnique({ where: { id } });
}

export type LikeInput = { url?: string; videoId?: string; title?: string; artist?: string; source?: string };

// Resolves and saves the song. Fast: no Claude here.
export async function likeSong(input: LikeInput): Promise<{ song: JarvisSong; duplicate: boolean }> {
  await ensureSongTables();
  let track: Track;
  let alternatives: Track[] = [];
  const fromLink = input.url ? videoIdFromUrl(input.url) : input.videoId ?? null;
  if (input.url && !fromLink) throw new Error("That does not look like a YouTube or YouTube Music link.");

  if (fromLink) {
    track = await trackFromVideoId(fromLink);
  } else if (input.title) {
    track = { videoId: "", title: input.title.slice(0, 200), artist: input.artist?.slice(0, 200) ?? null, album: null, thumbnail: null };
  } else {
    const plays = await recentPlays(6);
    track = plays[0];
    alternatives = plays.slice(0, 6);
  }

  // Tapping twice for the same song within 15 minutes is one like.
  if (track.videoId) {
    const recent = await prisma.jarvisSong.findFirst({
      where: { videoId: track.videoId, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
      orderBy: { createdAt: "desc" },
    });
    if (recent) return { song: recent, duplicate: true };
  }

  const song = await prisma.jarvisSong.create({
    data: {
      videoId: track.videoId || null,
      title: track.title,
      artist: track.artist,
      album: track.album,
      thumbnail: track.thumbnail,
      source: input.source ?? (fromLink ? "link" : input.title ? "manual" : "control"),
      status: "writing",
      alternatives: alternatives.length ? (alternatives as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  return { song, duplicate: false };
}

// Writes (or rewrites) the Suno pack. Safe to call from after().
export async function writePack(id: string, opts: { notify?: boolean; direction?: string | null } = {}): Promise<void> {
  const song = await getSong(id);
  if (!song) return;
  const previous = song.suno as SunoStored | null;
  await prisma.jarvisSong.update({
    where: { id },
    data: { status: "writing", error: null, ...(opts.direction !== undefined ? { direction: opts.direction } : {}) },
  });
  try {
    const styleNotes = await getSetting(STYLE_NOTES_KEY).catch(() => null);
    const pack = await writeSongPack({
      title: song.title,
      artist: song.artist,
      album: song.album,
      styleNotes,
      direction: opts.direction ?? song.direction,
      previousTitle: previous?.title ?? null,
    });
    await prisma.jarvisSong.update({
      where: { id },
      data: {
        status: "ready",
        analysis: pack.analysis as unknown as Prisma.InputJsonValue,
        suno: { ...pack.suno, ace: pack.ace } as unknown as Prisma.InputJsonValue,
      },
    });
    if (opts.notify) {
      await sendPushToAll({
        title: `Your version of ${song.title} is ready`,
        body: `"${pack.suno.title}": ${pack.analysis.genre}, ${pack.analysis.bpm ? `${pack.analysis.bpm} bpm, ` : ""}${pack.analysis.mood.slice(0, 2).join(", ")}. Tap to copy it into Suno.`,
        url: `/jarvis/songs/${id}`,
        kind: "other",
        tag: `song-${id}`,
        appRoute: `/songs/${id}`,
      }).catch(() => {});
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "failed";
    await prisma.jarvisSong.update({ where: { id }, data: { status: "error", error: msg } });
    if (opts.notify) {
      await sendPushToAll({
        title: `Saved ${song.title}, but the Suno pack failed`,
        body: `${msg}. Open it in Jarvis and tap Rewrite.`,
        url: `/jarvis/songs/${id}`,
        kind: "other",
        appRoute: `/songs/${id}`,
      }).catch(() => {});
    }
  }
}

// Background half of a like: playlist + Suno pack + push.
export async function finishLike(id: string): Promise<void> {
  const song = await getSong(id);
  if (!song) return;
  if (song.videoId) {
    const playlistStatus = await addToPlaylist(song.videoId);
    await prisma.jarvisSong.update({ where: { id }, data: { playlistStatus } });
  }
  await writePack(id, { notify: true });
}

// "Not this one": swap to another recent play, then rewrite.
export async function swapSong(id: string, videoId: string): Promise<JarvisSong> {
  const song = await getSong(id);
  if (!song) throw new Error("Song not found");
  const alt = ((song.alternatives as Track[] | null) ?? []).find((t) => t.videoId === videoId) ?? (await trackFromVideoId(videoId));
  return prisma.jarvisSong.update({
    where: { id },
    data: {
      videoId: alt.videoId,
      title: alt.title,
      artist: alt.artist,
      album: alt.album,
      thumbnail: alt.thumbnail,
      status: "writing",
      playlistStatus: null,
      error: null,
    },
  });
}

// ── ACE-Step (plan B) ────────────────────────────────────────────────────────

export async function startGeneration(id: string): Promise<JarvisSong> {
  const song = await getSong(id);
  if (!song) throw new Error("Song not found");
  const suno = song.suno as SunoStored | null;
  if (!suno) throw new Error("Write the Suno pack first.");
  const g = await submitAce(suno, suno.ace);
  const gens = [g, ...((song.generations as Generation[] | null) ?? [])].slice(0, 10);
  return prisma.jarvisSong.update({ where: { id }, data: { generations: gens as unknown as Prisma.InputJsonValue } });
}

// Called when the app or page looks at a song: moves running generations on.
export async function refreshGenerations(song: JarvisSong): Promise<JarvisSong> {
  const gens = (song.generations as Generation[] | null) ?? [];
  if (!gens.some((g) => g.status === "queued" || g.status === "running")) return song;
  const next = await Promise.all(gens.map((g) => pollAce(g).catch((e: Error) => ({ ...g, status: "error" as const, error: e.message }))));
  return prisma.jarvisSong.update({ where: { id: song.id }, data: { generations: next as unknown as Prisma.InputJsonValue } });
}
