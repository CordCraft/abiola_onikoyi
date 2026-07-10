"use client";

import { useState, useRef, useEffect } from "react";
import { Markdown } from "@/components/Markdown";
import { applyProposal, discardProposal } from "@/app/jarvis/actions";

type Msg = { role: "user" | "assistant"; content: string };
type Proposal = { id: string; summary: string; kind: string };

export function JarvisChat({
  initialThreadId,
  initialMessages,
  initialProposals,
}: {
  initialThreadId: string | null;
  initialMessages: Msg[];
  initialProposals: Proposal[];
}) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, proposals]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/jarvis/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Request failed.");
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
        setProposals(
          (data.proposals ?? []).map((p: Proposal) => ({
            id: p.id,
            summary: p.summary,
            kind: p.kind,
          })),
        );
        if (!threadId && data.threadId) {
          setThreadId(data.threadId);
          window.history.replaceState(null, "", `/jarvis/chat?t=${data.threadId}`);
        }
      }
    } catch {
      setError("Network error.");
    } finally {
      setSending(false);
    }
  }

  async function confirm(id: string) {
    const r = await applyProposal(id);
    if (r?.ok) {
      const p = proposals.find((x) => x.id === id);
      setProposals((ps) => ps.filter((x) => x.id !== id));
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `✓ Saved: ${p?.summary ?? "change"}.` },
      ]);
    } else {
      setError(r?.error ?? "Could not save.");
    }
  }
  async function discard(id: string) {
    await discardProposal(id);
    setProposals((ps) => ps.filter((x) => x.id !== id));
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col rounded-2xl border border-zinc-200 bg-white">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Ask anything about your ventures. Try “what’s stalled and what should I
            tackle first?” or “add a task to draft the Rwanda equity structure by Friday”.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white">
                {m.content}
              </span>
            ) : (
              <div className="max-w-[92%] rounded-2xl bg-zinc-50 px-4 py-3 text-sm ring-1 ring-zinc-200">
                <Markdown tone="light">{m.content}</Markdown>
              </div>
            )}
          </div>
        ))}
        {sending ? (
          <div>
            <span className="inline-block rounded-2xl bg-zinc-50 px-4 py-2 text-sm text-zinc-400 ring-1 ring-zinc-200">
              Thinking…
            </span>
          </div>
        ) : null}

        {proposals.length > 0 ? (
          <div className="space-y-2">
            {proposals.map((p) => (
              <div key={p.id} className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-sm text-indigo-900">{p.summary}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => confirm(p.id)}
                    className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => discard(p.id)}
                    className="rounded-md px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}
      </div>

      <div className="border-t border-zinc-200 p-3">
        <div className="flex items-end gap-2">
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
            placeholder="Message Jarvis…"
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
