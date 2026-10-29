import "server-only";
import { prisma } from "@/lib/prisma";
import { recordActivity, resolveProjectId } from "./store";
import { mapLimit, type SourceResult } from "./util";

type Repo = {
  full_name: string;
  html_url: string;
  pushed_at: string | null;
  archived: boolean;
  fork: boolean;
  description: string | null;
};
type Commit = {
  sha: string;
  html_url: string;
  commit: { message: string; author: { date: string; name: string } | null };
};
type Pull = {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
};

export async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "jarvis-sync",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Pulls recent commits and open pull requests from every repo you can see. */
export async function syncGithub(since: Date): Promise<SourceResult> {
  if (!process.env.GITHUB_TOKEN) return { source: "github", skipped: "GITHUB_TOKEN not set" };

  const repos = await gh<Repo[]>(
    "/user/repos?sort=pushed&direction=desc&per_page=50&affiliation=owner,collaborator,organization_member",
  );
  const active = repos.filter(
    (r) => !r.archived && r.pushed_at && new Date(r.pushed_at) > since,
  );

  let added = 0;
  await mapLimit(active.slice(0, 25), 5, async (repo) => {
    const projectId = await resolveProjectId("github", repo.full_name, {
      autoCreate: !repo.fork,
      summary: repo.description
        ? `Auto-tracked from GitHub ${repo.full_name}: ${repo.description}`
        : `Auto-tracked from GitHub ${repo.full_name}`,
    });

    const [commits, pulls] = await Promise.all([
      gh<Commit[]>(`/repos/${repo.full_name}/commits?since=${since.toISOString()}&per_page=30`).catch(() => []),
      gh<Pull[]>(`/repos/${repo.full_name}/pulls?state=open&per_page=20`).catch(() => null),
    ]);

    for (const c of commits) {
      const [first, ...rest] = c.commit.message.split("\n");
      if (
        await recordActivity({
          source: "github",
          kind: "commit",
          externalId: `github:commit:${c.sha}`,
          subject: repo.full_name,
          title: first,
          detail: rest.join("\n").trim() || null,
          url: c.html_url,
          projectId,
          occurredAt: new Date(c.commit.author?.date ?? Date.now()),
        })
      )
        added++;
    }

    if (pulls) {
      const openIds = pulls.map((p) => `github:pr:${repo.full_name}#${p.number}`);
      for (const p of pulls) {
        if (
          await recordActivity({
            source: "github",
            kind: "pr",
            externalId: `github:pr:${repo.full_name}#${p.number}`,
            subject: repo.full_name,
            title: `PR #${p.number}: ${p.title}`,
            url: p.html_url,
            state: p.draft ? "draft" : "open",
            projectId,
            occurredAt: new Date(p.created_at),
          })
        )
          added++;
      }
      // PRs that are no longer open were merged or closed.
      await prisma.jarvisActivity.updateMany({
        where: {
          source: "github",
          kind: "pr",
          subject: repo.full_name,
          state: { in: ["open", "draft"] },
          externalId: { notIn: openIds },
        },
        data: { state: "closed" },
      });
    }
  });

  return { source: "github", ok: true, added, scanned: active.length };
}
