import { createHmac } from "node:crypto";
import { voiceConfig, notConfigured } from "../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Short-lived credential so the browser can talk to the Railway voice service
// directly (no Netlify hop). Session-protected by src/proxy.ts like the other
// voice routes. Format: base64url(exp).base64url(HMAC-SHA256(VOICE_SECRET, exp)),
// exp = unix seconds as a decimal string. Verified in services/voice/main.py.
const TTL_SECONDS = 5 * 60;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export async function GET() {
  const cfg = voiceConfig();
  if (!cfg) return notConfigured();
  // VOICE_PUBLIC_URL lets the browser use a different host than the server-side
  // proxy (for example a private one); it defaults to VOICE_SERVICE_URL.
  const url = (process.env.VOICE_PUBLIC_URL?.trim() || cfg.url).replace(/\/+$/, "");
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const expRaw = Buffer.from(String(exp));
  const sig = createHmac("sha256", cfg.secret).update(expRaw).digest();
  return Response.json(
    { url, token: `${b64url(expRaw)}.${b64url(sig)}`, exp },
    { headers: { "cache-control": "no-store" } },
  );
}
