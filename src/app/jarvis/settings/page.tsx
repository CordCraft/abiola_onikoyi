import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { PasskeyManager } from "@/components/jarvis/PasskeyManager";
import { RhythmForm } from "@/components/jarvis/RhythmForm";
import { listPasskeys } from "./passkey-actions";
import { loadRhythm } from "./rhythm-actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await verifySession();
  const [passkeys, { rhythm, learned }] = await Promise.all([listPasskeys(), loadRhythm()]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Settings</h1>
      <PasskeyManager initial={passkeys} />
      <RhythmForm rhythm={rhythm} learned={learned} />
      <section className="rounded-2xl border border-white/60 bg-white/80 p-5">
        <h2 className="text-lg font-semibold text-zinc-900">More</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {[
            ["/jarvis/connect", "Connections (WhatsApp, email, calendars)"],
            ["/jarvis/machines", "Computers"],
            ["/jarvis/ventures", "Ventures"],
            ["/jarvis/goals", "Goals"],
            ["/jarvis/memory", "Memory"],
            ["/jarvis/timeline", "Timeline"],
            ["/jarvis/graph", "Graph"],
            ["/jarvis/orb", "Orb preview"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-zinc-700 hover:border-zinc-400">
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
