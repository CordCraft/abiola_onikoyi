import type { Config } from "@netlify/functions";

// Runs every morning and calls the secret-protected route that has Jarvis
// write the day's briefing and push it to subscribed devices.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("Site URL not available", { status: 500 });
  }

  // Without CRON_SECRET the target route always answers 401, so fail loudly
  // here with a clear message instead of a mysterious downstream error.
  // Fix: set CRON_SECRET in Netlify (Site configuration, Environment variables).
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET is not set in the Netlify environment; skipping run");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/daily-briefing`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });

  const text = await res.text();
  return new Response(text, { status: res.status });
};

export const config: Config = {
  // Every day at 04:30 UTC (07:30 in Riyadh).
  schedule: "30 4 * * *",
};
