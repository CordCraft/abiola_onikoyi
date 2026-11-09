import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { openSignals } from "@/lib/jarvis/v2/signals";
import { listAllEvents } from "@/lib/jarvis/v2/calendar";
import { toView } from "@/lib/jarvis/v2/view";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { SignalCard } from "@/components/jarvis/SignalCard";
import { JarvisOrb } from "@/components/jarvis/Orb";
import { PushToggle } from "@/components/jarvis/PushToggle";

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date())) % 24;
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

// Clock reads live outside the component body (render must stay pure).
function clock() {
  const now = Date.now();
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const startOfDay = new Date(`${dayKey}T00:00:00+03:00`);
  return {
    now,
    from: new Date(Math.max(now - 3600e3, startOfDay.getTime())),
    endOfDay: new Date(startOfDay.getTime() + 864e5),
    planSince: new Date(now - 20 * 3600e3),
    nowHm: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(now)),
  };
}

// The top of Jarvis: what matters now, without having to type anything.
export async function TodayPanel() {
  await ensureV2Tables();
  const { now, from, endOfDay, planSince, nowHm } = clock();

  const [needs, plan, cal] = await Promise.all([
    openSignals(30).then((all) => all.filter((s) => s.kind !== "plan").slice(0, 6)),
    prisma.jarvisSignal.findFirst({ where: { kind: "plan", createdAt: { gte: planSince } }, orderBy: { createdAt: "desc" } }),
    listAllEvents(from, endOfDay).catch(() => ({ events: [], connected: 0, errors: [] as string[] })),
  ]);
  const planPayload = (plan?.action as { payload?: { plan?: { summary?: string; top_moves?: { title: string; why: string }[]; stop_at?: string; blocks?: { start: string; end: string; title: string; kind: string }[] } } } | null)?.payload?.plan;
  const nextEvent = cal.events.find((e) => !e.allDay && new Date(e.end || e.start).getTime() > now);
  const currentBlock = planPayload?.blocks?.find((b) => b.start <= nowHm && b.end > nowHm);

  return (
    <section className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#050b1f] via-[#071537] to-[#0b2a5c] p-6 text-white shadow-[0_20px_50px_-20px_rgba(8,30,80,0.6)] md:p-8">
        <div className="relative flex flex-col items-center gap-5 md:flex-row md:items-center md:gap-8">
          <Link href="/jarvis/chat?voice=1" aria-label="Talk to Jarvis" className="shrink-0">
            <JarvisOrb state="idle" size={168} />
          </Link>
          <div className="min-w-0 flex-1 text-center md:text-left">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-sky-300/80">{greeting()}, Abiola</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight md:text-3xl">
              {currentBlock ? `Now: ${currentBlock.title}` : nextEvent ? `Next: ${nextEvent.title} at ${time(nextEvent.start)}` : needs.length ? `${needs.length} thing${needs.length === 1 ? "" : "s"} need you` : "All clear. I am listening."}
            </h1>
            {planPayload?.summary && <p className="mt-2 text-sm text-sky-100/80">{planPayload.summary}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
              <Link href="/jarvis/chat?voice=1" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#071537]">
                Talk to Jarvis
              </Link>
              <Link href="/jarvis/chat" className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                Type
              </Link>
              <Link href="/jarvis/machines" className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                Computers
              </Link>
              <PushToggle />
            </div>
          </div>
        </div>

        {planPayload?.top_moves?.length ? (
          <div className="relative mt-6 grid gap-2 sm:grid-cols-3">
            {planPayload.top_moves.slice(0, 3).map((m, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">Move {i + 1}</p>
                <p className="mt-0.5 text-sm font-medium">{m.title}</p>
                <p className="mt-0.5 text-xs text-sky-100/60">{m.why}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Needs you</h2>
            <Link href="/jarvis/signals" className="text-xs text-zinc-500 hover:text-zinc-900">
              Everything Jarvis noticed
            </Link>
          </div>
          {needs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500">
              Nothing waiting on you. {cal.connected === 0 && <Link href="/jarvis/connect" className="font-medium text-indigo-600">Connect WhatsApp and your mailboxes</Link>}
            </p>
          ) : (
            needs.map((s) => <SignalCard key={s.id} s={toView(s)} compact />)
          )}
          {plan && (
            <Link href={`/jarvis/signals/${plan.id}`} className="block text-sm font-medium text-indigo-600">
              See today&apos;s full plan
            </Link>
          )}
        </div>

        <aside className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Today</h2>
          <div className="rounded-2xl border border-white/60 bg-white/80 p-4">
            {cal.connected === 0 ? (
              <p className="text-sm text-zinc-500">
                No calendars yet. <Link href="/jarvis/connect" className="font-medium text-indigo-600">Connect Google and Outlook</Link>
              </p>
            ) : cal.events.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing else on the calendar today.</p>
            ) : (
              <ul className="space-y-2.5">
                {cal.events.map((e) => (
                  <li key={`${e.provider}-${e.id}`} className="flex gap-3 text-sm">
                    <span className="w-12 shrink-0 font-mono text-xs leading-5 text-zinc-400">{e.allDay ? "all day" : time(e.start)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-zinc-800">{e.title}</span>
                      <span className={`text-[11px] ${e.purpose === "work" ? "text-sky-600" : "text-emerald-600"}`}>{e.purpose === "work" ? "Outlook" : "Google"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {planPayload?.stop_at && <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">Stop work at {planPayload.stop_at}. Family time after.</p>}
          </div>
        </aside>
      </div>
    </section>
  );
}
