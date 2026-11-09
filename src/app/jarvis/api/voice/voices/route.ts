import { voiceConfig, notConfigured, upstreamFailed } from "../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Doubles as the client's "is the voice service up?" probe.
export async function GET() {
  const cfg = voiceConfig();
  if (!cfg) return notConfigured();
  try {
    const res = await fetch(`${cfg.url}/voices`, {
      headers: { "x-voice-secret": cfg.secret },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return Response.json({ error: "voice service error" }, { status: 503 });
    return new Response(await res.text(), {
      headers: { "content-type": "application/json", "cache-control": "private, max-age=300" },
    });
  } catch (err) {
    return upstreamFailed(err);
  }
}
