import { closedSignals, closedTasks } from "@/lib/jarvis/v2/signals";
import { resolvedByLabel } from "@/components/jarvis/SignalCard";
import { UndoButton } from "@/components/jarvis/UndoButton";

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";
const when = (d: Date | null) =>
  d ? d.toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

// Everything Jarvis closed in the last 7 days, with the evidence and a one-tap Undo.
export async function ClosedByJarvis() {
  const [signals, tasks] = await Promise.all([closedSignals(7), closedTasks(7)]);
  // Tasks closed together with their signal are shown under the signal only.
  const rows = [
    ...signals.map((s) => ({
      key: `s-${s.id}`,
      kind: "signal" as const,
      id: s.id,
      title: s.title,
      by: s.resolvedBy,
      evidence: s.resolution,
      at: s.resolvedAt,
      href: `/jarvis/signals/${s.id}`,
    })),
    ...tasks
      .filter((t) => !t.sourceSignalId || !signals.some((s) => s.id === t.sourceSignalId))
      .map((t) => ({
        key: `t-${t.id}`,
        kind: "task" as const,
        id: t.id,
        title: t.title,
        by: t.closedBy,
        evidence: t.closeNote,
        at: t.completedAt,
        href: t.project ? `/jarvis/projects/${t.projectId}` : null,
      })),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  return (
    <section className="space-y-3" id="closed">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Closed by Jarvis, last 7 days</h2>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">Nothing closed yet. When you reply to someone or a deadline passes, it lands here with the evidence.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-2xl border border-white/60 bg-white/85">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800">
                  {r.href ? <a href={r.href}>{r.title}</a> : r.title}
                  <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-normal text-zinc-500">{r.kind}</span>
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {resolvedByLabel[r.by ?? ""] ?? "Closed by Jarvis"}
                  {r.evidence ? `: ${r.evidence}` : ""}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-400">{when(r.at)}</p>
              </div>
              <UndoButton id={r.id} kind={r.kind} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
