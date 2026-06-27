import type { Config } from "@netlify/functions";

// Runs once a week on Netlify's scheduler and calls the secret-protected
// Next.js route that generates a new draft blog post.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("Site URL not available", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/generate-post`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });

  const text = await res.text();
  return new Response(text, { status: res.status });
};

export const config: Config = {
  // Every Monday at 08:00 UTC.
  schedule: "0 8 * * 1",
};
