import type { Config } from "@netlify/functions";

// Health coach: morning brief, workout and movement nudges, check-ins.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) return new Response("Site URL not available", { status: 500 });
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET is not set in the Netlify environment; skipping run");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const res = await fetch(`${base}/api/cron/health-coach`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  return new Response(await res.text(), { status: res.status });
};

export const config: Config = {
  // Every 15 minutes; the route decides what (if anything) is due.
  schedule: "*/15 * * * *",
};
