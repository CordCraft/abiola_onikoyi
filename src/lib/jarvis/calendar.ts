import "server-only";
import { prisma } from "@/lib/prisma";

// Read-only calendar access via a private ICS feed URL (Google Calendar:
// Settings -> your calendar -> "Secret address in iCal format"). No OAuth.
// The URL is stored in JarvisSetting under "calendar_ics_url" (or the
// GOOGLE_CALENDAR_ICS_URL env var as a fallback).

export type CalendarEvent = {
  start: Date;
  end: Date | null;
  summary: string;
  location: string | null;
  allDay: boolean;
};

export async function getCalendarUrl(): Promise<string | null> {
  const setting = await prisma.jarvisSetting
    .findUnique({ where: { key: "calendar_ics_url" } })
    .catch(() => null);
  const url = setting?.value?.trim() || process.env.GOOGLE_CALENDAR_ICS_URL?.trim() || "";
  return url.startsWith("http") ? url : null;
}

function unfoldIcs(raw: string): string[] {
  // ICS folds long lines with CRLF + space/tab; unfold before parsing.
  return raw
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
  // 20260711 (all day) | 20260711T093000Z | 20260711T093000 (floating/TZID)
  const allDay = /^\d{8}$/.test(value);
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return isNaN(date.getTime()) ? null : { date, allDay };
}

function unescapeIcs(s: string): string {
  return s.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

export function parseIcs(raw: string): CalendarEvent[] {
  const lines = unfoldIcs(raw);
  const events: CalendarEvent[] = [];
  let cur: Partial<CalendarEvent> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.start && cur.summary) {
        events.push({
          start: cur.start,
          end: cur.end ?? null,
          summary: cur.summary,
          location: cur.location ?? null,
          allDay: cur.allDay ?? false,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const keyPart = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = keyPart.split(";")[0];
    if (key === "DTSTART") {
      const p = parseIcsDate(value);
      if (p) {
        cur.start = p.date;
        cur.allDay = p.allDay;
      }
    } else if (key === "DTEND") {
      const p = parseIcsDate(value);
      if (p) cur.end = p.date;
    } else if (key === "SUMMARY") {
      cur.summary = unescapeIcs(value);
    } else if (key === "LOCATION") {
      cur.location = unescapeIcs(value) || null;
    }
  }
  return events;
}

// Upcoming events within the next `days` days, soonest first.
// Note: recurring events (RRULE) only appear on their original date; a full
// recurrence expansion is out of scope for the ICS feed integration.
export async function getUpcomingEvents(days: number): Promise<CalendarEvent[] | null> {
  const url = await getCalendarUrl();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "abiolaonikoyi.com jarvis" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const now = Date.now();
    const horizon = now + days * 24 * 60 * 60 * 1000;
    return parseIcs(raw)
      .filter((e) => {
        const t = e.start.getTime();
        const endT = e.end?.getTime() ?? t;
        return endT >= now && t <= horizon;
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 40);
  } catch {
    return null;
  }
}

export function formatEvents(events: CalendarEvent[]): string {
  if (!events.length) return "(no upcoming events in this window)";
  const fmtDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
  return events
    .map((e) => {
      const when = e.allDay
        ? `${fmtDay.format(e.start)} (all day)`
        : `${fmtDay.format(e.start)} ${fmtTime.format(e.start)}${e.end ? `-${fmtTime.format(e.end)}` : ""}`;
      return `- ${when}: ${e.summary}${e.location ? ` @ ${e.location}` : ""}`;
    })
    .join("\n");
}
