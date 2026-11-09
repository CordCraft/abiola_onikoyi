import { voiceConfig, notConfigured, upstreamFailed } from "../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Netlify caps request bodies near 6 MB. The client keeps utterances well below.
const MAX_BYTES = 5.5 * 1024 * 1024;

export async function POST(req: Request) {
  const cfg = voiceConfig();
  if (!cfg) return notConfigured();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "Missing audio" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return Response.json({ error: "Audio too large" }, { status: 413 });
  }

  const out = new FormData();
  out.set("audio", audio, "audio");
  const prompt = form.get("prompt");
  if (typeof prompt === "string" && prompt.trim()) out.set("prompt", prompt.slice(0, 600));
  const language = form.get("language");
  if (typeof language === "string" && language.trim()) out.set("language", language.slice(0, 12));

  try {
    const res = await fetch(`${cfg.url}/stt`, {
      method: "POST",
      headers: { "x-voice-secret": cfg.secret },
      body: out,
      signal: AbortSignal.timeout(24_000),
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status === 401 ? 502 : res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return upstreamFailed(err);
  }
}
