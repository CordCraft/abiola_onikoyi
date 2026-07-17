import type { Config } from "@netlify/functions";

// Nightly: embed any documents/notes missing from the semantic index.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("Site URL not available", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/embed-backlog`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });

  const text = await res.text();
  return new Response(text, { status: res.status });
};

export const config: Config = {
  // Every day at 03:00 UTC.
  schedule: "0 3 * * *",
};
