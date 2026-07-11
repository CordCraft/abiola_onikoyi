export default function JarvisLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500" />
        Loading Jarvis...
      </div>
    </div>
  );
}
