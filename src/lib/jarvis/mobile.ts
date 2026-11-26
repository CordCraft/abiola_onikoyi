import "server-only";
import { prisma } from "@/lib/prisma";
import { RHYTHM_DEFAULTS } from "@/lib/jarvis/v2/rhythm";

// Data for the iPhone app: the "what's left today" list (app home screen,
// widgets and the Siri answer all read the same payload). Push to the app goes
// through app-push.ts (JarvisAppDevice).

export type TodayTask = {
  id: string;
  title: string;
  priority: string;
  status: string;
  due: string | null; // YYYY-MM-DD in the owner's timezone
  bucket: "overdue" | "today" | "doing" | "next";
  project: string | null;
};

export type TodayPayload = {
  generatedAt: string;
  tz: string;
  date: string;
  counts: { overdue: number; today: number; doing: number; open: number; doneToday: number; signals: number };
  tasks: TodayTask[];
  speech: string;
};

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const BUCKET_RANK: Record<TodayTask["bucket"], number> = { overdue: 0, today: 1, doing: 2, next: 3 };

async function ownerTz(): Promise<string> {
  const row = await prisma.jarvisSetting.findUnique({ where: { key: "rhythm" } });
  try {
    const tz = row ? (JSON.parse(row.value) as { tz?: string }).tz : undefined;
    if (tz) {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // throws on a bad zone
      return tz;
    }
  } catch {
    /* fall through */
  }
  return RHYTHM_DEFAULTS.tz;
}

const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function buildToday(limit = 25): Promise<TodayPayload> {
  const tz = await ownerTz();
  const now = new Date();
  const today = dayIn(now, tz);
  const since = new Date(now.getTime() - 36 * 3600 * 1000);

  const [open, doneRecent, signals] = await Promise.all([
    prisma.jarvisTask.findMany({
      where: { status: { in: ["todo", "doing"] } },
      include: { project: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 300,
    }),
    prisma.jarvisTask.findMany({
      where: { status: "done", completedAt: { gte: since } },
      select: { completedAt: true },
    }),
    prisma.jarvisSignal
      .count({ where: { status: { in: ["new", "pushed"] } } })
      .catch(() => 0),
  ]);

  const tasks: TodayTask[] = open.map((t) => {
    const due = t.dueDate ? dayIn(t.dueDate, tz) : null;
    const bucket: TodayTask["bucket"] =
      due && due < today ? "overdue" : due === today ? "today" : t.status === "doing" ? "doing" : "next";
    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      due,
      bucket,
      project: t.project?.name ?? null,
    };
  });

  tasks.sort(
    (a, b) =>
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999"),
  );

  const counts = {
    overdue: tasks.filter((t) => t.bucket === "overdue").length,
    today: tasks.filter((t) => t.bucket === "today").length,
    doing: tasks.filter((t) => t.bucket === "doing").length,
    open: tasks.length,
    doneToday: doneRecent.filter((t) => t.completedAt && dayIn(t.completedAt, tz) === today).length,
    signals,
  };

  return { generatedAt: now.toISOString(), tz, date: today, counts, tasks: tasks.slice(0, limit), speech: speak(tasks, counts) };
}

// A short spoken answer for Siri and the app's "what's left" button. Built in
// code (no model call) so Siri gets it within its time limit.
function speak(tasks: TodayTask[], c: TodayPayload["counts"]): string {
  const must = tasks.filter((t) => t.bucket === "overdue" || t.bucket === "today");
  const parts: string[] = [];
  if (!must.length) {
    parts.push(c.doneToday ? `You're clear for today. ${c.doneToday} done so far.` : "Nothing is due today.");
    const next = tasks.filter((t) => t.bucket === "doing" || t.priority === "high").slice(0, 2);
    if (next.length) parts.push(`If you have time, ${listPhrase(next.map((t) => t.title))}.`);
  } else {
    parts.push(`You have ${must.length} ${must.length === 1 ? "thing" : "things"} left for today${c.doneToday ? `, and ${c.doneToday} done already` : ""}.`);
    if (c.overdue) parts.push(`${c.overdue} ${c.overdue === 1 ? "is" : "are"} overdue.`);
    const top = must.slice(0, 3).map((t) => t.title);
    parts.push(`Start with ${listPhrase(top)}.`);
    if (must.length > 3) parts.push(`Then ${must.length - 3} more.`);
  }
  if (c.signals) parts.push(`${c.signals} ${c.signals === 1 ? "message needs" : "messages need"} your decision.`);
  return parts.join(" ");
}
