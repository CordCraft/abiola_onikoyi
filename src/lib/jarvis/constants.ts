// Pure constants/helpers for Jarvis (no server-only / Prisma), safe in clients.

export const VENTURE_STATUSES = ["active", "paused", "archived"] as const;
export const PROJECT_STATUSES = ["idea", "active", "stalled", "paused", "done"] as const;
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const GOAL_STATUSES = ["active", "paused", "done"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export const STALE_DAYS = 7;

export const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function isStalled(p: { status: string; lastActivityAt: Date | string }): boolean {
  if (p.status === "stalled") return true;
  if (p.status !== "active") return false;
  const t =
    typeof p.lastActivityAt === "string"
      ? new Date(p.lastActivityAt).getTime()
      : p.lastActivityAt.getTime();
  return t < Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
}

export function daysSince(date: Date | string): number {
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export function isPast(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  return t < Date.now();
}
