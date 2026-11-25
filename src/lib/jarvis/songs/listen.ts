import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";

// Jarvis Songs "listening": one of the owner's computers (the Jarvis bridge,
// scripts/jarvis-bridge.mjs) downloads the song's audio with yt-dlp and sends
// it up; the site forwards it to the voice service on Railway
// (services/voice/music.py), which measures tempo, key, sections, energy and
// vocal flow and calls back /api/jarvis-songs/listened. YouTube blocks
// servers, so the download happens on a home computer.

export type AudioMeasurements = {
  ok: boolean;
  error?: string;
  machine?: string;
  durationSec?: number;
  tempo?: number;
  tempoAlternative?: number | null;
  key?: { key: string; confidence: number; margin: number; runnerUp: string };
  loudnessDb?: number;
  dynamicRangeDb?: number;
  brightnessHz?: number;
  lowEndShare?: number;
  subBassShare?: number;
  percussiveShare?: number;
  onsetsPerSec?: number;
  energyCurve?: number[];
  sections?: {
    start: number;
    end: number;
    bars: number;
    label: string;
    energy: number;
    loudnessDb: number;
    brightnessHz: number;
    wordsPerSec: number;
    vocalCoverage: number;
  }[];
  sectionPattern?: string;
  vocals?: { language: string | null; languageConfidence: number; wordsHeard: number; wordsPerSec: number; repetition: number | null; firstVocalAt: number | null };
};

// A computer that is online, can listen (yt-dlp found) and is not busy.
export async function pickListener(): Promise<{ id: string; name: string } | null> {
  await ensureV2Tables();
  const machines = await prisma.jarvisMachine.findMany({
    where: { lastSeenAt: { gte: new Date(Date.now() - 90_000) } },
    orderBy: { lastSeenAt: "desc" },
  });
  const ready = machines.filter((m) => {
    const st = (m.status ?? {}) as { capabilities?: { listen?: boolean }; busyJobId?: string | null };
    return st.capabilities?.listen;
  });
  for (const m of ready) {
    const queued = await prisma.jarvisJob.count({ where: { target: `machine:${m.id}`, status: { in: ["queued", "running"] } } });
    if (queued === 0) return { id: m.id, name: m.name };
  }
  return null;
}

export async function queueListen(song: { id: string; videoId: string; title: string; artist: string | null }): Promise<string | null> {
  const machine = await pickListener();
  if (!machine) return null;
  await prisma.jarvisJob.create({
    data: {
      kind: "song_listen",
      target: `machine:${machine.id}`,
      payload: { songId: song.id, videoId: song.videoId, title: song.title, artist: song.artist },
    },
  });
  return machine.name;
}

export const PREVIEW_LABEL = "the 30-second preview";

// Safety net when no computer can get the full song: the free 30-second
// preview from Deezer (or Apple), usually the hook. Public, no sign-in.
async function findPreview(title: string, artist: string | null): Promise<string | null> {
  const clean = (s: string) => s.replace(/\s*[([].*?[)\]]/g, "").trim();
  const t = clean(title);
  const a = artist ? clean(artist.split(/,|&| feat/i)[0]) : "";
  try {
    const q = a ? `artist:"${a}" track:"${t}"` : t;
    const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=3`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { data?: { preview?: string }[] };
    const hit = j.data?.find((d) => d.preview);
    if (hit?.preview) return hit.preview;
  } catch {}
  try {
    const r = await fetch(`https://itunes.apple.com/search?entity=song&limit=3&term=${encodeURIComponent(`${t} ${a}`.trim())}`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { results?: { previewUrl?: string }[] };
    return j.results?.find((d) => d.previewUrl)?.previewUrl ?? null;
  } catch {
    return null;
  }
}

// True when a preview was found and handed to the voice service.
export async function listenToPreview(songId: string, title: string, artist: string | null): Promise<boolean> {
  const url = await findPreview(title, artist);
  if (!url) return false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 5_000_000) return false;
    const type = res.headers.get("content-type") || "audio/mpeg";
    await forwardAudio(songId, new Blob([buf], { type }), type.includes("mp4") || url.includes(".m4a") ? "preview.m4a" : "preview.mp3");
    return true;
  } catch {
    return false;
  }
}

// Hands the downloaded audio to the voice service. Answers fast: the
// analysis runs there and calls back.
export async function forwardAudio(songId: string, audio: Blob, fileName: string): Promise<void> {
  const base = process.env.VOICE_SERVICE_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.VOICE_SECRET;
  const site = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base || !secret || !site) throw new Error("The voice service is not configured (VOICE_SERVICE_URL / VOICE_SECRET).");
  const form = new FormData();
  form.append("audio", audio, fileName);
  form.append("callback", `${site}/api/jarvis-songs/listened`);
  form.append("songId", songId);
  const res = await fetch(`${base}/music/analyze`, {
    method: "POST",
    headers: { "x-voice-secret": secret },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The voice service answered ${res.status}${res.status === 404 ? " (it needs the music update deployed)" : ""}`);
}
