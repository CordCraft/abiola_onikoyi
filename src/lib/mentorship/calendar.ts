// "Add to Google Calendar" links for mentorship sessions. Pure string work,
// safe on server and client.

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function googleCalendarUrl(input: {
  title: string;
  start: Date;
  minutes?: number;
  details?: string | null;
  location?: string | null;
}): string {
  const end = new Date(input.start.getTime() + (input.minutes ?? 60) * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${stamp(input.start)}/${stamp(end)}`,
    ctz: "Africa/Lagos",
  });
  if (input.details) params.set("details", input.details);
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// "Saturday 5 December 2026" in Lagos time.
const longDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// Plan dates and cohort start dates are stored as the Lagos calendar date at
// UTC midnight, so they format in UTC.
export function formatLongDate(d: Date): string {
  return longDate.format(d);
}
