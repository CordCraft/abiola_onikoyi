"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Markdown } from "@/components/Markdown";
import { applyProposal, discardProposal } from "@/app/jarvis/actions";

type Msg = { role: "user" | "assistant"; content: string };
type Proposal = { id: string; summary: string; kind: string };

// All file types Jarvis can handle
const ACCEPTED = ".pdf,.txt,.md,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.ods,.docx,.doc,.pptx,.ppt";

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
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  // Voice state
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState(""); // live transcript shown as placeholder
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const committedRef = useRef(""); // accumulated final transcripts during this session

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, proposals]);

  function removeFile(index: number) {
    setFiles((f) => f.filter((_, i) => i !== index));
  }

  // ── Voice ────────────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterimText("");
  }, []);

  function toggleVoice() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Voice input is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    if (listening) {
      stopListening();
      return;
    }

    committedRef.current = input; // preserve anything already typed

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SR() as any;
    rec.lang = "en-US";
    rec.interimResults = true;  // stream partial results
    rec.continuous = true;       // keep going through pauses
    rec.maxAlternatives = 1;

    rec.onresult = (e: { results: { isFinal: boolean; [k: number]: { transcript: string } }[]; resultIndex: number }) => {
      let interim = "";
      // Walk only new results from resultIndex onward
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          // Append to the committed buffer with a space
          committedRef.current =
            (committedRef.current + " " + transcript).trimStart();
        } else {
          interim = transcript;
        }
      }
      // Update textarea with committed + current interim
      setInput(committedRef.current + (interim ? " " + interim : ""));
      setInterimText(interim);
    };

    rec.onerror = (e: { error: string }) => {
      if (e.error !== "no-speech") {
        setError(`Voice error: ${e.error}`);
      }
      stopListening();
    };

    rec.onend = () => {
      // continuous mode: restart unless the user clicked stop
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch { /* already started */ }
      } else {
        setListening(false);
        setInterimText("");
      }
    };

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async function send() {
    const text = input.trim();
    if ((!text && files.length === 0) || sending) return;

    // Stop voice if active before sending
    if (listening) stopListening();
    committedRef.current = "";

    const attachedFiles = [...files];
    setInput("");
    setFiles([]);
    setError(null);

    const displayContent =
      text +
      (attachedFiles.length
        ? (text ? "\n" : "") + attachedFiles.map((f) => `[attached: ${f.name}]`).join("\n")
        : "");
    setMessages((m) => [...m, { role: "user", content: displayContent }]);
    setSending(true);

    try {
      let res: Response;
      if (attachedFiles.length > 0) {
        const fd = new FormData();
        if (threadId) fd.append("threadId", threadId);
        fd.append("message", text);
        attachedFiles.forEach((f) => fd.append("files", f));
        res = await fetch("/jarvis/api/chat", { method: "POST", body: fd });
      } else {
        res = await fetch("/jarvis/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, message: text }),
        });
      }

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
        { role: "assistant", content: `Saved: ${p?.summary ?? "change"}.` },
      ]);
    } else {
      setError(r?.error ?? "Could not save.");
    }
  }
  async function discard(id: string) {
    await discardProposal(id);
    setProposals((ps) => ps.filter((x) => x.id !== id));
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col rounded-2xl border border-zinc-200 bg-white">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Ask anything about your ventures. Attach documents (PDF, Excel, Word, PowerPoint, CSV...) or click the mic to speak.
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
              Thinking...
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

      {/* Input area */}
      <div className="border-t border-zinc-200 p-3">
        {/* Attached files */}
        {files.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700"
              >
                <svg className="h-3 w-3 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-200"
                  aria-label="Remove file"
                >
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Listening banner with live interim transcript */}
        {listening ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="font-medium">Listening</span>
            {interimText ? (
              <span className="truncate text-red-500 italic">{interimText}</span>
            ) : (
              <span className="text-red-400">Speak now...</span>
            )}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles((prev) => [...prev, ...picked]);
              e.target.value = "";
            }}
          />

          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file (PDF, Excel, Word, PowerPoint, image, CSV...)"
            className="shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (!listening) committedRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={listening ? "Listening... (your words appear here)" : "Message Jarvis..."}
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
          />

          {/* Mic button */}
          <button
            type="button"
            onClick={toggleVoice}
            title={listening ? "Stop recording" : "Speak to Jarvis (continuous, pause-tolerant)"}
            className={`shrink-0 rounded-lg p-2 transition-colors ${
              listening
                ? "bg-red-100 text-red-600 hover:bg-red-200"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {listening ? (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
              </svg>
            )}
          </button>

          <button
            onClick={() => void send()}
            disabled={sending || (!input.trim() && files.length === 0)}
            className="shrink-0 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
