import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { SubmitButton } from "@/components/SubmitButton";
import { ensureSyncTables } from "@/lib/jarvis/sync/setup";
import { getAlerts } from "@/lib/jarvis/sync/digest";
import { getSyncStatus } from "@/lib/jarvis/sync/store";
import { syncNow } from "./actions";

const BADGE: Record<string, string> = {
  github: "bg-zinc-900 text-white",
  netlify: "bg-teal-100 text-teal-800",
  supabase: "bg-emerald-100 text-emerald-800",
  claude: "bg-orange-100 text-orange-800",
};

const CONNECTIONS = [
  { source: "github", label: "GitHub", env: "GITHUB_TOKEN" },
  { source: "netlify", label: "Netlify", env: "NETLIFY_TOKEN" },
  { source: "supabase", label: "Supabase", env: "SUPABASE_ACCESS_TOKEN" },
];

// Live feed of real work: commits, deploys, databases and Claude Code sessions.
export default async function ActivityPage() {
  await verifySession();
  await ensureSyncTables();

  const [rows, alerts, status, lastClaude] = await Promise.all([
    prisma.jarvisActivity.findMany({ orderBy: { occurredAt: "desc" }, take: 150 }),
    getAlerts(),
    getSyncStatus(),
    prisma.jarvisActivity.findFirst({ where: { source: "claude" }, orderBy: { updatedAt: "desc" } }),
  ]);
  const projects = await prisma.jarvisProject.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.projectId).filter(Boolean))] as string[] } },
    select: { id: true, name: true },
  });
  const pname = new Map(projects.map((p) => [p.id, p.name]));

  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
  const groups: { day: string; items: typeof rows }[] = [];
  for (const r of rows) {
    const day = dayFmt.format(r.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Activity</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Synced every 30 minutes from GitHub, Netlify and Supabase, and live from Claude Code.
          </p>
        </div>
        <form action={syncNow}>
          <SubmitButton
            pendingLabel="Syncing"
            className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            Sync now
          </SubmitButton>
        </form>
      </div>

      <section className="grid gap-2 sm:grid-cols-4">
        {CONNECTIONS.map((c) => {
          const r = status?.results.find((x) => x.source === c.source);
          const state = !status ? "never synced" : r?.error ? "error" : r?.skipped ? "not connected" : "connected";
          const tone =
            state === "connected" ? "text-emerald-700" : state === "error" ? "text-rose-700" : "text-zinc-500";
          return (
            <div key={c.source} className="rounded-xl border border-zinc-200 bg-white/80 p-3">
              <p className="text-sm font-semibold text-zinc-900">{c.label}</p>
              <p className={`text-xs ${tone}`}>{state}</p>
              {r?.error ? <p className="mt-1 line-clamp-2 text-[11px] text-rose-600">{r.error}</p> : null}
              {state === "not connected" ? (
                <p className="mt-1 text-[11px] text-zinc-400">Add {c.env} in Netlify</p>
              ) : null}
            </div>
          );
        })}
        <div className="rounded-xl border border-zinc-200 bg-white/80 p-3">
          <p className="text-sm font-semibold text-zinc-900">Claude Code</p>
          <p className={`text-xs ${lastClaude ? "text-emerald-700" : "text-zinc-500"}`}>
            {lastClaude ? `last report ${timeFmt.format(lastClaude.updatedAt)}` : "no reports yet"}
          </p>
          {!lastClaude ? <p className="mt-1 text-[11px] text-zinc-400">Install the laptop hook</p> : null}
        </div>
      </section>
      {status ? (
        <p className="-mt-6 text-xs text-zinc-400">Last sync {timeFmt.format(new Date(status.at))} (Riyadh time)</p>
      ) : null}

      {alerts.length ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50/80 p-4">
          <h2 className="text-sm font-semibold text-rose-900">Needs attention</h2>
          <ul className="mt-2 space-y-1">
            {alerts.map((a) => (
              <li key={a.key} className="text-sm text-rose-800">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {a.text}
                  </a>
                ) : (
                  a.text
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.length === 0 ? (
        <p className="text-sm text-zinc-500">No activity yet. Connect a source, then press Sync now.</p>
      ) : null}

      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="sticky top-14 z-10 -mx-2 bg-[#f6f6f9]/90 px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 backdrop-blur md:top-16">
            {g.day}
          </h2>
          <ul className="mt-2 space-y-1.5 border-l-2 border-zinc-200 pl-4">
            {g.items.map((r) => {
              const proj = r.projectId ? pname.get(r.projectId) : null;
              const latest = r.kind === "session" ? r.detail?.split("Latest from Claude:\n")[1] : null;
              return (
                <li key={r.id} className="rounded-lg px-2 py-1.5 hover:bg-white/80">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${BADGE[r.source] ?? ""}`}>
                      {r.source}
                    </span>
                    <div className="min-w-0">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="block text-sm text-zinc-800 hover:underline">
                          {r.title}
                        </a>
                      ) : (
                        <span className="block text-sm text-zinc-800">{r.title}</span>
                      )}
                      {latest ? (
                        <p className="mt-0.5 line-clamp-3 text-xs text-zinc-500">{latest}</p>
                      ) : null}
                      <span className="text-xs text-zinc-400">
                        {timeFmt.format(r.occurredAt)} · {r.subject}
                        {proj ? (
                          <>
                            {" · "}
                            <Link href={`/jarvis/projects/${r.projectId}`} className="hover:underline">
                              {proj}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
