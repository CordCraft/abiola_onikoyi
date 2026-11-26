import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { JarvisSignal, JarvisTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { decideSignal } from "@/lib/jarvis/v2/signals";
import { respawnRecurringTask } from "@/lib/jarvis/tools";

// One idea for the owner: an "item" is anything that may need him, either a
// task (JarvisTask) or something the listener noticed (JarvisSignal). Every
// item has its own page with a chat, closes itself when it is handled
// elsewhere, and is ranked so stale things sink instead of piling up.

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";

export type ItemKind = "task" | "signal";
export type ItemRef = `${ItemKind}-${string}`;

export type Item = {
  ref: ItemRef;
  kind: ItemKind;
  id: string;
  type: string; // task, reply, followup, opportunity, event, fyi ...
  title: string;
  detail: string | null;
  why: string | null;
  project: string | null;
  projectId: string | null;
  status: string;
  open: boolean;
  rank: number;
  due: string | null; // human, owner's timezone
  overdue: boolean;
  source: string | null;
  threadId: string | null;
  note: string | null;
  closedNote: string | null;
  delegatedTo: string | null;
  updatedAt: string;
};

export const OPEN_TASK = ["todo", "doing"];
const OPEN_SIGNAL = ["new", "pushed", "failed", "snoozed"];

export function parseRef(ref: string): { kind: ItemKind; id: string } | null {
  const m = /^(task|signal)[-:](.+)$/.exec(ref.trim());
  return m ? { kind: m[1] as ItemKind, id: m[2] } : null;
}

export function itemHref(ref: string): string {
  return `/jarvis/items/${ref}`;
}

function human(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}

const H = 3600e3;

// Signals: the listener's score, halving every 36 hours since anything new
// happened, so a two-week-old guest message never outranks today's.
export function signalRank(s: Pick<JarvisSignal, "score" | "updatedAt" | "dueAt">, now = Date.now()): number {
  const age = Math.max(0, now - s.updatedAt.getTime()) / H;
  let r = s.score * Math.pow(0.5, age / 36);
  if (s.dueAt) {
    const until = (s.dueAt.getTime() - now) / H;
    if (until >= 0 && until < 6) r += 10;
  }
  return Math.round(r);
}

// Tasks: priority sets the base, a near deadline lifts it, and a task left
// overdue for days (or undated and untouched for weeks) slowly sinks.
export function taskRank(t: Pick<JarvisTask, "priority" | "dueDate" | "createdAt" | "updatedAt">, now = Date.now()): number {
  const base = t.priority === "high" ? 75 : t.priority === "low" ? 35 : 55;
  if (t.dueDate) {
    const days = (now - t.dueDate.getTime()) / (24 * H);
    if (days > 2) return Math.round((base + 10) * Math.pow(0.5, (days - 2) / 4));
    if (days > -1) return base + 15;
    if (days > -3) return base + 5;
    return base - 10;
  }
  const idle = (now - Math.max(t.createdAt.getTime(), t.updatedAt.getTime())) / (24 * H);
  return Math.round((base - 15) * Math.pow(0.5, idle / 14));
}

type SignalRow = JarvisSignal;
type TaskRow = JarvisTask & { project: { name: string } | null };

function noteOf(result: unknown): string | null {
  const r = (result ?? {}) as { note?: string; error?: string };
  return r.note ?? (r.error ? `Failed: ${r.error}` : null);
}

export function fromSignal(s: SignalRow, projects: Map<string, string>, now = Date.now()): Item {
  const snoozed = s.status === "snoozed" && s.snoozeUntil && s.snoozeUntil.getTime() > now;
  return {
    ref: `signal-${s.id}`,
    kind: "signal",
    id: s.id,
    type: s.kind,
    title: s.title,
    detail: s.detail,
    why: s.why,
    project: s.projectId ? projects.get(s.projectId) ?? null : null,
    projectId: s.projectId,
    status: s.status,
    open: OPEN_SIGNAL.includes(s.status) && !snoozed,
    rank: signalRank(s, now),
    due: human(s.dueAt),
    overdue: !!s.dueAt && s.dueAt.getTime() < now,
    source: s.source,
    threadId: s.threadId,
    note: null,
    closedNote: noteOf(s.result),
    delegatedTo: s.delegatedTo,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function fromTask(t: TaskRow, now = Date.now()): Item {
  return {
    ref: `task-${t.id}`,
    kind: "task",
    id: t.id,
    type: "task",
    title: t.title,
    detail: null,
    why: null,
    project: t.project?.name ?? null,
    projectId: t.projectId,
    status: t.status,
    open: OPEN_TASK.includes(t.status),
    rank: taskRank(t, now),
    due: human(t.dueDate),
    overdue: !!t.dueDate && t.dueDate.getTime() < now,
    source: t.source,
    threadId: t.threadId,
    note: t.note,
    closedNote: t.closedReason,
    delegatedTo: null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

async function projectNames(): Promise<Map<string, string>> {
  const rows = await prisma.jarvisProject.findMany({ select: { id: true, name: true } });
  return new Map(rows.map((p) => [p.id, p.name]));
}

// Everything that needs the owner now, best first.
export async function needsYou(limit = 50): Promise<Item[]> {
  await ensureV2Tables();
  const now = Date.now();
  const [signals, tasks, projects] = await Promise.all([
    prisma.jarvisSignal.findMany({
      where: { status: { in: OPEN_SIGNAL }, kind: { notIn: ["plan", "fyi"] } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.jarvisTask.findMany({ where: { status: { in: OPEN_TASK } }, include: { project: { select: { name: true } } }, take: 400 }),
    projectNames(),
  ]);
  const items = [...signals.map((s) => fromSignal(s, projects, now)), ...tasks.map((t) => fromTask(t, now))].filter((i) => i.open);
  items.sort((a, b) => b.rank - a.rank);
  return items.slice(0, limit);
}

// Signals a delegate (for example a co-host) is handling; they reach the
// owner only if still open when their escalation time passes.
export async function waitingOnOthers(limit = 30): Promise<Item[]> {
  await ensureV2Tables();
  const [rows, projects] = await Promise.all([
    prisma.jarvisSignal.findMany({ where: { status: "delegated" }, orderBy: { updatedAt: "desc" }, take: limit }),
    projectNames(),
  ]);
  return rows.map((s) => fromSignal(s, projects));
}

export async function recentlyClosed(days = 7, limit = 60): Promise<Item[]> {
  await ensureV2Tables();
  const since = new Date(Date.now() - days * 24 * H);
  const [signals, tasks, projects] = await Promise.all([
    prisma.jarvisSignal.findMany({
      where: { status: { in: ["applied", "dismissed", "resolved", "expired", "undone"] }, kind: { not: "plan" }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.jarvisTask.findMany({
      where: { status: { in: ["done", "archived"] }, updatedAt: { gte: since } },
      include: { project: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    projectNames(),
  ]);
  return [...signals.map((s) => fromSignal(s, projects)), ...tasks.map((t) => fromTask(t))]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export async function getItem(ref: string): Promise<{ item: Item; signal: SignalRow | null; task: TaskRow | null } | null> {
  const p = parseRef(ref);
  if (!p) return null;
  await ensureV2Tables();
  if (p.kind === "signal") {
    const s = await prisma.jarvisSignal.findUnique({ where: { id: p.id } });
    if (!s) return null;
    return { item: fromSignal(s, await projectNames()), signal: s, task: null };
  }
  const t = await prisma.jarvisTask.findUnique({ where: { id: p.id }, include: { project: { select: { name: true } } } });
  if (!t) return null;
  return { item: fromTask(t), signal: null, task: t };
}

export async function linkThread(ref: string, threadId: string): Promise<void> {
  const p = parseRef(ref);
  if (!p) return;
  await ensureV2Tables();
  if (p.kind === "task") await prisma.jarvisTask.updateMany({ where: { id: p.id, threadId: null }, data: { threadId } });
  else await prisma.jarvisSignal.updateMany({ where: { id: p.id, threadId: null }, data: { threadId } });
}

// Hidden context sent with the first message of an item's chat.
export function itemContext(item: Item): string {
  const bits = [
    `ref: ${item.ref}`,
    item.kind === "task" ? `task_id: ${item.id}` : `signal_id: ${item.id}`,
    `type: ${item.type}`,
    `status: ${item.status}`,
    item.project ? `project: ${item.project}` : "",
    item.due ? `due: ${item.due}` : "",
    item.detail ? `detail: ${item.detail}` : "",
    item.why ? `why: ${item.why}` : "",
    item.note ? `owner's plan so far: ${item.note}` : "",
    item.delegatedTo ? `delegated to: ${item.delegatedTo}` : "",
  ].filter(Boolean);
  return `[The owner is talking about one item from his list: "${item.title}" (${bits.join("; ")}). Act on it with the item tools: close_item when he says it is done, handled by someone else or no longer needed (give his reason); update_task to change the due date, priority, title or to record his plan in "note" (a task he says he will do on a day gets that due date); merge_tasks for duplicates; act_on_signal to send a drafted reply only when he says to send it. Confirm in one short line what you changed.]`;
}

// ---- Changes -------------------------------------------------------------------------------

export async function closeItem(ref: string, reason: string, how: "done" | "archived" = "done"): Promise<string> {
  const p = parseRef(ref);
  if (!p) return "Unknown item.";
  await ensureV2Tables();
  if (p.kind === "task") {
    const t = await prisma.jarvisTask.findUnique({ where: { id: p.id } });
    if (!t) return "Task not found.";
    if (!OPEN_TASK.includes(t.status)) return `Already ${t.status}.`;
    await prisma.jarvisTask.update({
      where: { id: t.id },
      data: { status: how, completedAt: how === "done" ? new Date() : null, closedReason: reason.slice(0, 300) || null },
    });
    const next = how === "done" ? await respawnRecurringTask(t) : null;
    return `Closed "${t.title}".${next ? " The next one is scheduled." : ""}`;
  }
  const s = await prisma.jarvisSignal.findUnique({ where: { id: p.id } });
  if (!s) return "Signal not found.";
  if (!["new", "pushed", "snoozed", "failed", "delegated"].includes(s.status)) return `Already ${s.status}.`;
  await prisma.jarvisSignal.update({
    where: { id: s.id },
    data: { status: "resolved", decidedAt: new Date(), result: { ...((s.result as object) ?? {}), note: reason.slice(0, 300) || "You marked it done." } },
  });
  return `Closed "${s.title}".`;
}

export async function snoozeItem(ref: string, until: Date): Promise<string> {
  const p = parseRef(ref);
  if (!p) return "Unknown item.";
  await ensureV2Tables();
  const when = human(until) ?? "later";
  if (p.kind === "task") {
    await prisma.jarvisTask.update({ where: { id: p.id }, data: { dueDate: until } });
    return `Moved to ${when}.`;
  }
  await prisma.jarvisSignal.update({ where: { id: p.id }, data: { status: "snoozed", snoozeUntil: until } });
  return `Snoozed until ${when}.`;
}

export async function approveItem(ref: string): Promise<string> {
  const p = parseRef(ref);
  if (!p) return "Unknown item.";
  if (p.kind === "task") return closeItem(ref, "You marked it done.");
  return decideSignal(p.id, { action: "approve" });
}

export async function mergeTasks(keepId: string, dupIds: string[]): Promise<string> {
  await ensureV2Tables();
  const keep = await prisma.jarvisTask.findUnique({ where: { id: keepId } });
  if (!keep) return "The task to keep was not found.";
  const dups = await prisma.jarvisTask.findMany({ where: { id: { in: dupIds.filter((d) => d !== keepId) }, status: { in: OPEN_TASK } } });
  if (!dups.length) return "No open duplicates to merge.";
  const order = { low: 0, medium: 1, high: 2 } as Record<string, number>;
  const dues = [keep, ...dups].map((t) => t.dueDate).filter((d): d is Date => !!d);
  const priority = [keep, ...dups].reduce((a, t) => ((order[t.priority] ?? 1) > (order[a] ?? 1) ? t.priority : a), keep.priority);
  await prisma.$transaction([
    prisma.jarvisTask.update({
      where: { id: keep.id },
      data: { priority, dueDate: dues.length ? new Date(Math.min(...dues.map((d) => d.getTime()))) : keep.dueDate },
    }),
    prisma.jarvisTask.updateMany({
      where: { id: { in: dups.map((d) => d.id) } },
      data: { status: "archived", mergedInto: keep.id, closedReason: `Merged into "${keep.title}"` },
    }),
  ]);
  return `Merged ${dups.length} duplicate${dups.length === 1 ? "" : "s"} into "${keep.title}".`;
}

// ---- Duplicates ----------------------------------------------------------------------------

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "send", "check", "review", "about", "into", "then", "today", "tonight", "tomorrow"]);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// An open task from the last 45 days that says the same thing, if any.
export async function findDuplicateTask(title: string): Promise<JarvisTask | null> {
  await ensureV2Tables();
  const open = await prisma.jarvisTask.findMany({
    where: { status: { in: OPEN_TASK }, createdAt: { gte: new Date(Date.now() - 45 * 24 * H) } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  let best: JarvisTask | null = null;
  let bestScore = 0;
  for (const t of open) {
    const sc = similarity(title, t.title);
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

// ---- Tidy up: one pass over everything open ------------------------------------------------

export type TidyProposal = {
  close: { ref: string; title: string; reason: string }[];
  merge: { keep: string; keepTitle: string; duplicates: { ref: string; title: string }[] }[];
  keep: number;
  summary: string;
};

const TIDY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["close", "merge", "summary"],
  properties: {
    close: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["ref", "reason"], properties: { ref: { type: "string" }, reason: { type: "string" } } },
    },
    merge: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keep", "duplicates"],
        properties: { keep: { type: "string" }, duplicates: { type: "array", items: { type: "string" } } },
      },
    },
    summary: { type: "string" },
  },
};

// Opus reads every open item next to the owner's recent messages and work
// activity, and proposes what to close and what to merge. Nothing changes
// until the owner taps Apply.
export async function proposeTidy(): Promise<TidyProposal> {
  const items = await needsYou(250);
  if (!items.length) return { close: [], merge: [], keep: 0, summary: "Nothing open. All clear." };
  const since = new Date(Date.now() - 21 * 24 * H);
  const [outbound, activity] = await Promise.all([
    prisma.jarvisInbound
      .findMany({ where: { occurredAt: { gte: since } }, orderBy: { occurredAt: "desc" }, take: 250, select: { occurredAt: true, direction: true, source: true, chatName: true, senderName: true, subject: true, body: true } })
      .catch(() => []),
    prisma.jarvisActivity
      .findMany({ where: { occurredAt: { gte: since } }, orderBy: { occurredAt: "desc" }, take: 120, select: { occurredAt: true, source: true, title: true } })
      .catch(() => []),
  ]);
  const now = new Date();
  const list = items
    .map((i) => `${i.ref} | ${i.type} | ${i.title}${i.project ? ` | ${i.project}` : ""}${i.due ? ` | due ${i.due}` : ""} | last touched ${i.updatedAt.slice(0, 10)}${i.detail ? ` | ${i.detail.slice(0, 200)}` : ""}`)
    .join("\n");
  const msgs = outbound
    .map((m) => `${m.occurredAt.toISOString().slice(0, 16)} ${m.direction === "out" ? "OWNER" : m.senderName || "someone"} (${m.source}${m.chatName ? ` ${m.chatName}` : ""}${m.subject ? ` "${m.subject.slice(0, 80)}"` : ""}): ${(m.body || "").slice(0, 220)}`)
    .join("\n");
  const acts = activity.map((a) => `${a.occurredAt.toISOString().slice(0, 16)} ${a.source}: ${(a.title || "").slice(0, 160)}`).join("\n");

  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: `You tidy the owner's to-do list. Today is ${now.toISOString().slice(0, 10)}. He wants only what truly still needs him left open.
Close an item when: the messages or activity show it was done or answered (by him or a co-host such as Najeeb), its moment has passed (a guest reply for a stay that is over, a check-in that already happened, a dated errand days ago), or it is routine operations noise that a co-host handles. Give a short plain reason for each ("Guest checked out on 12 Nov", "You sent the comments on 14 Nov").
Merge items that are the same piece of work (keep the clearest, most recent one).
Keep anything with money, legal, family, a deal or a real deadline still ahead unless you see it was done. When unsure, keep it.
Use refs exactly as given. Never use em dashes. summary: one sentence on what is left.`,
    messages: [
      {
        role: "user",
        content: `OPEN ITEMS (${items.length}):\n${list}\n\nRECENT MESSAGES (newest first):\n${msgs || "(none)"}\n\nRECENT WORK ACTIVITY:\n${acts || "(none)"}`,
      },
    ],
    output_config: { effort: "high", format: { type: "json_schema", schema: TIDY_SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const out = JSON.parse(text) as { close: { ref: string; reason: string }[]; merge: { keep: string; duplicates: string[] }[]; summary: string };
  const byRef = new Map(items.map((i) => [i.ref as string, i]));
  const close = out.close.filter((c) => byRef.has(c.ref)).map((c) => ({ ref: c.ref, title: byRef.get(c.ref)!.title, reason: c.reason }));
  const closing = new Set(close.map((c) => c.ref));
  const merge = out.merge
    .filter((m) => byRef.get(m.keep)?.kind === "task")
    .map((m) => ({
      keep: m.keep,
      keepTitle: byRef.get(m.keep)!.title,
      duplicates: m.duplicates.filter((d) => d !== m.keep && byRef.get(d)?.kind === "task" && !closing.has(d)).map((d) => ({ ref: d, title: byRef.get(d)!.title })),
    }))
    .filter((m) => m.duplicates.length);
  const merged = merge.reduce((n, m) => n + m.duplicates.length, 0);
  return { close, merge, keep: items.length - close.length - merged, summary: out.summary };
}

export async function applyTidy(p: { close: { ref: string; reason: string }[]; merge: { keep: string; duplicates: string[] }[] }): Promise<string> {
  let closed = 0;
  let merged = 0;
  for (const c of p.close) {
    const r = await closeItem(c.ref, `Tidy up: ${c.reason}`, parseRef(c.ref)?.kind === "task" ? "archived" : "done");
    if (r.startsWith("Closed")) closed++;
  }
  for (const m of p.merge) {
    const keep = parseRef(m.keep);
    if (keep?.kind !== "task") continue;
    const ids = m.duplicates.map((d) => parseRef(d)).filter((x): x is { kind: ItemKind; id: string } => x?.kind === "task").map((x) => x.id);
    const r = await mergeTasks(keep.id, ids);
    const n = /^Merged (\d+)/.exec(r);
    if (n) merged += Number(n[1]);
  }
  return `Closed ${closed} and merged ${merged}.`;
}

// ---- Dates in the owner's timezone ---------------------------------------------------------

function offsetFor(tz: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT+03:00";
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

// 09:00 on the day `days` from today, in the owner's timezone.
export function morningIn(days: number): Date {
  const target = new Date(Date.now() + days * 24 * H);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(target);
  return new Date(`${day}T09:00:00${offsetFor(TZ, target)}`);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// "friday", "fri", "tomorrow", "next week", "later" -> a morning; null if not a day.
export function parseWhen(s: string): Date | null {
  const t = s.trim().toLowerCase().replace(/[.!]$/, "");
  if (/^(tomorrow|tmrw|tmr|tomoro|later)$/.test(t)) return morningIn(1);
  if (/^(next week|nxt week)$/.test(t)) return morningIn(7);
  if (/^(today|tonight)$/.test(t)) return new Date(Date.now() + 3 * H);
  const idx = WEEKDAYS.findIndex((d) => t === d || (t.length >= 3 && d.startsWith(t)));
  if (idx < 0) return null;
  const todayIdx = WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" }).format(new Date()).toLowerCase());
  let diff = (idx - todayIdx + 7) % 7;
  if (diff === 0) diff = 7;
  return morningIn(diff);
}
