import "server-only";
import crypto from "node:crypto";

// AES-256-GCM, format "v1:" + base64url(iv | tag | ciphertext). Must match
// services/listener/src/crypto.js: the site stores OAuth tokens, the listener reads them.
function key(): Buffer {
  const k = process.env.JARVIS_ENCRYPTION_KEY;
  if (!k) throw new Error("JARVIS_ENCRYPTION_KEY is not set");
  return crypto.createHash("sha256").update(k).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(enc: string | null | undefined): string | null {
  if (!enc) return null;
  if (!enc.startsWith("v1:")) throw new Error("unknown token format");
  const raw = Buffer.from(enc.slice(3), "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
