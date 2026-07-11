import type { Config } from "@netlify/functions";

// Sunday-evening weekly review: Jarvis reflects on the week, opens a chat
// thread with three planning questions, and pushes a link.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("Site URL not available", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/weekly-review`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });

  const text = await res.text();
  return new Response(text, { status: res.status });
};

export const config: Config = {
  // Sundays at 14:00 UTC (17:00 in Riyadh).
  schedule: "0 14 * * 0",
};
