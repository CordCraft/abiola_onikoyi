"use client";

import { useActionState, useState, useRef, useEffect } from "react";
import {
  POST_CATEGORIES,
  POST_KINDS,
  POST_KIND_LABELS,
} from "@/lib/blog-constants";
import { updatePost, type FormResult } from "@/app/dashboard/blog/actions";
import {
  chatAboutPost,
  type ChatMessage,
  type Revision,
} from "@/app/dashboard/blog/chat-actions";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";
const labelClass = "block text-sm font-medium text-zinc-700";

export type PostEditorValues = {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  category: string;
  kind: string;
  metaDescription: string;
  keywords: string;
  imageUrl: string;
  imageAlt: string;
  sourceUrl: string;
  sourceName: string;
  published: boolean;
};

export function PostEditor({ post }: { post: PostEditorValues }) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    updatePost,
    undefined,
  );

  // Controlled fields (so the chatbot can rewrite them).
  const [title, setTitle] = useState(post.title);
  const [excerpt, setExcerpt] = useState(post.excerpt);
  const [body, setBody] = useState(post.body);
  const [metaDescription, setMetaDescription] = useState(post.metaDescription);
  const [keywords, setKeywords] = useState(post.keywords);
  const [imageUrl, setImageUrl] = useState(post.imageUrl);
  const [imageAlt, setImageAlt] = useState(post.imageAlt);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pendingRevision, setPendingRevision] = useState<Revision | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setChatError(null);
    const history = messages;
    setMessages([...history, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await chatAboutPost({
        draft: { title, excerpt, body, metaDescription },
        history,
        message: text,
      });
      if (res.error) {
        setChatError(res.error);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
        if (res.revised) setPendingRevision(res.revised);
      }
    } catch {
      setChatError("Something went wrong talking to the assistant.");
    } finally {
      setSending(false);
    }
  }

  function applyRevision() {
    if (!pendingRevision) return;
    setTitle(pendingRevision.title);
    setExcerpt(pendingRevision.excerpt);
    setBody(pendingRevision.body);
    setMetaDescription(pendingRevision.metaDescription);
    setPendingRevision(null);
    setMessages((m) => [
      ...m,
      { role: "assistant", content: "✓ Applied to the editor. Review and Save." },
    ]);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      {/* Editor form */}
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="id" value={post.id} />

        <div>
          <label htmlFor="title" className={labelClass}>Title</label>
          <input id="title" name="title" required value={title}
            onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label htmlFor="excerpt" className={labelClass}>Excerpt</label>
          <input id="excerpt" name="excerpt" value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)} className={inputClass} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className={labelClass}>Category</label>
            <select id="category" name="category" defaultValue={post.category} className={inputClass}>
              {POST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="kind" className={labelClass}>Type</label>
            <select id="kind" name="kind" defaultValue={post.kind} className={inputClass}>
              {POST_KINDS.map((k) => <option key={k} value={k}>{POST_KIND_LABELS[k]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="body" className={labelClass}>Body (markdown)</label>
          <textarea id="body" name="body" rows={18} required value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`${inputClass} font-mono text-sm`} />
        </div>

        <fieldset className="rounded-xl border border-zinc-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            SEO & image
          </legend>
          <div className="space-y-4">
            <div>
              <label htmlFor="metaDescription" className={labelClass}>
                Meta description
              </label>
              <input id="metaDescription" name="metaDescription" value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="keywords" className={labelClass}>Keywords (comma-separated)</label>
              <input id="keywords" name="keywords" value={keywords}
                onChange={(e) => setKeywords(e.target.value)} className={inputClass} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="imageUrl" className={labelClass}>Image URL</label>
                <input id="imageUrl" name="imageUrl" type="url" value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="imageAlt" className={labelClass}>Image alt text</label>
                <input id="imageAlt" name="imageAlt" value={imageAlt}
                  onChange={(e) => setImageAlt(e.target.value)} className={inputClass} />
              </div>
            </div>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={imageAlt} className="h-32 w-full rounded-lg border border-zinc-200 object-cover" />
            ) : null}
          </div>
        </fieldset>

        {/* News source (kept) */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="sourceName" className={labelClass}>Source name <span className="text-zinc-400">(news)</span></label>
            <input id="sourceName" name="sourceName" defaultValue={post.sourceName} className={inputClass} />
          </div>
          <div>
            <label htmlFor="sourceUrl" className={labelClass}>Source URL <span className="text-zinc-400">(news)</span></label>
            <input id="sourceUrl" name="sourceUrl" type="url" defaultValue={post.sourceUrl} className={inputClass} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input type="checkbox" name="published" defaultChecked={post.published}
            className="h-4 w-4 rounded border-zinc-300" />
          Published (visible on the public site)
        </label>

        {state?.error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        ) : null}
        {state?.ok ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Saved.</p>
        ) : null}

        <button type="submit" disabled={pending}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60">
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>

      {/* Chat assistant */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="flex h-[36rem] flex-col rounded-2xl border border-zinc-200 bg-zinc-50">
          <div className="border-b border-zinc-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-900">Editing assistant</h3>
            <p className="text-xs text-zinc-500">
              Ask Claude to improve the article. Apply its rewrite, then Save.
            </p>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="text-xs text-zinc-400">
                Try: “Make it more concise”, “Add a stronger opening”, or “Tighten
                the SEO title and meta description”.
              </p>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <span
                  className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-zinc-900 text-white"
                      : "bg-white text-zinc-800 ring-1 ring-zinc-200"
                  }`}
                >
                  {m.content}
                </span>
              </div>
            ))}
            {sending ? (
              <div>
                <span className="inline-block rounded-2xl bg-white px-3 py-2 text-sm text-zinc-400 ring-1 ring-zinc-200">
                  Thinking…
                </span>
              </div>
            ) : null}
            {pendingRevision ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs text-indigo-900">
                  The assistant proposed a rewrite.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={applyRevision}
                    className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Apply to editor
                  </button>
                  <button
                    onClick={() => setPendingRevision(null)}
                    className="rounded-md px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}
            {chatError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{chatError}</p>
            ) : null}
          </div>

          <div className="border-t border-zinc-200 p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Ask the assistant…"
              className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="mt-2 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
