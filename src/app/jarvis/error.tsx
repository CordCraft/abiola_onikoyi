"use client";

// Friendly error boundary for the Jarvis area. The most common cause is the
// Neon free tier waking from suspend, which a retry fixes.
export default function JarvisError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-600">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </span>
      <h2 className="mt-4 text-lg font-semibold text-zinc-900">Jarvis hit a snag</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        Usually this is the database waking up from sleep. A retry almost always fixes it.
      </p>
      <button
        onClick={() => reset()}
        className="mt-5 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700"
      >
        Try again
      </button>
    </div>
  );
}
