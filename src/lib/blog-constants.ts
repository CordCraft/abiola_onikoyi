// Pure blog constants/helpers (no server-only / Prisma), safe in client code.

export const POST_CATEGORIES = [
  "Reservoir & Production",
  "Operations",
  "Innovation",
] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export const POST_KINDS = ["news", "insight"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_KIND_LABELS: Record<PostKind, string> = {
  news: "Industry news",
  insight: "Insight",
};

// Posts older than this move from /blog to /blog/archive.
export const ARCHIVE_AFTER_DAYS = 90;

export function postSlugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
