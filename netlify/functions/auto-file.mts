import type { Config } from "@netlify/functions";

// Nightly inbox filing, just before the morning briefing.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("Site URL not available", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/auto-file`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });

  const text = await res.text();
  return new Response(text, { status: res.status });
};

export const config: Config = {
  // Every day at 04:00 UTC (07:00 in Riyadh), 30 min before the briefing.
  schedule: "0 4 * * *",
};
