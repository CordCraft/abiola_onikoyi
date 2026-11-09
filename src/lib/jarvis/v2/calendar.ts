import "server-only";
import type { JarvisConnection } from "@prisma/client";
import { listConnections, providerFetch } from "@/lib/jarvis/v2/connections";

// Read both calendars (Google personal, Outlook work) for the Today screen and chat.
// Writes go through the job queue so the listener is the single writer.

export type V2Event = {
  id: string;
  provider: "google" | "microsoft";
  account: string;
  purpose: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
};

type GoogleEvents = { items?: { id: string; status?: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[] };
type GraphEvents = { value?: { id: string; subject?: string; isAllDay?: boolean; isCancelled?: boolean; location?: { displayName?: string }; start?: { dateTime?: string }; end?: { dateTime?: string } }[] };

async function googleEvents(conn: JarvisConnection, from: Date, to: Date): Promise<V2Event[]> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}`;
  const res = await providerFetch<GoogleEvents>(conn, url);
  return (res.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      id: e.id,
      provider: "google" as const,
      account: conn.account,
      purpose: conn.purpose,
      title: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || null,
      allDay: !!e.start?.date,
      location: e.location ?? null,
    }));
}

async function graphEvents(conn: JarvisConnection, from: Date, to: Date): Promise<V2Event[]> {
  const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$top=100&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,location,isCancelled`;
  const res = await providerFetch<GraphEvents>(conn, url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
  return (res.value ?? [])
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      id: e.id,
      provider: "microsoft" as const,
      account: conn.account,
      purpose: conn.purpose,
      title: e.subject || "(no title)",
      start: e.start?.dateTime ? `${e.start.dateTime}Z` : "",
      end: e.end?.dateTime ? `${e.end.dateTime}Z` : null,
      allDay: !!e.isAllDay,
      location: e.location?.displayName || null,
    }));
}

export async function listAllEvents(from: Date, to: Date): Promise<{ events: V2Event[]; connected: number; errors: string[] }> {
  const conns = (await listConnections()).filter((c) => (c.provider === "google" || c.provider === "microsoft") && c.status !== "paused");
  const errors: string[] = [];
  const results = await Promise.all(
    conns.map((c) =>
      (c.provider === "google" ? googleEvents(c, from, to) : graphEvents(c, from, to)).catch((e: Error) => {
        errors.push(`${c.account}: ${e.message}`);
        return [] as V2Event[];
      }),
    ),
  );
  const events = results.flat().sort((a, b) => a.start.localeCompare(b.start));
  return { events, connected: conns.length, errors };
}
