// All settings come from environment variables (Railway service variables).
const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  dataDir: env.DATA_DIR || '/data', // Railway volume: the WhatsApp link keys live here
  databaseUrl: env.DATABASE_URL,
  adminKey: env.LISTENER_ADMIN_KEY || '',
  encryptionKey: env.JARVIS_ENCRYPTION_KEY || '',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  triageModel: env.TRIAGE_MODEL || 'claude-sonnet-5-5',
  plannerModel: env.PLANNER_MODEL || 'claude-opus-5-5',
  siteUrl: (env.SITE_URL || 'https://abiolaonikoyi.com').replace(/\/$/, ''),
  vapidPublic: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || env.VAPID_PUBLIC_KEY || '',
  vapidPrivate: env.VAPID_PRIVATE_KEY || '',
  voiceUrl: (env.VOICE_SERVICE_URL || '').replace(/\/$/, ''),
  voiceSecret: env.VOICE_SECRET || '',
  google: { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' },
  microsoft: { clientId: env.MS_CLIENT_ID || '', clientSecret: env.MS_CLIENT_SECRET || '' },
  whatsapp: {
    enabled: env.WHATSAPP_ENABLED !== 'false',
    number: (env.WHATSAPP_NUMBER || '').replace(/\D/g, ''), // optional: pairing code instead of QR
    maxSendsPerDay: Number(env.WHATSAPP_MAX_SENDS_PER_DAY || 25),
  },
  ownerName: env.OWNER_NAME || 'Abiola Onikoyi',
  defaultTz: env.OWNER_TZ || 'Asia/Kuwait',
};

export function missing() {
  const out = [];
  if (!config.databaseUrl) out.push('DATABASE_URL');
  if (!config.encryptionKey) out.push('JARVIS_ENCRYPTION_KEY');
  if (!config.anthropicKey) out.push('ANTHROPIC_API_KEY');
  return out;
}
