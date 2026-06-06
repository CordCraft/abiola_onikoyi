// Pure constants and helpers (no server-only / Prisma imports) so they can be
// shared between server code and client components.

export const STATUSES = ["idea", "building", "launched", "paused"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  idea: "Idea",
  building: "Building",
  launched: "Launched",
  paused: "Paused",
};

// Tailwind classes per status badge.
export const STATUS_STYLES: Record<Status, string> = {
  idea: "bg-amber-100 text-amber-800",
  building: "bg-indigo-100 text-indigo-800",
  launched: "bg-emerald-100 text-emerald-800",
  paused: "bg-zinc-200 text-zinc-700",
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
