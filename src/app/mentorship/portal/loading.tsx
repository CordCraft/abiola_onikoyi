import { Spinner } from "@/components/mentorship/Spinner";

// Instant feedback while portal pages fetch from the database.
export default function PortalLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <Spinner className="h-8 w-8 text-accent" />
      <p className="text-sm text-zinc-400">Loading your portal…</p>
    </div>
  );
}
