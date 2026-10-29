import "server-only";
import { recordActivity, resolveProjectId } from "./store";
import { mapLimit, type SourceResult } from "./util";

type Site = {
  id: string;
  name: string;
  url: string;
  ssl_url?: string;
  admin_url: string;
  updated_at: string;
  build_settings?: { repo_url?: string | null } | null;
};
type Deploy = {
  id: string;
  state: string; // ready | error | building | enqueued | new | processing ...
  title: string | null;
  error_message: string | null;
  branch: string | null;
  context: string | null;
  created_at: string;
  deploy_ssl_url?: string;
  admin_url?: string;
};

async function nf<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    headers: { authorization: `Bearer ${process.env.NETLIFY_TOKEN}`, "user-agent": "jarvis-sync" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Netlify ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** "https://github.com/CordCraft/hoppertax" -> "CordCraft/hoppertax" */
function repoFullName(url?: string | null): string | null {
  const m = url?.match(/github\.com[/:]([^/]+\/[^/.]+)/i);
  return m ? m[1] : null;
}

/** Records recent deploys (success and failure) for every site. */
export async function syncNetlify(since: Date): Promise<SourceResult> {
  if (!process.env.NETLIFY_TOKEN) return { source: "netlify", skipped: "NETLIFY_TOKEN not set" };

  const sites = await nf<Site[]>("/sites?per_page=100&filter=all");
  const recent = sites.filter((s) => new Date(s.updated_at) > since);

  let added = 0;
  await mapLimit(recent.slice(0, 30), 5, async (site) => {
    const repo = repoFullName(site.build_settings?.repo_url);
    const projectId = await resolveProjectId("netlify", site.name, {
      alsoTry: repo ? [{ source: "github", subject: repo }] : [],
    });
    const deploys = await nf<Deploy[]>(`/sites/${site.id}/deploys?per_page=5`);
    for (const d of deploys) {
      if (new Date(d.created_at) <= since) continue;
      const failed = d.state === "error";
      if (
        await recordActivity({
          source: "netlify",
          kind: "deploy",
          externalId: `netlify:deploy:${d.id}`,
          subject: site.name,
          title: `${failed ? "Deploy FAILED" : `Deploy ${d.state}`}: ${d.title ?? d.branch ?? "manual deploy"}`,
          detail: [
            `Site ${site.ssl_url ?? site.url}`,
            d.context ? `context ${d.context}` : "",
            d.error_message ? `error: ${d.error_message}` : "",
          ]
            .filter(Boolean)
            .join(", "),
          url: `${site.admin_url}/deploys/${d.id}`,
          state: d.state,
          projectId,
          occurredAt: new Date(d.created_at),
        })
      )
        added++;
    }
  });

  return { source: "netlify", ok: true, added, scanned: recent.length };
}
