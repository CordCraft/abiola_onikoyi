// Project health score 0-100. Pure function shared by the overview UI and the
// model context. Factors: recency of activity, overdue open tasks, and having
// a defined next action at all.
export function projectHealth(p: {
  lastActivityAt: Date;
  tasks: { status: string; dueDate: Date | null }[];
}): number {
  const days = Math.floor((Date.now() - p.lastActivityAt.getTime()) / 864e5);
  const open = p.tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.dueDate && t.dueDate.getTime() < Date.now()).length;

  let score = 100;
  score -= Math.min(45, Math.max(0, days) * 4); // silence decays fast
  score -= Math.min(30, overdue * 10); // overdue work bleeds
  if (open.length === 0) score -= 15; // no defined next action
  return Math.max(5, Math.min(100, score));
}

export function healthTone(score: number): "good" | "warn" | "bad" {
  return score >= 70 ? "good" : score >= 40 ? "warn" : "bad";
}
