import "server-only";
import { sharedKeyFor } from "@/lib/mentorship/ai-keys";
import type { AcePack, SunoPack } from "@/lib/jarvis/songs/write";

// Plan B to Suno: ACE-Step 1.5, an open-source song model (Apache 2.0),
// hosted on fal.ai so no GPU is needed. About US$0.0006 per second of song
// with "thinking" on, so roughly 11 cents for a three-minute take.
// Queue API: submit returns a request id; status and result are polled.

const MODEL = "fal-ai/ace-step-1.5";
const QUEUE = `https://queue.fal.run/${MODEL}`;

export type Generation = {
  requestId: string;
  engine: "ace-step-1.5";
  status: "queued" | "running" | "done" | "error";
  audioUrls: string[];
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

function key(): string {
  const k = sharedKeyFor("fal");
  if (!k) throw new Error("FAL_KEY is not set on Netlify, so ACE-Step cannot run yet.");
  return k;
}

export const falConfigured = () => Boolean(sharedKeyFor("fal"));

export async function submitAce(suno: SunoPack, ace: AcePack): Promise<Generation> {
  const res = await fetch(QUEUE, {
    method: "POST",
    headers: { authorization: `Key ${key()}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: ace.prompt,
      lyrics: suno.lyrics.slice(0, 4096),
      duration: ace.duration,
      ...(ace.bpm ? { bpm: Math.round(ace.bpm) } : {}),
      ...(ace.keyScale ? { key_scale: ace.keyScale } : {}),
      vocal_language: ace.vocalLanguage || "unknown",
      thinking: true,
      num_outputs: 2,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { request_id?: string; detail?: unknown };
  if (!res.ok || !j.request_id) throw new Error(`fal turned the job down (${res.status}): ${JSON.stringify(j.detail ?? j).slice(0, 200)}`);
  return { requestId: j.request_id, engine: "ace-step-1.5", status: "queued", audioUrls: [], createdAt: new Date().toISOString() };
}

// Moves one generation forward; returns it unchanged when already finished.
export async function pollAce(g: Generation): Promise<Generation> {
  if (g.status === "done" || g.status === "error") return g;
  const auth = { authorization: `Key ${key()}` };
  const s = await fetch(`${QUEUE}/requests/${g.requestId}/status`, { headers: auth, cache: "no-store" });
  const sj = (await s.json().catch(() => ({}))) as { status?: string; error?: string };
  if (sj.status === "IN_QUEUE") return { ...g, status: "queued" };
  if (sj.status === "IN_PROGRESS") return { ...g, status: "running" };
  if (sj.status !== "COMPLETED") return { ...g, status: "error", error: sj.error ?? `status ${s.status}` };
  const r = await fetch(`${QUEUE}/requests/${g.requestId}`, { headers: auth, cache: "no-store" });
  const rj = (await r.json().catch(() => ({}))) as { audios?: { audio?: { url?: string } }[]; audio?: { url?: string }; detail?: unknown };
  const urls = (rj.audios ?? []).map((a) => a.audio?.url).filter((u): u is string => Boolean(u));
  if (!urls.length && rj.audio?.url) urls.push(rj.audio.url);
  if (!urls.length) return { ...g, status: "error", error: `no audio returned: ${JSON.stringify(rj.detail ?? rj).slice(0, 200)}` };
  return { ...g, status: "done", audioUrls: urls, finishedAt: new Date().toISOString() };
}
