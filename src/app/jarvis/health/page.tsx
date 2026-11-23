import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getHealthSnapshot, hasHealthToken, describeNight } from "@/lib/jarvis/health/data";
import { formatClock, hmToMinutes, localMinutes } from "@/lib/jarvis/health/time";
import { HealthTokenBox } from "@/components/jarvis/HealthTokenBox";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-5";
const tone = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" } as const;

export default async function HealthPage() {
  await verifySession();
  const [s, tokenSet] = await Promise.all([getHealthSnapshot(), hasHealthToken()]);
  const nowMin = localMinutes(new Date(), s.tz);
  const today = s.daily[s.today] ?? {};
  const maxH = 10;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Health</h1>
          <p className="text-sm text-zinc-500">{s.plan.weekday}: {s.plan.focus}</p>
        </div>
        <Link href="/jarvis/chat" className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">
          Tell Jarvis
        </Link>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={card}>
          <p className="text-xs font-medium text-zinc-500">Readiness</p>
          <p className="mt-1 flex items-center gap-2 text-3xl font-semibold text-zinc-900">
            <span className={`h-2.5 w-2.5 rounded-full ${tone[s.readiness.level]}`} />
            {s.readiness.score}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{s.readiness.reasons.join(", ")}</p>
        </div>
        <div className={card}>
          <p className="text-xs font-medium text-zinc-500">Last night</p>
          <p className="mt-1 text-3xl font-semibold text-zinc-900">{s.lastNight?.healthKitHours ?? s.lastNight?.hours ?? "-"}<span className="text-base text-zinc-400">h</span></p>
          <p className="mt-1 text-xs text-zinc-500">7-night avg {s.sleepAvg7 ?? "-"}h</p>
        </div>
        <div className={card}>
          <p className="text-xs font-medium text-zinc-500">Steps today</p>
          <p className="mt-1 text-3xl font-semibold text-zinc-900">{today.steps != null ? Math.round(today.steps).toLocaleString("en-US") : "-"}</p>
          <p className="mt-1 text-xs text-zinc-500">target {s.profile.stepsTarget.toLocaleString("en-US")}</p>
        </div>
        <div className={card}>
          <p className="text-xs font-medium text-zinc-500">This week</p>
          <p className="mt-1 text-3xl font-semibold text-zinc-900">{s.weekStrength}<span className="text-base text-zinc-400"> / {s.profile.strengthDays.length}</span></p>
          <p className="mt-1 text-xs text-zinc-500">strength, plus {s.weekRuns} run{s.weekRuns === 1 ? "" : "s"}</p>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-zinc-900">Today&apos;s plan</h2>
        <ol className="mt-3 space-y-3">
          {s.plan.items.map((i) => {
            const past = hmToMinutes(i.at) + 30 < nowMin;
            return (
              <li key={i.id} className={`flex gap-3 ${past ? "opacity-60" : ""}`}>
                <span className="w-12 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-indigo-600">{i.at}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">{i.title}</p>
                  <p className="text-sm text-zinc-500">{i.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-xs text-zinc-400">
          Push-ups max {s.profile.pushupMax}, squats max {s.profile.squatMax}, plank {s.profile.plankSec}s, easy run {s.profile.runEasyMin} min. The plan grows as you log sessions. Tell Jarvis to change days, times or numbers.
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-zinc-900">Sleep, last 14 nights</h2>
        <p className="mt-1 text-xs text-zinc-500">From your last tap at night to your first tap in the morning. Apple Health sleep is used when the Shortcut sends it.</p>
        <div className="mt-4 flex h-36 items-end gap-1.5">
          {s.nights.map((n) => {
            const h = n.healthKitHours ?? n.hours;
            const pct = h ? Math.min(100, (h / maxH) * 100) : 0;
            const good = h != null && h >= s.profile.sleepTargetH - 0.5;
            return (
              <div key={n.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${n.day}: ${describeNight(n, s.tz)}`}>
                <span className="text-[10px] tabular-nums text-zinc-500">{h ?? ""}</span>
                <div className={`w-full rounded-t ${h == null ? "bg-zinc-100" : good ? "bg-indigo-500" : "bg-amber-400"}`} style={{ height: h == null ? "4px" : `${pct}%` }} />
                <span className="text-[10px] text-zinc-400">{n.day.slice(8)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Last night: {describeNight(s.lastNight, s.tz)}
          {s.lastPhoneUse ? ` Last tap seen ${formatClock(s.lastPhoneUse, s.tz)}.` : ""}
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-zinc-900">Recent workouts</h2>
        {s.workouts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Nothing logged yet. Reply &quot;Done&quot; to a workout notification, or tell Jarvis what you did.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100 text-sm">
            {s.workouts.slice(0, 12).map((w, idx) => (
              <li key={idx} className="flex justify-between gap-3 py-2">
                <span className="text-zinc-900">
                  {w.kind} <span className="text-zinc-400">{w.status !== "done" ? `(${w.status})` : ""}</span>
                  <span className="block text-xs text-zinc-500">
                    {[w.pushups ? `${w.pushups} push-ups` : "", w.squats ? `${w.squats} squats` : "", w.plankSec ? `plank ${w.plankSec}s` : "", w.durationMin ? `${w.durationMin} min` : "", w.distanceKm ? `${w.distanceKm} km` : "", w.details ?? ""].filter(Boolean).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-zinc-400">{w.day}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-zinc-900">Connect your iPhone</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Apple only lets apps read Health data on the phone, so two Apple Shortcuts send it here. Full steps are in the repo at docs/JARVIS-HEALTH.md.
        </p>
        <div className="mt-3">
          <HealthTokenBox hasToken={tokenSet} endpoint="https://abiolaonikoyi.com/api/jarvis-health" />
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-600">
          <li>
            <b>Taps for sleep.</b> Shortcuts, Automation, New, App: pick the apps you open most (WhatsApp, Safari, Mail, Instagram, Messages and so on), &quot;Is Opened&quot;, Run Immediately, Notify When Run off. Action: Get Contents of URL, POST, header <code>Authorization: Bearer YOUR_KEY</code>, JSON body <code>event = phone_use</code>.
          </li>
          <li>
            <b>Health numbers.</b> A Shortcut that runs at 09:00, 13:00, 17:00 and 21:00 (Time of Day automations): Find Health Samples for steps, resting heart rate, HRV, active energy, sleep; then POST <code>day = today</code> and a <code>metrics</code> dictionary.
          </li>
          <li>
            <b>Optional.</b> Charger connected / disconnected automations with the same tap request make the bedtime estimate sharper. Opening Jarvis itself always counts.
          </li>
        </ol>
      </section>
    </div>
  );
}
