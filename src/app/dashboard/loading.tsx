import { Spinner } from "@/components/mentorship/Spinner";

// Instant feedback while dashboard pages fetch from the database.
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <Spinner className="h-8 w-8 text-zinc-500" />
      <p className="text-sm text-zinc-500">Loading…</p>
    </div>
  );
}
