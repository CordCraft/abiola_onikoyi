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
