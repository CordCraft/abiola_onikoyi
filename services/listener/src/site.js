import { config } from './config.js';

// Calls into the site (Netlify) for things the site owns, such as the WhatsApp self-chat inbox.
// Fire and forget: a 20 second timeout, failures are logged and never thrown.

export function postToSiteWa(body) {
  if (!config.adminKey) {
    console.error('[site] no LISTENER_ADMIN_KEY, cannot reach /api/jarvis-app/wa');
    return Promise.resolve(false);
  }
  return fetch(`${config.siteUrl}/api/jarvis-app/wa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-listener-key': config.adminKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
    .then((res) => {
      if (!res.ok) console.error(`[site] /api/jarvis-app/wa answered ${res.status}`);
      return res.ok;
    })
    .catch((e) => {
      console.error('[site] /api/jarvis-app/wa failed:', e.message);
      return false;
    });
}
