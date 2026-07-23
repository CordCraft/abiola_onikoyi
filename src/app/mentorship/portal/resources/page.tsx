import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import {
  RESOURCE_CATEGORY_LABELS,
  type ResourceCategory,
} from "@/lib/mentorship/constants";
import { Card, EmptyState, Pill } from "@/components/mentorship/ui";

export default async function ResourcesPage() {
  await verifyMentee();

  const resources = await prisma.mentorshipResource.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Resources
        </h1>
        <p className="mt-1 text-zinc-400">
          A curated library from your mentor: readings, courses, tools, and
          more, shared with the whole cohort.
        </p>
      </div>

      {resources.length === 0 ? (
        <EmptyState>Resources will appear here as the programme unfolds.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {resources.map((r) => {
            const label =
              RESOURCE_CATEGORY_LABELS[r.category as ResourceCategory] ??
              r.category;
            const inner = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Pill tone={r.pinned ? "accent" : "neutral"}>
                    {r.pinned ? `Pinned · ${label}` : label}
                  </Pill>
                  {r.url ? (
                    <span aria-hidden className="text-zinc-500 transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-3 font-semibold text-white">{r.title}</h2>
                {r.note ? (
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                    {r.note}
                  </p>
                ) : null}
              </>
            );
            return r.url ? (
              <a
                key={r.id}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/25"
              >
                {inner}
              </a>
            ) : (
              <Card key={r.id}>{inner}</Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
