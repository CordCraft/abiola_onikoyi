import type { Config } from "@netlify/functions";

// Midday check for due/overdue tasks and newly stalled projects.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("Site URL not available", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/nudges`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });

  const text = await res.text();
  return new Response(text, { status: res.status });
};

export const config: Config = {
  // Every day at 09:30 UTC (12:30 in Riyadh).
  schedule: "30 9 * * *",
};
