"use client";

import { useActionState } from "react";
import {
  POST_CATEGORIES,
  POST_KINDS,
  POST_KIND_LABELS,
} from "@/lib/blog-constants";
import type { FormResult } from "@/app/dashboard/blog/actions";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";
const labelClass = "block text-sm font-medium text-zinc-700";

export type PostFormValues = {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  category: string;
  kind: string;
  sourceUrl: string | null;
  sourceName: string | null;
  published: boolean;
};

export function PostForm({
  action,
  post,
  submitLabel,
}: {
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  post?: PostFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    action,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-5">
      {post ? <input type="hidden" name="id" value={post.id} /> : null}

      <div>
        <label htmlFor="title" className={labelClass}>
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={post?.title ?? ""}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="excerpt" className={labelClass}>
          Excerpt
        </label>
        <input
          id="excerpt"
          name="excerpt"
          defaultValue={post?.excerpt ?? ""}
          placeholder="One-sentence summary shown in the list."
          className={inputClass}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="category" className={labelClass}>
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={post?.category ?? POST_CATEGORIES[0]}
            className={inputClass}
          >
            {POST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="kind" className={labelClass}>
            Type
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue={post?.kind ?? "insight"}
            className={inputClass}
          >
            {POST_KINDS.map((k) => (
              <option key={k} value={k}>
                {POST_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="body" className={labelClass}>
          Body (markdown)
        </label>
        <textarea
          id="body"
          name="body"
          rows={16}
          required
          defaultValue={post?.body ?? ""}
          className={`${inputClass} font-mono text-sm`}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="sourceName" className={labelClass}>
            Source name <span className="text-zinc-400">(news only)</span>
          </label>
          <input
            id="sourceName"
            name="sourceName"
            defaultValue={post?.sourceName ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="sourceUrl" className={labelClass}>
            Source URL <span className="text-zinc-400">(news only)</span>
          </label>
          <input
            id="sourceUrl"
            name="sourceUrl"
            type="url"
            defaultValue={post?.sourceUrl ?? ""}
            className={inputClass}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
        <input
          type="checkbox"
          name="published"
          defaultChecked={post?.published ?? false}
          className="h-4 w-4 rounded border-zinc-300"
        />
        Published (visible on the public site)
      </label>

      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Saved.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
