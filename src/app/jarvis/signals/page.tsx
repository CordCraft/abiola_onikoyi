import { verifySession } from "@/lib/dal";
import { recentSignals } from "@/lib/jarvis/v2/signals";
import { toView } from "@/lib/jarvis/v2/view";
import { ClosedByJarvis } from "@/components/jarvis/ClosedByJarvis";
import { SignalCard } from "@/components/jarvis/SignalCard";

export const dynamic = "force-dynamic";

// Everything Jarvis noticed recently, newest first.
export default async function SignalsPage() {
  await verifySession();
  const signals = await recentSignals(60);
  // Resolved and expired items live under "Closed by Jarvis", not in the main list.
  const open = signals.filter((s) => s.status !== "resolved" && s.status !== "expired");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">What Jarvis noticed</h1>
      {open.length === 0 && <p className="text-sm text-zinc-500">Nothing yet. Once WhatsApp and your mailboxes are connected, this fills up by itself.</p>}
      {open.map((s) => (
        <SignalCard key={s.id} s={toView(s)} compact />
      ))}
      <ClosedByJarvis />
    </div>
  );
}
