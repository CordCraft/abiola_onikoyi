import { voiceConfig, notConfigured, upstreamFailed } from "../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = voiceConfig();
  if (!cfg) return notConfigured();

  let body: { text?: unknown; voice?: unknown; speed?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.slice(0, 1500) : "";
  if (!text.trim()) return Response.json({ error: "Missing text" }, { status: 400 });

  const payload: Record<string, unknown> = { text };
  if (typeof body.voice === "string" && /^[a-z]{2}_[a-z]+$/.test(body.voice)) payload.voice = body.voice;
  if (typeof body.speed === "number" && Number.isFinite(body.speed)) payload.speed = body.speed;

  try {
    const res = await fetch(`${cfg.url}/tts`, {
      method: "POST",
      headers: { "x-voice-secret": cfg.secret, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(24_000),
    });
    if (!res.ok || !res.body) {
      return Response.json(
        { error: "tts failed" },
        { status: res.status === 401 || res.status === 500 ? 502 : res.status },
      );
    }
    // Stream the audio straight through; one sentence per request keeps it small.
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return upstreamFailed(err);
  }
}
