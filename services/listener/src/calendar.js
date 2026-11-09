import { listConnections, api } from './accounts.js';
import { getSetting } from './db.js';

// Both calendars: Outlook (Microsoft 365) for official work, Google for personal and family.
// Which account is which comes from JarvisSetting "calendar_routing" ({ work, personal } ->
// connection ids), falling back to the first Microsoft account for work and the first Google
// account for personal.

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export async function routeCalendar(purpose) {
  const routing = (await getSetting('calendar_routing', {})) || {};
  const [google, microsoft] = await Promise.all([listConnections('google'), listConnections('microsoft')]);
  const all = [...google, ...microsoft];
  const chosen = all.find((c) => c.id === routing[purpose]);
  if (chosen) return chosen;
  if (purpose === 'work') return microsoft[0] || google[0] || null;
  return google[0] || microsoft[0] || null;
}

// Events from every connected calendar between two dates, normalised and sorted.
export async function listEvents(from, to) {
  const [google, microsoft] = await Promise.all([listConnections('google'), listConnections('microsoft')]);
  const out = [];
  for (const conn of google) {
    try {
      const res = await api(conn, `${GCAL}?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}`);
      for (const e of res.items || []) {
        if (e.status === 'cancelled') continue;
        out.push({
          id: e.id, connectionId: conn.id, provider: 'google', account: conn.account, purpose: conn.purpose,
          title: e.summary || '(no title)',
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          allDay: !!e.start?.date,
          location: e.location || null,
          byJarvis: e.extendedProperties?.private?.jarvis === '1',
        });
      }
    } catch (e) {
      console.error(`[calendar] google ${conn.account}:`, e.message);
    }
  }
  for (const conn of microsoft) {
    try {
      const res = await api(conn, `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$top=100&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,location,showAs,isCancelled,categories`, {
        headers: { Prefer: 'outlook.timezone="UTC"' },
      });
      for (const e of res.value || []) {
        if (e.isCancelled) continue;
        out.push({
          id: e.id, connectionId: conn.id, provider: 'microsoft', account: conn.account, purpose: conn.purpose,
          title: e.subject || '(no title)',
          start: e.start?.dateTime ? e.start.dateTime + 'Z' : null,
          end: e.end?.dateTime ? e.end.dateTime + 'Z' : null,
          allDay: !!e.isAllDay,
          location: e.location?.displayName || null,
          byJarvis: (e.categories || []).includes('Jarvis'),
        });
      }
    } catch (e) {
      console.error(`[calendar] microsoft ${conn.account}:`, e.message);
    }
  }
  return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

// Create an event. `when` uses ISO strings with offsets; all-day events use YYYY-MM-DD.
// Jarvis-made events are tagged so the planner and undo can recognise them.
export async function createEvent({ purpose = 'personal', title, start, end, allDay = false, location, description, tentative = true, tz = 'Asia/Kuwait' }) {
  const conn = await routeCalendar(purpose);
  if (!conn) throw new Error('no calendar connected');
  const note = [description, 'Added by Jarvis'].filter(Boolean).join('\n\n');
  if (conn.provider === 'google') {
    const body = {
      summary: title,
      location: location || undefined,
      description: note,
      start: allDay ? { date: start.slice(0, 10) } : { dateTime: start, timeZone: tz },
      end: allDay ? { date: (end || start).slice(0, 10) } : { dateTime: end || start, timeZone: tz },
      status: tentative ? 'tentative' : 'confirmed',
      extendedProperties: { private: { jarvis: '1' } },
      reminders: { useDefault: true },
    };
    const ev = await api(conn, GCAL, { method: 'POST', body: JSON.stringify(body) });
    return { provider: 'google', connectionId: conn.id, account: conn.account, eventId: ev.id, link: ev.htmlLink };
  }
  const body = {
    subject: title,
    body: { contentType: 'Text', content: note },
    location: location ? { displayName: location } : undefined,
    isAllDay: allDay,
    start: allDay ? { dateTime: `${start.slice(0, 10)}T00:00:00`, timeZone: tz } : { dateTime: toLocalNaive(start, tz), timeZone: tz },
    end: allDay ? { dateTime: `${(end || start).slice(0, 10)}T00:00:00`, timeZone: tz } : { dateTime: toLocalNaive(end || start, tz), timeZone: tz },
    showAs: tentative ? 'tentative' : 'busy',
    categories: ['Jarvis'],
  };
  const ev = await api(conn, `${GRAPH}/me/events`, { method: 'POST', body: JSON.stringify(body) });
  return { provider: 'microsoft', connectionId: conn.id, account: conn.account, eventId: ev.id, link: ev.webLink };
}

export async function deleteEvent({ provider, connectionId, eventId }) {
  const conns = await listConnections(provider);
  const conn = conns.find((c) => c.id === connectionId);
  if (!conn) throw new Error('calendar account no longer connected');
  if (provider === 'google') return api(conn, `${GCAL}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  return api(conn, `${GRAPH}/me/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
}

// Graph wants a wall-clock time plus a zone name; turn an ISO instant into that zone's clock time.
function toLocalNaive(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:${g('second')}`;
}
