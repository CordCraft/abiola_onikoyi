"use client";

import { useRouter } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { cancelTask } from "@/app/jarvis/machines/actions";

export type JobData = {
  id: string;
  machineName: string | null;
  status: string;
  folder: string;
  prompt: string;
  mode: string;
  createdAt: string;
  finishedAt: string | null;
  progress: string[];
  text: string | null;
  costUsd: number | null;
  error: string | null;
  files: { name: string; size: number; key: string }[];
};

const TONE: Record<string, string> = {
  queued: "bg-zinc-100 text-zinc-700",
  running: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-zinc-100 text-zinc-500",
};

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Riyadh",
});

function size(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function JobList({ jobs }: { jobs: JobData[] }) {
  const router = useRouter();
  if (!jobs.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-900">Tasks</h2>
      {jobs.map((j) => {
        const live = j.status === "running" || j.status === "queued";
        return (
          <article key={j.id} className="rounded-2xl border border-zinc-200 bg-white/80 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 [overflow-wrap:anywhere]">
                  {j.prompt.length > 140 ? `${j.prompt.slice(0, 140)}...` : j.prompt}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {j.machineName ?? "?"} | {j.mode} | {j.folder} | {fmt.format(new Date(j.createdAt))}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[j.status] ?? TONE.queued}`}>
                {j.status}
              </span>
            </div>

            {live ? (
              <div className="mt-2">
                {j.progress.length ? (
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-zinc-50 p-2 font-mono text-[11px] text-zinc-600">
                    {j.progress.slice(-12).map((l, i) => (
                      <li key={i} className="[overflow-wrap:anywhere]">
                        {l}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-zinc-500">
                    {j.status === "queued" ? "Waiting for the computer to pick it up..." : "Working..."}
                  </p>
                )}
                <button
                  type="button"
                  className="mt-2 text-xs text-rose-600 hover:underline"
                  onClick={async () => {
                    await cancelTask(j.id);
                    router.refresh();
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : null}

            {j.text ? (
              <details className="mt-3" open={j.status === "done"}>
                <summary className="cursor-pointer text-xs font-semibold text-zinc-700">Result</summary>
                <div className="mt-2 text-sm [overflow-wrap:anywhere]">
                  <Markdown>{j.text}</Markdown>
                </div>
              </details>
            ) : null}
            {!j.text && j.error && j.status === "failed" ? (
              <p className="mt-2 text-xs text-rose-700">{j.error}</p>
            ) : null}

            {j.files.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {j.files.map((f) => (
                  <li key={f.key}>
                    <a
                      href={`/jarvis/api/files/${f.key.split("/").map(encodeURIComponent).join("/")}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-800 hover:bg-zinc-50"
                    >
                      {f.name} <span className="text-zinc-400">{size(f.size)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {j.costUsd ? <p className="mt-2 text-[11px] text-zinc-400">Cost ${j.costUsd.toFixed(2)}</p> : null}
          </article>
        );
      })}
    </section>
  );
}
