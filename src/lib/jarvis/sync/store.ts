import "server-only";
import { prisma } from "@/lib/prisma";
import type { SourceResult } from "./util";

export type SyncStatus = {
  at: string;
  results: SourceResult[];
};

export type ActivityInput = {
  source: "github" | "netlify" | "supabase" | "claude";
  kind: string;
  externalId: string;
  subject: string;
  title: string;
  detail?: string | null;
  url?: string | null;
  state?: string | null;
  projectId?: string | null;
  occurredAt: Date;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Strips "owner/" and common suffixes so "CordCraft/ielts-tutor" matches a
// Jarvis project called "IELTS Tutor".
function keyFor(subject: string): string {
  const last = subject.split("/").pop() ?? subject;
  return norm(last.replace(/\.(git|com|ng|ca|app)$/i, "").replace(/-(platform|site|web|app)$/i, ""));
}

/**
 * Finds the Jarvis project for an external thing. Order: explicit link,
 * then a name match against open projects. With `autoCreate`, a new project
 * is made for unknown things so nothing you work on stays invisible.
 * The answer (even "no project") is remembered in JarvisSourceLink.
 */
export async function resolveProjectId(
  source: ActivityInput["source"],
  subject: string,
  opts: { autoCreate?: boolean; summary?: string; alsoTry?: { source: ActivityInput["source"]; subject: string }[] } = {},
): Promise<string | null> {
  const existing = await prisma.jarvisSourceLink.findUnique({
    where: { source_subject: { source, subject } },
  });
  if (existing) return existing.projectId;

  // A Netlify site or Claude folder may already be linked through its repo.
  for (const alt of opts.alsoTry ?? []) {
    const l = await prisma.jarvisSourceLink.findUnique({
      where: { source_subject: { source: alt.source, subject: alt.subject } },
    });
    if (l?.projectId) {
      await saveLink(source, subject, l.projectId);
      return l.projectId;
    }
  }

  const key = keyFor(subject);
  let projectId: string | null = null;
  if (key.length >= 3) {
    const projects = await prisma.jarvisProject.findMany({ select: { id: true, name: true } });
    const exact = projects.find((p) => norm(p.name) === key);
    const loose =
      exact ??
      projects.find((p) => {
        const n = norm(p.name);
        return n.length >= 4 && key.length >= 4 && (n.includes(key) || key.includes(n));
      });
    projectId = loose?.id ?? null;
  }

  if (!projectId && opts.autoCreate) {
    const name = (subject.split("/").pop() ?? subject).replace(/[-_]/g, " ");
    const p = await prisma.jarvisProject.create({
      data: {
        name: name.charAt(0).toUpperCase() + name.slice(1),
        status: "active",
        priority: "medium",
        summary: opts.summary ?? `Auto-tracked from ${source}: ${subject}`,
      },
    });
    projectId = p.id;
  }

  // Only remember positive matches or auto-created ones; unmatched things get
  // another chance once a project with a fitting name exists.
  if (projectId) await saveLink(source, subject, projectId);
  return projectId;
}

async function saveLink(source: string, subject: string, projectId: string) {
  await prisma.jarvisSourceLink
    .upsert({
      where: { source_subject: { source, subject } },
      create: { source, subject, projectId },
      update: { projectId },
    })
    .catch(() => {});
}

/** Insert or refresh one activity row. Returns true when it was new. */
export async function recordActivity(a: ActivityInput): Promise<boolean> {
  const data = {
    source: a.source,
    kind: a.kind,
    subject: a.subject.slice(0, 200),
    title: a.title.slice(0, 300),
    detail: a.detail?.slice(0, 4000) ?? null,
    url: a.url ?? null,
    state: a.state ?? null,
    projectId: a.projectId ?? null,
    occurredAt: a.occurredAt,
  };
  const before = await prisma.jarvisActivity.findUnique({
    where: { externalId: a.externalId },
    select: { id: true },
  });
  await prisma.jarvisActivity.upsert({
    where: { externalId: a.externalId },
    create: { externalId: a.externalId, ...data },
    update: data,
  });
  if (a.projectId) {
    // Real work moves the project's clock forward, so it never looks stalled
    // while you are shipping.
    await prisma.jarvisProject.updateMany({
      where: { id: a.projectId, lastActivityAt: { lt: a.occurredAt } },
      data: { lastActivityAt: a.occurredAt },
    });
    await prisma.jarvisProject.updateMany({
      where: { id: a.projectId, status: "stalled", lastActivityAt: { gte: new Date(Date.now() - 7 * 864e5) } },
      data: { status: "active" },
    });
  }
  return !before;
}

export async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.jarvisSetting.findUnique({ where: { key } });
  return s?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.jarvisSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const raw = await getSetting("sync_status");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncStatus;
  } catch {
    return null;
  }
}
