"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MachineStatus } from "@/lib/jarvis/tools-machines";
import { removeMachine } from "@/app/jarvis/machines/actions";
import { TaskForm } from "./TaskForm";
import { JobList, type JobData } from "./JobList";
import { PairCard } from "./PairCard";

export type MachineData = {
  id: string;
  name: string;
  hostname: string | null;
  os: string | null;
  lastSeenAt: string | null;
  status: MachineStatus;
};

const ONLINE_MS = 90_000;

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function MachinesBoard({ machines, jobs }: { machines: MachineData[]; jobs: JobData[] }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const active = jobs.some((j) => j.status === "running" || j.status === "queued");

  // Refresh server data every 5s while a task is active, otherwise every 20s.
  useEffect(() => {
    const t = setInterval(
      () => {
        setNow(Date.now());
        router.refresh();
      },
      active ? 5000 : 20000,
    );
    return () => clearInterval(t);
  }, [active, router]);

  return (
    <div className="space-y-6">
      {machines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
          No computers yet. Use &ldquo;Pair a new computer&rdquo; below.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {machines.map((m) => {
            const online = !!m.lastSeenAt && now - new Date(m.lastSeenAt).getTime() < ONLINE_MS;
            const repos = m.status.repos ?? [];
            const sessions = m.status.sessions ?? [];
            return (
              <article key={m.id} className="rounded-2xl border border-zinc-200 bg-white/80 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-zinc-300"}`}
                        aria-label={online ? "online" : "offline"}
                      />
                      <span className="truncate">{m.name}</span>
                      {m.status.busyJobId ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                          working
                        </span>
                      ) : null}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {online ? "Online" : "Offline"}, seen {ago(m.lastSeenAt, now)}
                      {m.status.claudeVersion ? ` | Claude ${m.status.claudeVersion.split(" ")[0]}` : ""}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">
                      {[m.hostname, m.os].filter(Boolean).join(" | ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-zinc-400 hover:text-rose-600"
                    onClick={async () => {
                      if (confirm(`Remove ${m.name}? Its bridge will stop working until it is paired again.`)) {
                        await removeMachine(m.id);
                        router.refresh();
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>

                {repos.length ? (
                  <details className="mt-3" open={repos.length <= 4}>
                    <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
                      Repos ({repos.length})
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {repos.slice(0, 20).map((r) => (
                        <li key={r.path} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-zinc-800">{r.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5 text-zinc-500">
                            <span className="max-w-[9rem] truncate">{r.branch ?? "?"}</span>
                            {r.dirty ? (
                              <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">
                                {r.changed ? `${r.changed} changed` : "dirty"}
                              </span>
                            ) : (
                              <span className="text-[10px] text-emerald-600">clean</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {sessions.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
                      Recent Claude sessions ({sessions.length})
                    </summary>
                    <ul className="mt-1.5 space-y-1.5">
                      {sessions.map((s) => (
                        <li key={s.id} className="text-xs">
                          <p className="truncate text-zinc-800">{s.prompt || "(no prompt)"}</p>
                          <p className="truncate text-[11px] text-zinc-400">
                            {s.folder} | {ago(s.lastModified, now)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <TaskForm machines={machines} />
      <JobList jobs={jobs} />
      <PairCard />

      <section className="rounded-2xl border border-zinc-200 bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Remote Control (live sessions)</h2>
        <p className="mt-1 text-sm text-zinc-600">
          The bridge covers fire-and-forget tasks: you send a job, the computer works, the answer and any files come
          back here. For live back-and-forth with Claude, also turn on Remote Control in the Claude desktop app on each
          computer (Settings), then open the Claude app on your iPhone and attach to that computer. Keep the computer
          awake (power plan set to never sleep on mains) so both keep working.
        </p>
      </section>
    </div>
  );
}
