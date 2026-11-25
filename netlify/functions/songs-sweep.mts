import type { Config } from "@netlify/functions";

// Jarvis Songs: songs waiting too long for a home computer to listen go on
// without the audio. The route does nothing when nothing is stuck.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base || !process.env.CRON_SECRET) return new Response("Not configured", { status: 500 });
  const res = await fetch(`${base}/api/jarvis-songs/step`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET },
    body: JSON.stringify({ sweep: true }),
  });
  return new Response(await res.text(), { status: res.status });
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
