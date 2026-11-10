import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { listConnections } from "@/lib/jarvis/v2/connections";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addSharedMailbox,
  removeConnection,
  removeSharedMailbox,
  setPurpose,
  setRouting,
  togglePaused,
  unlinkWhatsApp,
} from "./actions";

export const dynamic = "force-dynamic";

const card =
  "rounded-2xl border border-white/60 bg-white/80 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_10px_30px_-12px_rgba(0,0,0,0.12)] backdrop-blur-sm";

type WaStatus = { state?: string; account?: string; qrSvg?: string; pairingCode?: string; updatedAt?: string };
type Health = { ok?: boolean; whatsapp?: string; untriaged?: number; lastTriage?: string; lastGmail?: string; lastOutlook?: string; missingEnv?: string[]; errors?: { at: string; error: string }[] };

async function listenerHealth(): Promise<Health | null> {
  const url = process.env.LISTENER_URL?.replace(/\/$/, "");
  if (!url) return null;
  try {
    const res = await fetch(`${url}/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return (await res.json()) as Health;
  } catch {
    return { ok: false };
  }
}

function ago(d?: Date | string | null): string {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const statusTone: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  paused: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  error: "bg-amber-50 text-amber-700 ring-amber-200",
  needs_reauth: "bg-red-50 text-red-700 ring-red-200",
};

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await verifySession();
  const { connected, error } = await searchParams;
  const [conns, waRow, routingRow, health, sharedRow, sharedStatusRow] = await Promise.all([
    listConnections(),
    prisma.jarvisSetting.findUnique({ where: { key: "whatsapp_status" } }),
    prisma.jarvisSetting.findUnique({ where: { key: "calendar_routing" } }),
    listenerHealth(),
    prisma.jarvisSetting.findUnique({ where: { key: "outlook_shared_mailboxes" } }),
    prisma.jarvisSetting.findUnique({ where: { key: "outlook_shared_status" } }),
  ]);
  let shared: { mailbox: string; via: string }[] = [];
  let sharedStatus: Record<string, { lastSyncAt?: string | null; error?: string | null }> = {};
  try {
    const v = sharedRow ? JSON.parse(sharedRow.value) : [];
    shared = Array.isArray(v) ? v : [];
    sharedStatus = sharedStatusRow ? JSON.parse(sharedStatusRow.value) : {};
  } catch {
    // leave the defaults
  }
  let wa: WaStatus = {};
  try {
    wa = waRow ? (JSON.parse(waRow.value) as WaStatus) : {};
  } catch {
    wa = {};
  }
  let routing: { work?: string; personal?: string } = {};
  try {
    routing = routingRow ? JSON.parse(routingRow.value) : {};
  } catch {
    routing = {};
  }
  const mail = conns.filter((c) => c.provider === "google" || c.provider === "microsoft");
  const outlook = mail.filter((c) => c.provider === "microsoft");
  const missingOAuth = [
    !process.env.GOOGLE_CLIENT_ID && "Google",
    !process.env.MS_CLIENT_ID && "Microsoft",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Connections</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Everything Jarvis listens to. It reads quietly, never marks messages as read, and only sends when you say so.
        </p>
      </div>

      {connected && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">Connected {connected}. Jarvis starts listening within two minutes.</p>}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">Could not connect: {error}</p>}

      {/* Listener */}
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-zinc-900">Listener</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${health?.ok ? statusTone.active : statusTone.error}`}>
            {health === null ? "not configured" : health.ok ? "running" : "unreachable"}
          </span>
        </div>
        {health?.ok ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-zinc-600 sm:grid-cols-4">
            <div><dt className="text-xs text-zinc-400">Last triage</dt><dd>{ago(health.lastTriage)}</dd></div>
            <div><dt className="text-xs text-zinc-400">Waiting to read</dt><dd>{health.untriaged ?? 0}</dd></div>
            <div><dt className="text-xs text-zinc-400">Gmail check</dt><dd>{ago(health.lastGmail)}</dd></div>
            <div><dt className="text-xs text-zinc-400">Outlook check</dt><dd>{ago(health.lastOutlook)}</dd></div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            The always-on listener runs on Railway. Set <code>LISTENER_URL</code> and <code>LISTENER_ADMIN_KEY</code> in Netlify to see its health here.
          </p>
        )}
        {!!health?.missingEnv?.length && <p className="mt-2 text-sm text-amber-700">Listener is missing: {health.missingEnv.join(", ")}</p>}
      </section>

      {/* WhatsApp */}
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-zinc-900">WhatsApp</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${wa.state === "open" ? statusTone.active : wa.state === "pairing" ? statusTone.error : statusTone.paused}`}>
            {wa.state === "open" ? `linked +${wa.account}` : wa.state || "not started"}
          </span>
        </div>
        {wa.state === "pairing" && wa.qrSvg ? (
          <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row">
            <div className="w-56 rounded-xl bg-white p-2 ring-1 ring-zinc-200" dangerouslySetInnerHTML={{ __html: wa.qrSvg }} />
            <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600">
              <li>On your iPhone open WhatsApp, Settings, Linked devices.</li>
              <li>Tap Link a device and scan this code (open this page on a laptop).</li>
              {wa.pairingCode && <li>Or tap Link with phone number instead and enter <b className="font-mono text-zinc-900">{wa.pairingCode}</b>.</li>}
              <li>The code refreshes every minute; reload if it expired.</li>
            </ol>
          </div>
        ) : wa.state === "open" ? (
          <div className="mt-3 flex items-center justify-between gap-3 text-sm text-zinc-600">
            <p>Listening to your chats and voice notes. Your phone still shows everything as unread.</p>
            <form action={unlinkWhatsApp}>
              <SubmitButton className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-white">Unlink</SubmitButton>
            </form>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">Starts when the listener is running. A QR code appears here to link your number. WhatsApp allows four linked devices, so unlink an old one if it is full.</p>
        )}
      </section>

      {/* Mail and calendars */}
      <section className={card}>
        <h2 className="font-semibold text-zinc-900">Email and calendars</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Add every mailbox. Work accounts feed your Outlook calendar, personal ones your Google calendar.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/jarvis/api/connect/google/start" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            + Connect a Google account
          </a>
          <a href="/jarvis/api/connect/microsoft/start" className="rounded-full bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600">
            + Connect Microsoft 365 / Outlook
          </a>
        </div>
        {missingOAuth.length > 0 && (
          <p className="mt-2 text-xs text-amber-700">Not set up yet in Netlify: {missingOAuth.join(" and ")} sign-in (see docs/JARVIS-V2-SETUP.md).</p>
        )}

        <ul className="mt-5 divide-y divide-zinc-100">
          {mail.length === 0 && <li className="py-3 text-sm text-zinc-400">No accounts yet.</li>}
          {mail.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">{c.account}</p>
                <p className="text-xs text-zinc-500">
                  {c.provider === "google" ? "Gmail + Google Calendar" : "Outlook + Microsoft 365 calendar"} · checked {ago(c.lastSyncAt)}
                </p>
                {c.lastError && c.status !== "active" && <p className="mt-0.5 text-xs text-red-600">{c.lastError}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusTone[c.status] ?? statusTone.paused}`}>
                  {c.status === "needs_reauth" ? "reconnect" : c.status}
                </span>
                <form action={setPurpose}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="purpose" value={c.purpose === "work" ? "personal" : "work"} />
                  <SubmitButton className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-white" title="Switch between work and personal">
                    {c.purpose === "work" ? "Work" : "Personal"}
                  </SubmitButton>
                </form>
                <form action={togglePaused}>
                  <input type="hidden" name="id" value={c.id} />
                  <SubmitButton className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-white">
                    {c.status === "paused" ? "Resume" : "Pause"}
                  </SubmitButton>
                </form>
                <form action={removeConnection}>
                  <input type="hidden" name="id" value={c.id} />
                  <SubmitButton className="rounded-full px-2 py-1 text-xs text-red-600 hover:bg-red-50">Remove</SubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>

        {outlook.length > 0 && (
          <div className="mt-4 rounded-xl bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold text-zinc-900">Shared mailboxes</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Read a shared Outlook mailbox (for example ceo@hoppertax.com) through a signed-in account that has Full Access to it.
            </p>
            {shared.length > 0 && (
              <ul className="mt-3 divide-y divide-zinc-200">
                {shared.map((s) => {
                  const st = sharedStatus[s.mailbox] ?? {};
                  const via = outlook.find((c) => c.id === s.via)?.account ?? "a removed account";
                  return (
                    <li key={s.mailbox} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-900">{s.mailbox}</p>
                        <p className="text-xs text-zinc-500">via {via} · checked {ago(st.lastSyncAt)}</p>
                        {st.error && <p className="mt-0.5 text-xs text-red-600">{st.error}</p>}
                      </div>
                      <form action={removeSharedMailbox}>
                        <input type="hidden" name="mailbox" value={s.mailbox} />
                        <SubmitButton className="rounded-full px-2 py-1 text-xs text-red-600 hover:bg-red-50">Remove</SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            <form action={addSharedMailbox} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-xs font-medium text-zinc-600">
                Mailbox address
                <input
                  name="mailbox"
                  type="email"
                  required
                  placeholder="ceo@hoppertax.com"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-zinc-600">
                Read through
                <select name="via" className="mt-1 block rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm">
                  {outlook.map((c) => (
                    <option key={c.id} value={c.id}>{c.account}</option>
                  ))}
                </select>
              </label>
              <SubmitButton className="rounded-full bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600">Add</SubmitButton>
            </form>
          </div>
        )}

        {mail.length > 0 && (
          <form action={setRouting} className="mt-4 grid gap-3 rounded-xl bg-zinc-50 p-4 sm:grid-cols-3 sm:items-end">
            <label className="text-xs font-medium text-zinc-600">
              Work events go to
              <select name="work" defaultValue={routing.work ?? ""} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Automatic (first Outlook)</option>
                {mail.map((c) => (
                  <option key={c.id} value={c.id}>{c.account}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Personal and family events go to
              <select name="personal" defaultValue={routing.personal ?? ""} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Automatic (first Google)</option>
                {mail.map((c) => (
                  <option key={c.id} value={c.id}>{c.account}</option>
                ))}
              </select>
            </label>
            <SubmitButton className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Save calendar routing</SubmitButton>
          </form>
        )}
      </section>
    </div>
  );
}
