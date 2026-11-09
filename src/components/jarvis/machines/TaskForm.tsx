"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendTask } from "@/app/jarvis/machines/actions";
import type { MachineData } from "./MachinesBoard";

export function TaskForm({ machines }: { machines: MachineData[] }) {
  const router = useRouter();
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [folder, setFolder] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"plan" | "acceptEdits">("plan");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const current = machines.find((m) => m.id === machineId) ?? machines[0];
  const repos = current?.status.repos ?? [];

  if (!machines.length) return null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/80 p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Send a task</h2>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          start(async () => {
            const r = await sendTask({ machineId: current.id, folder, prompt, mode });
            if (r.ok) {
              setPrompt("");
              setMsg({ ok: true, text: "Queued. It starts within about 10 seconds if the computer is online." });
              router.refresh();
            } else setMsg({ ok: false, text: r.error || "Failed" });
          });
        }}
      >
        <label className="block text-xs font-medium text-zinc-600">
          Computer
          <select
            value={current?.id}
            onChange={(e) => {
              setMachineId(e.target.value);
              setFolder("");
            }}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 sm:text-sm"
          >
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-zinc-600">
          Folder
          <input
            list="machine-repos"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="Pick a repo or type a full path"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 sm:text-sm"
            required
          />
          <datalist id="machine-repos">
            {repos.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </datalist>
        </label>

        <label className="block text-xs font-medium text-zinc-600">
          What should Claude do?
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            required
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 sm:text-sm"
            placeholder="e.g. Summarise what changed this week and list anything unfinished"
          />
        </label>

        <fieldset className="flex gap-2 text-sm">
          {(
            [
              ["plan", "Look only"],
              ["acceptEdits", "Allowed to edit"],
            ] as const
          ).map(([v, label]) => (
            <label
              key={v}
              className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center ${
                mode === v ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700"
              }`}
            >
              <input type="radio" name="mode" className="sr-only" checked={mode === v} onChange={() => setMode(v)} />
              {label}
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={pending || !prompt.trim() || !folder.trim()}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Sending..." : "Send task"}
        </button>
        {msg ? <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p> : null}
      </form>
    </section>
  );
}
