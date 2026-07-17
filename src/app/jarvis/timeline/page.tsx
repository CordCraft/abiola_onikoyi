import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

type Ev = {
  ts: Date;
  type: "task_done" | "task_new" | "note" | "decision" | "document";
  label: string;
  detail?: string;
  href?: string;
};

const ICONS: Record<Ev["type"], { glyph: string; cls: string }> = {
  task_done: { glyph: "✓", cls: "bg-emerald-100 text-emerald-700" },
  task_new: { glyph: "+", cls: "bg-zinc-100 text-zinc-600" },
  note: { glyph: "N", cls: "bg-amber-100 text-amber-700" },
  decision: { glyph: "D", cls: "bg-indigo-100 text-indigo-700" },
  document: { glyph: "F", cls: "bg-sky-100 text-sky-700" },
};

// Everything that happened, in one reverse-chronological scroll.
export default async function TimelinePage() {
  await verifySession();

  const [tasks, notes, decisions, documents] = await Promise.all([
    prisma.jarvisTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.jarvisNote.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.jarvisDecision.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.jarvisDocument.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, name: true, createdAt: true, project: { select: { id: true, name: true } } },
    }),
  ]);

  const events: Ev[] = [];
  for (const t of tasks) {
    events.push({
      ts: t.createdAt,
      type: "task_new",
      label: `Task created: ${t.title}`,
      detail: t.project?.name,
      href: t.project ? `/jarvis/projects/${t.project.id}` : undefined,
    });
    if (t.completedAt) {
      events.push({
        ts: t.completedAt,
        type: "task_done",
        label: `Completed: ${t.title}`,
        detail: t.project?.name,
        href: t.project ? `/jarvis/projects/${t.project.id}` : undefined,
      });
    }
  }
  for (const n of notes) {
    events.push({
      ts: n.createdAt,
      type: "note",
      label: n.body.length > 140 ? n.body.slice(0, 140) + "..." : n.body,
      detail: n.project?.name ?? (n.source === "capture" ? "inbox" : undefined),
      href: n.project ? `/jarvis/projects/${n.project.id}` : undefined,
    });
  }
  for (const d of decisions) {
    events.push({
      ts: d.createdAt,
      type: "decision",
      label: `Decision: ${d.title}`,
      detail: d.project?.name,
      href: d.project ? `/jarvis/projects/${d.project.id}` : undefined,
    });
  }
  for (const doc of documents) {
    events.push({
      ts: doc.createdAt,
      type: "document",
      label: `Document: ${doc.name}`,
      detail: doc.project?.name ?? "unfiled",
      href: `/jarvis/documents/${doc.id}`,
    });
  }

  events.sort((a, b) => b.ts.getTime() - a.ts.getTime());
  const shown = events.slice(0, 160);

  // Group by day
  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
  const groups: { day: string; items: Ev[] }[] = [];
  for (const ev of shown) {
    const day = dayFmt.format(ev.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(ev);
    else groups.push({ day, items: [ev] });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Timeline</h1>
        <p className="mt-1 text-sm text-zinc-500">Everything that happened, newest first.</p>
      </div>

      {groups.length === 0 ? <p className="text-sm text-zinc-500">Nothing yet.</p> : null}

      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="sticky top-14 z-10 -mx-2 bg-[#f6f6f9]/90 px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 backdrop-blur md:top-16">
            {g.day}
          </h2>
          <ul className="mt-2 space-y-1.5 border-l-2 border-zinc-200 pl-4">
            {g.items.map((ev, i) => {
              const icon = ICONS[ev.type];
              const inner = (
                <span className="flex items-start gap-2.5">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${icon.cls}`}>
                    {icon.glyph}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-zinc-800">{ev.label}</span>
                    <span className="text-xs text-zinc-400">
                      {timeFmt.format(ev.ts)}
                      {ev.detail ? ` · ${ev.detail}` : ""}
                    </span>
                  </span>
                </span>
              );
              return (
                <li key={i} className="rounded-lg px-2 py-1.5 hover:bg-white/80">
                  {ev.href ? <Link href={ev.href}>{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
