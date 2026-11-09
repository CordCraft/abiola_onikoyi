// Shared helpers for the voice proxy routes. The leading underscore keeps this
// out of routing. The routes live under /jarvis/api/ so src/proxy.ts already
// requires a session cookie for them.

export function voiceConfig(): { url: string; secret: string } | null {
  const url = process.env.VOICE_SERVICE_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.VOICE_SECRET?.trim();
  if (!url || !secret) return null;
  return { url, secret };
}

export function notConfigured(): Response {
  return Response.json({ error: "voice service not configured" }, { status: 503 });
}

export function upstreamFailed(err: unknown): Response {
  const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  return Response.json(
    { error: timeout ? "voice service timed out" : "voice service unreachable" },
    { status: 503 },
  );
}
