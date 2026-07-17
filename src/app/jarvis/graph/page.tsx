import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { GraphView, type GraphNode, type GraphLink } from "@/components/jarvis/GraphView";

// The knowledge base as a map: ventures, projects, documents, decisions,
// goals, and how they connect. Orphaned knowledge is instantly visible.
export default async function GraphPage() {
  await verifySession();

  const [ventures, projects, documents, decisions, goals] = await Promise.all([
    prisma.jarvisVenture.findMany({ select: { id: true, name: true } }),
    prisma.jarvisProject.findMany({
      where: { status: { not: "done" } },
      select: { id: true, name: true, ventureId: true },
    }),
    prisma.jarvisDocument.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, name: true, projectId: true },
    }),
    prisma.jarvisDecision.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, title: true, projectId: true },
    }),
    prisma.jarvisGoal.findMany({
      where: { status: "active" },
      select: { id: true, title: true },
    }),
  ]);

  const nodes: GraphNode[] = [
    ...ventures.map((v) => ({
      id: `v:${v.id}`,
      label: v.name,
      type: "venture" as const,
      href: `/jarvis/ventures`,
    })),
    ...projects.map((p) => ({
      id: `p:${p.id}`,
      label: p.name,
      type: "project" as const,
      href: `/jarvis/projects/${p.id}`,
    })),
    ...documents.map((d) => ({
      id: `d:${d.id}`,
      label: d.name,
      type: "document" as const,
      href: `/jarvis/documents/${d.id}`,
    })),
    ...decisions.map((d) => ({
      id: `x:${d.id}`,
      label: d.title,
      type: "decision" as const,
      href: d.projectId ? `/jarvis/projects/${d.projectId}` : undefined,
    })),
    ...goals.map((g) => ({
      id: `g:${g.id}`,
      label: g.title,
      type: "goal" as const,
      href: `/jarvis/goals`,
    })),
  ];

  const links: GraphLink[] = [];
  for (const p of projects) {
    if (p.ventureId) links.push({ source: `v:${p.ventureId}`, target: `p:${p.id}` });
  }
  for (const d of documents) {
    if (d.projectId) links.push({ source: `p:${d.projectId}`, target: `d:${d.id}` });
  }
  for (const d of decisions) {
    if (d.projectId) links.push({ source: `p:${d.projectId}`, target: `x:${d.id}` });
  }

  // Drop links whose endpoints were filtered out (e.g. done projects)
  const ids = new Set(nodes.map((n) => n.id));
  const cleanLinks = links.filter((l) => ids.has(l.source) && ids.has(l.target));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Knowledge graph</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Your second brain as a map. Click any node to open it; unconnected nodes are unfiled knowledge.
        </p>
      </div>
      <div className="rounded-2xl border border-white/60 bg-white/85 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_20px_50px_-24px_rgba(30,27,75,0.28)] backdrop-blur-sm">
        {nodes.length <= 1 ? (
          <p className="py-16 text-center text-sm text-zinc-500">Not enough knowledge yet to draw a map.</p>
        ) : (
          <GraphView nodes={nodes} links={cleanLinks} />
        )}
      </div>
    </div>
  );
}
