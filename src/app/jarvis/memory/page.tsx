import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { deleteNote, deleteDecision, deleteDocument } from "@/app/jarvis/actions";
import { SettingForm } from "@/components/jarvis/SettingForm";

// "What Jarvis knows": every piece of stored knowledge in one transparent,
// editable place, plus the settings that shape Jarvis's behavior.
export default async function MemoryPage() {
  await verifySession();

  const [projects, decisions, notes, documents, settings] = await Promise.all([
    prisma.jarvisProject.findMany({
      where: { status: { not: "done" } },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true, name: true, summary: true, status: true },
    }),
    prisma.jarvisDecision.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { project: { select: { name: true } } },
    }),
    prisma.jarvisNote.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { project: { select: { name: true } } },
    }),
    prisma.jarvisDocument.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, summary: true, createdAt: true, project: { select: { name: true } } },
    }),
    prisma.jarvisSetting.findMany(),
  ]);

  const setting = (key: string) => settings.find((s) => s.key === key)?.value ?? "";

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">What Jarvis knows</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Everything in the knowledge base, in one place. Delete anything; Jarvis forgets it immediately.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/jarvis/timeline"
            className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Timeline
          </Link>
          <Link
            href="/jarvis/graph"
            className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Knowledge graph
          </Link>
          <a
            href="/jarvis/api/export"
            className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Download everything (JSON)
          </a>
        </div>
      </div>

      {/* Settings */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Settings</h2>
        <div className="mt-4 space-y-6">
          <SettingForm
            settingKey="calendar_ics_url"
            label="Calendar feed (secret iCal address)"
            hint='Google Calendar: Settings -> your calendar -> "Secret address in iCal format". Once pasted, Jarvis can answer schedule questions and include meetings in the briefing.'
            placeholder="https://calendar.google.com/calendar/ical/..."
            defaultValue={setting("calendar_ics_url")}
            secret
          />
          <SettingForm
            settingKey="briefing_prefs"
            label="Briefing preferences"
            hint='Free-text guidance the morning briefing follows, e.g. "Lead with Nikstalis. Never mention the blog. Keep it to 4 lines."'
            placeholder="What should the briefing focus on?"
            defaultValue={setting("briefing_prefs")}
            multiline
          />
        </div>
      </section>

      {/* Project summaries */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Project knowledge</h2>
        <ul className="mt-3 divide-y divide-zinc-100">
          {projects.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={`/jarvis/projects/${p.id}`} className="text-sm font-medium text-zinc-900 hover:text-indigo-700">
                  {p.name}
                </Link>
                <p className="text-sm text-zinc-600">{p.summary || <span className="text-zinc-400">No summary recorded yet.</span>}</p>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{p.status}</span>
            </li>
          ))}
          {projects.length === 0 ? <li className="py-3 text-sm text-zinc-500">No open projects.</li> : null}
        </ul>
      </section>

      {/* Decisions */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Decisions ({decisions.length})</h2>
        <ul className="mt-3 divide-y divide-zinc-100">
          {decisions.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900">
                  {d.project ? <span className="text-zinc-400">{d.project.name} · </span> : null}
                  {d.title}
                </p>
                <p className="text-sm text-zinc-600">{d.rationale}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{formatDate(d.createdAt)}</p>
              </div>
              <form action={deleteDecision}>
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" aria-label="Forget decision" className="text-xs text-zinc-300 hover:text-red-600">×</button>
              </form>
            </li>
          ))}
          {decisions.length === 0 ? <li className="py-3 text-sm text-zinc-500">No decisions recorded.</li> : null}
        </ul>
      </section>

      {/* Notes */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Notes (latest {notes.length})</h2>
        <ul className="mt-3 divide-y divide-zinc-100">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap text-sm text-zinc-700">
                  {n.project ? <span className="font-medium text-zinc-400">{n.project.name} · </span> : null}
                  {n.source === "capture" ? <span className="font-medium text-indigo-400">inbox · </span> : null}
                  {n.body.length > 400 ? n.body.slice(0, 400) + "..." : n.body}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">{formatDate(n.createdAt)}</p>
              </div>
              <form action={deleteNote}>
                <input type="hidden" name="id" value={n.id} />
                <button type="submit" aria-label="Forget note" className="text-xs text-zinc-300 hover:text-red-600">×</button>
              </form>
            </li>
          ))}
          {notes.length === 0 ? <li className="py-3 text-sm text-zinc-500">No notes yet.</li> : null}
        </ul>
      </section>

      {/* Documents */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Document library ({documents.length})</h2>
        <ul className="mt-3 divide-y divide-zinc-100">
          {documents.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={`/jarvis/documents/${d.id}`} className="text-sm font-medium text-zinc-900 hover:text-indigo-700">
                  {d.name}
                </Link>
                <p className="text-sm text-zinc-500">
                  {d.project ? `${d.project.name} · ` : "unfiled · "}
                  {d.summary || "no summary yet"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">{formatDate(d.createdAt)}</p>
              </div>
              <form action={deleteDocument}>
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" aria-label="Delete document" className="text-xs text-zinc-300 hover:text-red-600">×</button>
              </form>
            </li>
          ))}
          {documents.length === 0 ? <li className="py-3 text-sm text-zinc-500">No documents yet. Attach files in chat.</li> : null}
        </ul>
      </section>
    </div>
  );
}
