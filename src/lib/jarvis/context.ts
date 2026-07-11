import "server-only";
import { prisma } from "@/lib/prisma";
import { daysSince, isStalled } from "@/lib/jarvis/constants";
import { formatDate } from "@/lib/format";

// Assembles a compact snapshot of the structured memory for Claude. Called each
// chat turn (after the route has verified the session).
export async function buildContext(): Promise<string> {
  const [ventures, projects, tasks, goals, notes, decisions, documents] = await Promise.all([
    prisma.jarvisVenture.findMany({ orderBy: { name: "asc" } }),
    prisma.jarvisProject.findMany({
      where: { status: { not: "done" } },
      orderBy: { lastActivityAt: "asc" },
      take: 40,
      include: { venture: { select: { name: true } } },
    }),
    prisma.jarvisTask.findMany({
      where: { status: { not: "done" } },
      orderBy: { dueDate: "asc" },
      take: 40,
      include: { project: { select: { name: true } } },
    }),
    prisma.jarvisGoal.findMany({
      where: { status: "active" },
      take: 20,
      include: { milestones: true },
    }),
    prisma.jarvisNote.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { project: { select: { name: true } } },
    }),
    prisma.jarvisDecision.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { project: { select: { name: true } } },
    }),
    prisma.jarvisDocument.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        name: true,
        summary: true,
        createdAt: true,
        project: { select: { name: true } },
      },
    }),
  ]);

  const lines: string[] = ["# Jarvis memory snapshot (live)"];

  lines.push("\n## Ventures");
  if (ventures.length === 0) lines.push("(none)");
  for (const v of ventures) lines.push(`- ${v.name} (${v.status}) [venture:${v.id}]`);

  lines.push("\n## Projects (open)");
  if (projects.length === 0) lines.push("(none)");
  for (const p of projects) {
    const stalled = isStalled(p) ? ", STALLED" : "";
    const venture = p.venture ? `, venture: ${p.venture.name}` : "";
    lines.push(
      `- ${p.name}: status ${p.status}${stalled}, priority ${p.priority}, last activity ${daysSince(p.lastActivityAt)}d ago${venture} [project:${p.id}]`,
    );
    if (p.summary) lines.push(`  summary: ${p.summary}`);
  }

  lines.push("\n## Open tasks");
  if (tasks.length === 0) lines.push("(none)");
  for (const t of tasks) {
    const due = t.dueDate ? `, due ${formatDate(t.dueDate)}` : "";
    const proj = t.project ? `, project: ${t.project.name}` : "";
    lines.push(`- [${t.status}, ${t.priority}] ${t.title}${due}${proj}`);
  }

  lines.push("\n## Goals");
  if (goals.length === 0) lines.push("(none)");
  for (const g of goals) {
    const target = g.targetDate ? `, target ${formatDate(g.targetDate)}` : "";
    const horizon = g.horizon ? ` (${g.horizon})` : "";
    lines.push(`- ${g.title}${horizon}${target} [goal:${g.id}]`);
    for (const m of g.milestones) {
      lines.push(`  [${m.done ? "x" : " "}] ${m.title}`);
    }
  }

  lines.push("\n## Recent notes");
  if (notes.length === 0) lines.push("(none)");
  for (const n of notes) {
    const proj = n.project ? `${n.project.name}, ` : "";
    lines.push(`- (${proj}${daysSince(n.createdAt)}d ago) ${n.body.slice(0, 200)}`);
  }

  lines.push("\n## Recent decisions");
  if (decisions.length === 0) lines.push("(none)");
  for (const d of decisions) {
    const proj = d.project ? `${d.project.name}: ` : "";
    lines.push(`- ${proj}${d.title}: because ${d.rationale.slice(0, 200)}`);
  }

  lines.push("\n## Document library (use read_document / search_documents for full text)");
  if (documents.length === 0) lines.push("(none)");
  for (const doc of documents) {
    const proj = doc.project ? `${doc.project.name} — ` : "unfiled — ";
    const summary = doc.summary ? ` ${doc.summary.slice(0, 180)}` : " (no summary yet)";
    lines.push(`- ${proj}${doc.name} (${daysSince(doc.createdAt)}d ago) [doc:${doc.id}]${summary}`);
  }

  return lines.join("\n");
}
