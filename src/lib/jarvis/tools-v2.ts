import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { listAllEvents } from "@/lib/jarvis/v2/calendar";
import { decideSignal, enqueueJob } from "@/lib/jarvis/v2/signals";

// Chat (and Claude app connector) tools for the listener world: both calendars,
// everything heard on WhatsApp and email, signals, and sending on request.

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";

export const v2Tools = [
  {
    name: "get_schedule",
    description:
      "Read the owner's real calendars (Outlook work + Google personal) for today and the next days. Use before planning or proposing times.",
    input_schema: {
      type: "object" as const,
      properties: { days: { type: "number", description: "How many days ahead, 1-14 (default 2)" } },
    },
  },
  {
    name: "add_calendar_event",
    description:
      "Put an event on the owner's calendar. calendar='work' goes to Outlook (official), 'personal' to Google (family, personal). Times are ISO 8601 with offset, e.g. 2026-11-10T14:00:00+03:00. Use when the owner asks to schedule something or agrees to a time.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string", description: "ISO end; default 60 minutes after start" },
        all_day: { type: "boolean" },
        calendar: { type: "string", enum: ["work", "personal"] },
        location: { type: "string" },
        description: { type: "string" },
      },
      required: ["title", "start", "calendar"],
    },
  },
  {
    name: "search_messages",
    description:
      "Search everything Jarvis has heard on WhatsApp (chats, groups, transcribed voice notes) and email (all connected Gmail and Outlook boxes, in and out). Use to answer 'what did X say about Y', find a number, date, address or promise.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Words to find in the message, subject, sender or chat name" },
        person: { type: "string", description: "Optional sender or chat name filter" },
        days: { type: "number", description: "Look back this many days (default 30)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_signals",
    description: "What Jarvis noticed that still needs the owner: replies owed, meetings, opportunities, follow-ups, with their ids and proposed actions.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "act_on_signal",
    description:
      "Act on a signal: approve (runs its proposed action, e.g. sends the drafted reply or adds the event; optional text replaces a drafted reply), dismiss, snooze (hours), or undo.",
    input_schema: {
      type: "object" as const,
      properties: {
        signal_id: { type: "string" },
        action: { type: "string", enum: ["approve", "dismiss", "snooze", "undo"] },
        text: { type: "string" },
        hours: { type: "number" },
      },
      required: ["signal_id", "action"],
    },
  },
  {
    name: "send_message",
    description:
      "Send a WhatsApp message or email on the owner's behalf. ONLY when the owner explicitly asked to send it in this conversation; show him the final text first if he did not dictate it. WhatsApp only works for chats Jarvis has already seen. For email, from_account picks the mailbox (default: the work Outlook for work topics, else the first Gmail).",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", enum: ["whatsapp", "email"] },
        to: { type: "string", description: "Person or group name, phone number, or email address" },
        text: { type: "string" },
        subject: { type: "string" },
        from_account: { type: "string" },
      },
      required: ["channel", "to", "text"],
    },
  },
];

export const V2_TOOL_NAMES = new Set(v2Tools.map((t) => t.name));

type In = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function waitForJob(id: string, ms = 9000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const j = await prisma.jarvisJob.findUnique({ where: { id } });
    if (j && (j.status === "done" || j.status === "failed")) return j;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

function fmt(iso: string, allDay: boolean) {
  if (allDay) return `${iso.slice(0, 10)} (all day)`;
  return new Date(iso).toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export async function executeV2Tool(name: string, raw: unknown): Promise<string> {
  await ensureV2Tables();
  const input = (raw ?? {}) as In;
  switch (name) {
    case "get_schedule": {
      const days = Math.min(Math.max(Number(input.days) || 2, 1), 14);
      const { events, connected, errors } = await listAllEvents(new Date(Date.now() - 3600e3), new Date(Date.now() + days * 864e5));
      if (!connected) return "No calendars connected yet (Jarvis > Connections).";
      const lines = events.map((e) => `- ${fmt(e.start, e.allDay)} | ${e.title}${e.location ? ` @ ${e.location}` : ""} [${e.purpose === "work" ? "Outlook" : "Google"}]`);
      return `${lines.join("\n") || "Nothing scheduled."}${errors.length ? `\n(Could not read: ${errors.join("; ")})` : ""}`;
    }
    case "add_calendar_event": {
      const title = s(input.title);
      const start = s(input.start);
      if (!title || !start || Number.isNaN(new Date(start).getTime())) return "title and a valid ISO start are required.";
      const job = await enqueueJob("calendar_event", {
        purpose: input.calendar === "work" ? "work" : "personal",
        title,
        start,
        end: s(input.end) || null,
        allDay: !!input.all_day,
        location: s(input.location) || null,
        description: s(input.description) || null,
        tentative: false,
        tz: TZ,
      });
      const done = await waitForJob(job.id);
      if (!done) return `Queued: "${title}" will be on the ${input.calendar === "work" ? "Outlook" : "Google"} calendar in a moment (the listener applies it).`;
      if (done.status === "failed") return `Error: could not add the event: ${done.error}`;
      return `SAVED: "${title}" added for ${fmt(start, !!input.all_day)} on ${(done.result as { account?: string } | null)?.account ?? "your calendar"}.`;
    }
    case "search_messages": {
      const query = s(input.query);
      const person = s(input.person);
      const days = Math.min(Math.max(Number(input.days) || 30, 1), 120);
      const words = query.split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
      const where: Prisma.JarvisInboundWhereInput = {
        occurredAt: { gte: new Date(Date.now() - days * 864e5) },
        AND: [
          ...words.map((w) => ({
            OR: [
              { body: { contains: w, mode: "insensitive" as const } },
              { subject: { contains: w, mode: "insensitive" as const } },
              { senderName: { contains: w, mode: "insensitive" as const } },
              { chatName: { contains: w, mode: "insensitive" as const } },
            ],
          })),
          ...(person
            ? [{ OR: [{ senderName: { contains: person, mode: "insensitive" as const } }, { chatName: { contains: person, mode: "insensitive" as const } }, { sender: { contains: person, mode: "insensitive" as const } }] }]
            : []),
        ],
      };
      const rows = await prisma.jarvisInbound.findMany({ where, orderBy: { occurredAt: "desc" }, take: 25 });
      if (!rows.length) return "No messages matched.";
      return rows
        .map((m) => `- ${fmt(m.occurredAt.toISOString(), false)} | ${m.source}${m.isGroup ? ` group "${m.chatName}"` : ""} | ${m.direction === "out" ? "You" : m.senderName || m.sender}${m.subject ? ` | ${m.subject}` : ""}: ${m.body.slice(0, 400)}`)
        .join("\n");
    }
    case "list_signals": {
      const rows = await prisma.jarvisSignal.findMany({
        where: { status: { in: ["new", "pushed", "snoozed", "failed"] } },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        take: 25,
      });
      if (!rows.length) return "Nothing waiting on the owner.";
      return rows
        .map((r) => {
          const a = r.action as { type?: string; payload?: { text?: string } } | null;
          return `- ${r.id} | ${r.kind} | score ${r.score} | ${r.title}${r.detail ? `: ${r.detail.slice(0, 200)}` : ""}${a?.type ? ` | proposed: ${a.type}${a.payload?.text ? ` "${a.payload.text.slice(0, 200)}"` : ""}` : ""}`;
        })
        .join("\n");
    }
    case "act_on_signal": {
      const id = s(input.signal_id);
      const action = s(input.action);
      if (action === "approve") return decideSignal(id, { action: "approve", text: s(input.text) || undefined });
      if (action === "dismiss") return decideSignal(id, { action: "dismiss" });
      if (action === "snooze") return decideSignal(id, { action: "snooze", hours: Number(input.hours) || 3 });
      if (action === "undo") return decideSignal(id, { action: "undo" });
      return "action must be approve, dismiss, snooze or undo.";
    }
    case "send_message": {
      const to = s(input.to);
      const text = s(input.text);
      if (!to || !text) return "to and text are required.";
      if (input.channel === "whatsapp") {
        const digits = to.replace(/\D/g, "");
        const thread = await prisma.jarvisInbound.findFirst({
          where: {
            source: "whatsapp",
            OR: [
              ...(digits.length >= 7 ? [{ sender: { contains: digits } }, { threadKey: { contains: digits } }] : []),
              { senderName: { contains: to, mode: "insensitive" } },
              { chatName: { contains: to, mode: "insensitive" } },
            ],
          },
          orderBy: { occurredAt: "desc" },
        });
        if (!thread?.threadKey) return `Error: no WhatsApp chat with "${to}" seen yet. Jarvis only messages chats it has heard.`;
        const job = await enqueueJob("send_message", { channel: "whatsapp", threadKey: thread.threadKey, to, text });
        const done = await waitForJob(job.id, 20000);
        if (done?.status === "failed") return `Error: WhatsApp send failed: ${done.error}`;
        return done ? `SENT on WhatsApp to ${thread.chatName || thread.senderName || to}.` : `Queued for WhatsApp to ${thread.chatName || thread.senderName || to}; it goes out after a short typing pause.`;
      }
      const conns = await prisma.jarvisConnection.findMany({ where: { provider: { in: ["google", "microsoft"] }, status: "active" } });
      const from = s(input.from_account).toLowerCase();
      const conn = conns.find((c) => from && c.account.toLowerCase().includes(from)) || conns.find((c) => c.purpose === "work") || conns[0];
      if (!conn) return "Error: no mailbox connected.";
      if (!/@/.test(to)) {
        const known = await prisma.jarvisInbound.findFirst({ where: { source: { in: ["gmail", "outlook"] }, senderName: { contains: to, mode: "insensitive" } }, orderBy: { occurredAt: "desc" } });
        if (!known?.sender) return `Error: I do not have an email address for "${to}". Give me the address.`;
        input.to = known.sender;
      }
      const job = await enqueueJob("send_message", {
        channel: conn.provider === "google" ? "gmail" : "outlook",
        connectionId: conn.id,
        to: s(input.to),
        subject: s(input.subject),
        text,
      });
      const done = await waitForJob(job.id, 15000);
      if (done?.status === "failed") return `Error: email failed: ${done.error}`;
      return done ? `SENT from ${conn.account} to ${s(input.to)}.` : `Queued: email from ${conn.account} to ${s(input.to)}.`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
