import Link from "next/link";
import { verifySession } from "@/lib/dal";

export const dynamic = "force-dynamic";

const GROUPS: { title: string; links: { href: string; label: string; hint: string }[] }[] = [
  {
    title: "You",
    links: [
      { href: "/jarvis/goals", label: "Goals", hint: "The big targets and milestones" },
      { href: "/jarvis/health", label: "Health", hint: "Sleep, workouts and the running plan" },
      { href: "/jarvis/songs", label: "Songs", hint: "Liked songs and Suno packs" },
    ],
  },
  {
    title: "Knowledge",
    links: [
      { href: "/jarvis/memory", label: "Memory", hint: "Notes, decisions and documents" },
      { href: "/jarvis/timeline", label: "Timeline", hint: "Everything in date order" },
      { href: "/jarvis/graph", label: "Graph", hint: "How projects and people connect" },
      { href: "/jarvis/activity", label: "Activity", hint: "GitHub, Netlify, Supabase, Claude Code" },
    ],
  },
  {
    title: "Setup",
    links: [
      { href: "/jarvis/connect", label: "Connect", hint: "WhatsApp, Gmail, Outlook, calendars" },
      { href: "/jarvis/machines", label: "Computers", hint: "Paired PCs that run jobs" },
      { href: "/jarvis/settings", label: "Settings", hint: "Face ID, rhythm, phone pairing" },
      { href: "/dashboard", label: "Dashboard", hint: "Site admin, blog, trading, mentorship" },
    ],
  },
];

export default async function MorePage() {
  await verifySession();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">More</h1>
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-900">
        <p className="font-medium">Talk to Jarvis on WhatsApp</p>
        <p className="mt-1 text-emerald-800/80">
          Open your own chat (&quot;Message yourself&quot;) and send <b>list</b>. Reply <b>2 done</b>, <b>3 tomorrow</b>, <b>1 send</b>, <b>4 drop</b>, or <b>5</b> followed by anything to talk about that item. Any other message is a normal chat with Jarvis.
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{g.title}</h2>
          <ul className="mt-2 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-white/60 bg-white/85 shadow-sm">
            {g.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50">
                  <span>
                    <span className="block text-sm font-medium text-zinc-900">{l.label}</span>
                    <span className="block text-xs text-zinc-500">{l.hint}</span>
                  </span>
                  <span className="text-zinc-300">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
