import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { resolvedByLabel } from "@/components/jarvis/SignalCard";

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";

// The permanent record of what got done, newest first, grouped by day, searchable by text.
export async function DoneLedger({ q }: { q: string }) {
  await ensureV2Tables();
  const term = q.trim();
  const rows = await prisma.jarvisLedger.findMany({
    where: term
      ? {
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { summary: { contains: term, mode: "insensitive" } },
            { evidence: { contains: term, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { closedAt: "desc" },
    take: 300,
  });
  const dayOf = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const groups: { day: string; items: typeof rows }[] = [];
  for (const r of rows) {
    const day = dayOf(r.closedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <section className="space-y-5" id="done">
      <form method="get" className="flex gap-2">
        <input type="hidden" name="tab" value="done" />
        <input
          name="q"
          defaultValue={term}
          placeholder="Search what got done"
          className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400"
        />
        <button className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Search</button>
      </form>
      {groups.length === 0 && <p className="text-sm text-zinc-500">{term ? "Nothing matched." : "Nothing in the ledger yet. Items land here when a reply, Jarvis or an expiry closes them."}</p>}
      {groups.map((g) => (
        <div key={g.day} className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-zinc-900">{g.day}</h2>
          <ul className="mt-2 divide-y divide-zinc-100">
            {g.items.map((r) => (
              <li key={r.id} className="py-2.5">
                <p className="text-sm font-medium text-zinc-800">
                  {r.title}
                  <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-normal text-zinc-500">{r.kind}</span>
                </p>
                {r.summary && <p className="text-sm text-zinc-600">{r.summary}</p>}
                <p className="mt-0.5 text-xs text-zinc-500">
                  {resolvedByLabel[r.closedBy ?? ""] ?? "Done"}
                  {r.evidence ? `: ${r.evidence}` : ""}
                  <span className="text-zinc-400"> · {r.closedAt.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
