import "server-only";
import { Prisma, type JarvisSong } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/jarvis/sync/store";
import { sendPushToAll } from "@/lib/jarvis/push";
import { ensureSongTables } from "@/lib/jarvis/songs/setup";
import { recentPlays, searchSongs, songDetails, trackFromVideoId, videoIdFromUrl, type Track } from "@/lib/jarvis/songs/ytmusic";
import { readSongFromImage } from "@/lib/jarvis/songs/vision";
import { addToPlaylist } from "@/lib/jarvis/songs/youtube";
import { analyzeSong, writeSongPack, type AcePack, type SongAnalysis, type SunoPack } from "@/lib/jarvis/songs/write";
import { researchSong, type SongResearch } from "@/lib/jarvis/songs/research";
import { queueListen, type AudioMeasurements } from "@/lib/jarvis/songs/listen";
import { pollAce, submitAce, type Generation } from "@/lib/jarvis/songs/fal";

// The "like this song" flow:
// 1. likeSong(): find the song (YouTube Music history, a link or a
//    screenshot), save it, and answer at once (the Control Center button
//    waits on this).
// 2. finishLike() in after(): add it to the Novale playlist, then three
//    steps, each in its own function invocation so none hits Netlify's
//    time limit (kick() chains them through /api/jarvis-songs/step):
//    research (web facts + YouTube Music length and lyrics), analysis (a
//    producer's blueprint), writing (the Suno pack), then push "ready".

export const STYLE_NOTES_KEY = "songs_style_notes";
// A writing job older than this was cut off by the platform; let it be retried.
const STALE_MS = 3 * 60_000;
// Listening waits for a home computer and the voice service; give it longer.
// The sweep (/api/jarvis-songs/step, every 5 min) moves on after LISTEN_MS.
const LISTEN_MS = 8 * 60_000;
const LISTEN_STALE_MS = 15 * 60_000;

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
  stage: string | null; // while writing: research | listening | analysis | writing
  analysis: SongAnalysis | null;
  research: {
    found: boolean;
    producers: string[];
    sources: { title: string; url: string }[];
    lyricsFound: boolean;
    listenedOn: string | null; // computer that played the song, when it was heard
    heard: { tempo: number | null; key: string | null; sectionPattern: string | null } | null;
    listenError: string | null;
  } | null;
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
  const age = Date.now() - s.updatedAt.getTime();
  const stale = s.status === "writing" && age > (s.stage === "listening" ? LISTEN_STALE_MS : STALE_MS);
  return {
    id: s.id,
    videoId: s.videoId,
    title: s.title,
    artist: s.artist,
    album: s.album,
    thumbnail: s.thumbnail,
    source: s.source,
    status: stale ? "error" : s.status,
    stage: s.status === "writing" && !stale ? s.stage : null,
    analysis: (s.analysis as SongAnalysis | null) ?? null,
    research: s.research
      ? (() => {
          const r = s.research as unknown as SongResearch;
          return {
            found: r.found,
            producers: r.producers ?? [],
            sources: r.sources ?? [],
            lyricsFound: Boolean(r.facts?.lyricsFound),
            listenedOn: r.audio?.ok ? (r.listeningOn ?? null) : null,
            heard: r.audio?.ok ? { tempo: r.audio.tempo ?? null, key: r.audio.key?.key ?? null, sectionPattern: r.audio.sectionPattern ?? null } : null,
            listenError: r.audio && !r.audio.ok ? (r.audio.error ?? "Could not listen") : null,
          };
        })()
      : null,
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

export type LikeInput = {
  url?: string;
  videoId?: string;
  title?: string;
  artist?: string;
  source?: string;
  // Share sheet: a screenshot (base64, no data: prefix) or shared text, which
  // may hold a link ("Check out X on YouTube Music https://...").
  image?: string;
  imageType?: string;
  text?: string;
  search?: boolean; // title came from shared text: look it up on YouTube Music
};

// Normalised words for loose title matching.
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);

// Best YouTube Music match for a title + artist read off a screenshot or typed.
// Prefers a result whose title shares words with what was read.
async function findByName(title: string, artist: string | null): Promise<{ track: Track; alternatives: Track[] }> {
  const hits = await searchSongs(`${title} ${artist ?? ""}`.trim(), 6).catch(() => [] as Track[]);
  const want = new Set(words(title));
  const score = (t: Track) => words(t.title).filter((w) => want.has(w)).length;
  const best = [...hits].sort((a, b) => score(b) - score(a))[0];
  if (best && score(best) > 0) return { track: best, alternatives: hits };
  return { track: { videoId: "", title: title.slice(0, 200), artist: artist?.slice(0, 200) ?? null, album: null, thumbnail: null }, alternatives: hits };
}

// Resolves and saves the song. Fast: no Claude here.
export async function likeSong(input: LikeInput): Promise<{ song: JarvisSong; duplicate: boolean }> {
  await ensureSongTables();
  let track: Track;
  let alternatives: Track[] = [];
  let source = input.source;
  // Shared text: use its link if it has one, otherwise treat it as a search.
  if (input.text && !input.url) {
    const link = input.text.match(/https?:\/\/\S+/)?.[0];
    if (link && videoIdFromUrl(link)) input = { ...input, url: link };
    else if (!input.title) input = { ...input, title: input.text.replace(/https?:\/\/\S+/g, "").trim().slice(0, 200), search: true };
  }
  const fromLink = input.url ? videoIdFromUrl(input.url) : input.videoId ?? null;
  if (input.url && !fromLink) throw new Error("That does not look like a YouTube or YouTube Music link.");

  if (input.image) {
    const seen = await readSongFromImage(input.image, input.imageType ?? "image/jpeg");
    if (!seen.found || !seen.title) throw new Error(seen.note ? `No song in that screenshot: ${seen.note}` : "Could not find a song in that screenshot.");
    ({ track, alternatives } = await findByName(seen.title, seen.artist));
    if (!track.album && seen.album) track = { ...track, album: seen.album };
    source = source ?? "screenshot";
  } else if (fromLink) {
    track = await trackFromVideoId(fromLink);
  } else if (input.title && input.search) {
    ({ track, alternatives } = await findByName(input.title, input.artist ?? null));
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
      source: source ?? (fromLink ? "link" : input.title ? "manual" : "control"),
      status: "writing",
      alternatives: alternatives.length ? (alternatives as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  return { song, duplicate: false };
}

export type Step = "research" | "listening" | "analysis" | "writing";
type StepOpts = { notify?: boolean };

async function fail(id: string, title: string, e: unknown, notify?: boolean) {
  const msg = e instanceof Error ? e.message.slice(0, 300) : "failed";
  await prisma.jarvisSong.update({ where: { id }, data: { status: "error", stage: null, error: msg } });
  if (notify) {
    await sendPushToAll({
      title: `Saved ${title}, but the Suno pack failed`,
      body: `${msg}. Open it in Jarvis and tap Rewrite.`,
      url: `/jarvis/songs/${id}`,
      kind: "other",
      appRoute: `/songs/${id}`,
    }).catch(() => {});
  }
}

// Starts the next step in a fresh invocation (its own time budget). Runs it
// here instead when not on Netlify (local dev) or the hand-off fails.
async function kick(id: string, step: Step, opts: StepOpts): Promise<void> {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const secret = process.env.CRON_SECRET;
  if (base && secret) {
    try {
      const res = await fetch(`${base}/api/jarvis-songs/step`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cron-secret": secret },
        body: JSON.stringify({ id, step, notify: Boolean(opts.notify) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
    } catch {
      // fall through and do it here
    }
  }
  await runStep(id, step, opts);
}

const emptyResearch = (song: JarvisSong, details: Awaited<ReturnType<typeof songDetails>> | null): SongResearch => ({
  found: false,
  genre: null,
  subgenres: [],
  bpm: null,
  key: null,
  timeSignature: null,
  releaseYear: details?.year ?? null,
  producers: [],
  instrumentation: [],
  drums: null,
  bass: null,
  harmony: null,
  vocals: null,
  languages: null,
  arrangement: null,
  soundsLike: [],
  notes: null,
  sources: [],
  facts: {
    durationSec: details?.durationSec ?? null,
    year: details?.year ?? null,
    album: details?.album ?? song.album,
    lyricsFound: Boolean(details?.lyrics),
    lyricsSource: details?.lyricsSource ?? null,
  },
});

// One step of the pipeline. Safe to call from after().
export async function runStep(id: string, step: Step, opts: StepOpts = {}): Promise<void> {
  const song = await getSong(id);
  if (!song) return;
  await prisma.jarvisSong.update({ where: { id }, data: { status: "writing", stage: step, error: null } });
  try {
    if (step === "research") {
      const details = song.videoId ? await songDetails(song.videoId).catch(() => null) : null;
      // The web part is a bonus: on failure the lyrics and length still help.
      const research = await researchSong({ title: song.title, artist: song.artist, album: song.album, details }).catch(() => emptyResearch(song, details));
      await prisma.jarvisSong.update({
        where: { id },
        data: { research: research as unknown as Prisma.InputJsonValue, album: song.album ?? research.facts.album },
      });
      return kick(id, "listening", opts);
    }

    if (step === "listening") {
      // One of the owner's computers plays (downloads) the whole song and the
      // voice service measures it; saveMeasurements() or listenFinished()
      // carries on. No computer free: go on with research and lyrics alone.
      const research = (song.research as unknown as SongResearch | null) ?? null;
      const machine = song.videoId
        ? await queueListen({ id, videoId: song.videoId, title: song.title, artist: song.artist }).catch(() => null)
        : null;
      if (machine && research) {
        await prisma.jarvisSong.update({
          where: { id },
          data: { research: { ...research, listeningOn: machine, audio: null } as unknown as Prisma.InputJsonValue },
        });
        return;
      }
      if (research) {
        const audio: AudioMeasurements = { ok: false, error: song.videoId ? "No computer with the listener was online." : "No YouTube video to listen to." };
        await prisma.jarvisSong.update({ where: { id }, data: { research: { ...research, audio } as unknown as Prisma.InputJsonValue } });
      }
      return kick(id, "analysis", opts);
    }

    if (step === "analysis") {
      // Lyrics are fetched again rather than stored: they are only measured.
      const details = song.videoId ? await songDetails(song.videoId).catch(() => null) : null;
      const analysis = await analyzeSong({
        title: song.title,
        artist: song.artist,
        research: (song.research as unknown as SongResearch | null) ?? null,
        lyrics: details?.lyrics ?? null,
      });
      await prisma.jarvisSong.update({ where: { id }, data: { analysis: analysis as unknown as Prisma.InputJsonValue } });
      return kick(id, "writing", opts);
    }

    const analysis = song.analysis as SongAnalysis | null;
    if (!analysis) return kick(id, "analysis", opts);
    const previous = song.suno as SunoStored | null;
    const styleNotes = await getSetting(STYLE_NOTES_KEY).catch(() => null);
    const pack = await writeSongPack({
      title: song.title,
      artist: song.artist,
      analysis,
      styleNotes,
      direction: song.direction,
      previousTitle: previous?.title ?? null,
    });
    await prisma.jarvisSong.update({
      where: { id },
      data: { status: "ready", stage: null, suno: { ...pack.suno, ace: pack.ace } as unknown as Prisma.InputJsonValue },
    });
    if (opts.notify) {
      await sendPushToAll({
        title: `Your version of ${song.title} is ready`,
        body: `"${pack.suno.title}": ${analysis.genre}, ${analysis.bpm ? `${analysis.bpm} bpm, ` : ""}${(analysis.mood ?? []).slice(0, 2).join(", ")}. Tap to copy it into Suno.`,
        url: `/jarvis/songs/${id}`,
        kind: "other",
        tag: `song-${id}`,
        appRoute: `/songs/${id}`,
      }).catch(() => {});
    }
  } catch (e) {
    await fail(id, song.title, e, opts.notify);
  }
}

// The voice service measured the song: keep it with the research, then
// analyse. Ignored when the song has moved on (timed out, swapped).
export async function saveMeasurements(songId: string, audio: AudioMeasurements): Promise<void> {
  const song = await getSong(songId);
  if (!song || song.status !== "writing" || song.stage !== "listening") return;
  const research = (song.research as unknown as SongResearch | null) ?? null;
  if (!research) return;
  await prisma.jarvisSong.update({ where: { id: songId }, data: { research: { ...research, audio } as unknown as Prisma.InputJsonValue } });
  await kick(songId, "analysis", { notify: true });
}

// A listening job failed on the computer (or could not be forwarded).
export async function listenFinished(jobId: string, error: string): Promise<void> {
  const job = await prisma.jarvisJob.findUnique({ where: { id: jobId } });
  const songId = (job?.payload as { songId?: string } | null)?.songId;
  if (songId) await saveMeasurements(songId, { ok: false, error });
}

// Every few minutes: songs stuck waiting for a computer go on without audio.
export async function sweepSongs(): Promise<number> {
  await ensureSongTables();
  const stuck = await prisma.jarvisSong.findMany({
    where: { status: "writing", stage: "listening", updatedAt: { lt: new Date(Date.now() - LISTEN_MS) } },
    take: 5,
  });
  for (const s of stuck) {
    await prisma.jarvisJob.updateMany({
      where: { kind: "song_listen", status: { in: ["queued", "running"] }, payload: { path: ["songId"], equals: s.id } },
      data: { status: "cancelled", finishedAt: new Date(), error: "Timed out" },
    });
    await saveMeasurements(s.id, { ok: false, error: "The computer did not finish listening in time." });
  }
  return stuck.length;
}

// Rewrite: a new Suno pack from the saved blueprint (one quick step). Songs
// liked before the blueprint existed, or with redo set, are researched again.
export async function writePack(id: string, opts: { notify?: boolean; direction?: string | null; redo?: boolean } = {}): Promise<void> {
  const song = await getSong(id);
  if (!song) return;
  if (opts.direction !== undefined) await prisma.jarvisSong.update({ where: { id }, data: { direction: opts.direction } });
  const hasBlueprint = Boolean((song.analysis as SongAnalysis | null)?.sections?.length);
  await runStep(id, opts.redo || !hasBlueprint ? "research" : "writing", { notify: opts.notify });
}

// Background half of a like: playlist, then research, blueprint, Suno pack, push.
export async function finishLike(id: string): Promise<void> {
  const song = await getSong(id);
  if (!song) return;
  if (song.videoId) {
    const playlistStatus = await addToPlaylist(song.videoId);
    await prisma.jarvisSong.update({ where: { id }, data: { playlistStatus } });
  }
  await runStep(id, "research", { notify: true });
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
      stage: "research",
      playlistStatus: null,
      error: null,
      research: Prisma.DbNull,
      analysis: Prisma.DbNull,
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
