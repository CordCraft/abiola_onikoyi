import crypto from 'node:crypto';
import { config } from './config.js';

// AES-256-GCM, format "v1:" + base64url(iv | tag | ciphertext). The site uses the same
// format (src/lib/jarvis/v2/crypto.ts) so either side can read tokens the other stored.
function key() {
  if (!config.encryptionKey) throw new Error('JARVIS_ENCRYPTION_KEY is not set');
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

export function encrypt(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function decrypt(enc) {
  if (!enc) return null;
  if (!enc.startsWith('v1:')) throw new Error('unknown token format');
  const raw = Buffer.from(enc.slice(3), 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
