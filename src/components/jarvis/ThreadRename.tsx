"use client";

import { renameThread } from "@/app/jarvis/actions";

// Small pencil button that renames a thread via a browser prompt.
export function ThreadRename({ id, title }: { id: string; title: string }) {
  return (
    <button
      type="button"
      aria-label="Rename conversation"
      className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
      onClick={() => {
        const next = window.prompt("Rename conversation", title);
        if (next && next.trim() && next.trim() !== title) {
          const f = new FormData();
          f.set("id", id);
          f.set("title", next.trim());
          void renameThread(f);
        }
      }}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897l12.682-12.68z" />
      </svg>
    </button>
  );
}
