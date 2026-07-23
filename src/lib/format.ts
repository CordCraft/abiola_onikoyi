// Deterministic date formatting (fixed locale) to avoid SSR/client mismatch.
const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return fmt.format(date);
}

// Mentorship times are shown in West Africa Time (the cohort is in Lagos);
// a fixed zone also keeps SSR and client output identical.
const fmtDateTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Africa/Lagos",
});

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${fmtDateTime.format(date)} WAT`;
}
