import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import type { Prisma } from "@prisma/client";

// Chat / MCP tools for the owner's computers (the Jarvis bridge agents).
// Wire `machineTools` into the tool list and route `executeMachineTool` for
// these names. Jobs run on the machine through scripts/jarvis-bridge.mjs.

export const ONLINE_WINDOW_MS = 90_000;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://abiolaonikoyi.com").replace(/\/$/, "");
export const MACHINES_URL = `${SITE}/jarvis/machines`;

export type MachineRepo = {
  name: string;
  path: string;
  branch: string | null;
  dirty: boolean | null;
  changed?: number;
  lastCommit?: { hash?: string; date?: string; subject?: string } | null;
};
export type MachineSession = { id: string; folder: string; lastModified: string; prompt: string | null };
export type MachineStatus = {
  uptimeSec?: number | null;
  claudeVersion?: string | null;
  roots?: string[];
  busyJobId?: string | null;
  repos?: MachineRepo[];
  sessions?: MachineSession[];
};

export function statusOf(v: Prisma.JsonValue | null | undefined): MachineStatus {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as MachineStatus) : {};
}

export function isOnline(lastSeenAt: Date | null | undefined): boolean {
  return !!lastSeenAt && Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

export async function listMachines() {
  await ensureV2Tables();
  return prisma.jarvisMachine.findMany({ orderBy: { name: "asc" } });
}

// Fuzzy name match: exact, then prefix, then substring, then shared words.
export async function findMachine(query: string) {
  const machines = await listMachines();
  const q = query.trim().toLowerCase();
  if (!q) return machines.length === 1 ? machines[0] : null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const exact = machines.find((m) => m.name.toLowerCase() === q);
  if (exact) return exact;
  const prefix = machines.filter((m) => m.name.toLowerCase().startsWith(q));
  if (prefix.length === 1) return prefix[0];
  const sub = machines.filter((m) => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()));
  if (sub.length === 1) return sub[0];
  const words = norm(q).split(/\s+/).filter((w) => w.length > 2);
  let best: { m: (typeof machines)[number]; score: number } | null = null;
  for (const m of machines) {
    const hay = norm(`${m.name} ${m.hostname ?? ""}`);
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { m, score };
  }
  return best?.m ?? null;
}

// Resolve a folder the user typed (a repo name or a path) against the machine's reported repos.
export function resolveFolder(status: MachineStatus, folder: string): string {
  const f = folder.trim();
  const repos = status.repos ?? [];
  const byName = repos.find((r) => r.name.toLowerCase() === f.toLowerCase());
  if (byName) return byName.path;
  const partial = repos.filter((r) => r.name.toLowerCase().includes(f.toLowerCase()));
  if (partial.length === 1 && !/[\\/]/.test(f)) return partial[0].path;
  return f;
}

export async function queueMachineTask(opts: {
  machineId: string;
  folder: string;
  prompt: string;
  permissionMode?: "plan" | "acceptEdits";
  timeoutMin?: number;
}) {
  await ensureV2Tables();
  const folder = opts.folder.trim();
  const prompt = opts.prompt.trim();
  if (!folder || folder.length > 400) throw new Error("A folder is required.");
  if (!prompt || prompt.length > 20_000) throw new Error("The prompt is empty or too long.");
  const machine = await prisma.jarvisMachine.findUnique({ where: { id: opts.machineId } });
  if (!machine) throw new Error("Unknown computer.");
  const job = await prisma.jarvisJob.create({
    data: {
      kind: "machine_task",
      target: `machine:${machine.id}`,
      payload: {
        folder,
        prompt,
        permissionMode: opts.permissionMode === "acceptEdits" ? "acceptEdits" : "plan",
        timeoutMin: Math.min(Math.max(opts.timeoutMin ?? 20, 1), 120),
        machineName: machine.name,
      },
    },
  });
  return { job, machine };
}

type JobView = {
  id: string;
  machineName: string | null;
  status: string;
  folder: string;
  prompt: string;
  mode: string;
  createdAt: Date;
  finishedAt: Date | null;
  progress: string[];
  text: string | null;
  costUsd: number | null;
  error: string | null;
  files: { name: string; size: number; key: string }[];
};

export function viewJob(j: {
  id: string;
  status: string;
  payload: Prisma.JsonValue;
  result: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}): JobView {
  const p = (j.payload && typeof j.payload === "object" && !Array.isArray(j.payload) ? j.payload : {}) as Record<
    string,
    unknown
  >;
  const r = (j.result && typeof j.result === "object" && !Array.isArray(j.result) ? j.result : {}) as Record<
    string,
    unknown
  >;
  return {
    id: j.id,
    machineName: typeof p.machineName === "string" ? p.machineName : null,
    status: j.status,
    folder: String(p.folder ?? ""),
    prompt: String(p.prompt ?? ""),
    mode: p.permissionMode === "acceptEdits" ? "edit" : "look only",
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    progress: Array.isArray(r.progress) ? (r.progress as string[]) : [],
    text: typeof r.text === "string" ? r.text : null,
    costUsd: typeof r.costUsd === "number" ? r.costUsd : null,
    error: j.error,
    files: Array.isArray(r.files) ? (r.files as JobView["files"]) : [],
  };
}

function ago(d: Date | null | undefined): string {
  if (!d) return "never";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const machineTools = [
  {
    name: "list_computers",
    description:
      "List the owner's computers (Dhahran home PC, Kuwait room, Kuwait office, travel laptop...) running the Jarvis bridge: online or offline, last seen, git repos with branch and uncommitted changes, recent Claude Code sessions.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "run_on_computer",
    description:
      "Give a task to Claude Code running on one of the owner's computers. Runs in the background; returns a job id. Default mode is 'plan' (read-only: look, analyse, report). Use mode 'edit' only when the owner clearly asked for changes or for files to be produced. Check the result later with get_computer_job.",
    input_schema: {
      type: "object" as const,
      properties: {
        computer: { type: "string", description: "Computer name, fuzzy matched (e.g. 'office', 'dhahran')" },
        folder: { type: "string", description: "Repo name or absolute folder path on that computer" },
        prompt: { type: "string", description: "What Claude Code should do" },
        mode: { type: "string", enum: ["plan", "edit"], description: "plan = read only (default), edit = may change files" },
      },
      required: ["computer", "folder", "prompt"],
    },
  },
  {
    name: "get_computer_job",
    description:
      "Get the status, progress and final result of a task sent to a computer. Omit id to see the 5 most recent tasks.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Job id from run_on_computer" } },
    },
  },
];

export const MACHINE_TOOL_NAMES = new Set(machineTools.map((t) => t.name));

export async function executeMachineTool(name: string, rawInput: unknown): Promise<string> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  switch (name) {
    case "list_computers": {
      const machines = await listMachines();
      if (!machines.length) return `No computers paired yet. Pair one at ${MACHINES_URL}.`;
      return machines
        .map((m) => {
          const s = statusOf(m.status);
          const repos = (s.repos ?? [])
            .slice(0, 12)
            .map((r) => `${r.name} (${r.branch ?? "?"}${r.dirty ? ", uncommitted changes" : ""})`)
            .join("; ");
          const sess = (s.sessions ?? [])
            .slice(0, 3)
            .map((x) => `${x.folder} "${(x.prompt ?? "").slice(0, 60)}" ${ago(new Date(x.lastModified))}`)
            .join("; ");
          return [
            `- ${m.name} [${isOnline(m.lastSeenAt) ? "ONLINE" : "offline"}, seen ${ago(m.lastSeenAt)}]${s.busyJobId ? " busy with a task" : ""}`,
            repos ? `  repos: ${repos}` : "",
            sess ? `  recent Claude sessions: ${sess}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n");
    }

    case "run_on_computer": {
      const computer = str(input.computer);
      const prompt = str(input.prompt);
      const folderIn = str(input.folder);
      if (!prompt || !folderIn) return "Error: folder and prompt are required.";
      const machine = await findMachine(computer);
      if (!machine) {
        const names = (await listMachines()).map((m) => m.name).join(", ") || "none paired";
        return `Error: no computer matches "${computer}". Known: ${names}.`;
      }
      const folder = resolveFolder(statusOf(machine.status), folderIn);
      const mode = str(input.mode) === "edit" ? "acceptEdits" : "plan";
      try {
        const { job } = await queueMachineTask({ machineId: machine.id, folder, prompt, permissionMode: mode });
        const online = isOnline(machine.lastSeenAt);
        return `Queued task ${job.id} on ${machine.name} (${mode === "plan" ? "look only" : "may edit"}) in ${folder}.${
          online ? "" : ` Note: ${machine.name} looks offline (seen ${ago(machine.lastSeenAt)}); it will start when the computer is back.`
        } Track it at ${MACHINES_URL} or ask me to check job ${job.id}.`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : "could not queue the task"}`;
      }
    }

    case "get_computer_job": {
      await ensureV2Tables();
      const id = str(input.id);
      if (!id) {
        const jobs = await prisma.jarvisJob.findMany({
          where: { kind: "machine_task" },
          orderBy: { createdAt: "desc" },
          take: 5,
        });
        if (!jobs.length) return "No tasks have been sent to computers yet.";
        return jobs
          .map((j) => {
            const v = viewJob(j);
            return `- ${v.id} [${v.status}] ${v.machineName ?? "?"}: ${v.prompt.slice(0, 80)} (${ago(v.createdAt)})`;
          })
          .join("\n");
      }
      const j = await prisma.jarvisJob.findUnique({ where: { id } });
      if (!j || j.kind !== "machine_task") return "No such task.";
      const v = viewJob(j);
      const parts = [`Task ${v.id} on ${v.machineName ?? "?"}: ${v.status.toUpperCase()} (${v.mode})`, `Folder: ${v.folder}`];
      if (v.status === "running" || v.status === "queued") {
        if (v.progress.length) parts.push(`Latest progress:\n${v.progress.slice(-8).join("\n")}`);
        else parts.push(v.status === "queued" ? "Waiting for the computer to pick it up." : "Working, no progress lines yet.");
      }
      if (v.text) parts.push(`Result:\n${v.text.slice(0, 8000)}`);
      if (v.error && v.status === "failed") parts.push(`Error: ${v.error}`);
      if (v.files.length) parts.push(`Files: ${v.files.map((f) => f.name).join(", ")} (download at ${MACHINES_URL})`);
      return parts.join("\n\n");
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
