import { Spinner } from "@/components/mentorship/Spinner";

// Instant feedback while blog pages fetch posts.
export default function BlogLoading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Spinner className="h-8 w-8 text-zinc-400" />
      <p className="text-sm text-zinc-500">Loading…</p>
    </div>
  );
}
