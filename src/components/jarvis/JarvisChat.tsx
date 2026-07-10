"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Markdown } from "@/components/Markdown";
import { applyProposal, discardProposal } from "@/app/jarvis/actions";

type Msg = { role: "user" | "assistant"; content: string };
type Proposal = { id: string; summary: string; kind: string };

export type Attachment =
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; mimeType: string; base64: string }
  | { kind: "error"; name: string; message: string };

const ACCEPTED =
  ".pdf,.txt,.md,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif" +
  ",.xlsx,.xls,.ods,.docx,.doc,.pptx,.ppt";

// ── Browser-side file processing ──────────────────────────────────────────────
// All heavy lifting happens here so we never send raw binary to the server.
// Netlify functions have a 6 MB body limit; extracted text is far smaller.

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function processFile(file: File): Promise<Attachment> {
  const name = file.name;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  try {
    // ── Excel / ODS ─────────────────────────────────────────────────────────
    if (["xlsx", "xls", "ods"].includes(ext) || file.type.includes("spreadsheet") || file.type.includes("excel")) {
      const mod = await import("xlsx");
      // xlsx is CommonJS; under webpack the API may sit on .default
      const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const data = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(data, { type: "array" });
      const text = wb.SheetNames.map(
        (sn) => `Sheet: ${sn}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`,
      ).join("\n\n---\n\n");
      return { kind: "text", name, text: text || "(empty spreadsheet)" };
    }

    // ── Word (.docx / .doc) ─────────────────────────────────────────────────
    if (["docx", "doc"].includes(ext) || file.type.includes("wordprocessingml") || file.type.includes("msword")) {
      const mod = await import("mammoth");
      const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return { kind: "text", name, text: result.value || "(no text extracted from document)" };
    }

    // ── PowerPoint (.pptx / .ppt) ───────────────────────────────────────────
    if (["pptx", "ppt"].includes(ext) || file.type.includes("presentationml") || file.type.includes("powerpoint")) {
      // PPTX is a ZIP of XML — extract slide text without a zip library by
      // reading the raw bytes and pulling <a:t> text run contents via regex.
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Scan for XML-looking text in the file bytes (slides are not compressed)
      let raw = "";
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] >= 0x20 && bytes[i] < 0x80) raw += String.fromCharCode(bytes[i]);
      }
      const runs = [...raw.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)].map((m) => m[1]);
      const text = runs.join(" ").replace(/\s+/g, " ").trim() || "(no text extracted from presentation)";
      return { kind: "text", name, text };
    }

    // ── PDF ──────────────────────────────────────────────────────────────────
    if (ext === "pdf" || file.type === "application/pdf") {
      const pdfjsLib = await import("pdfjs-dist");
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      }
      const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
      const pdf = await loadingTask.promise;
      const pageTexts: string[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const lineText = content.items
          .map((item: unknown) => {
            const t = item as { str?: string; hasEOL?: boolean };
            return (t.str ?? "") + (t.hasEOL ? "\n" : "");
          })
          .join("");
        pageTexts.push(`[Page ${p}]\n${lineText.trim()}`);
      }
      return { kind: "text", name, text: pageTexts.join("\n\n") };
    }

    // ── Images ───────────────────────────────────────────────────────────────
    const imgTypes: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg",
      png: "image/png", gif: "image/gif", webp: "image/webp",
    };
    if (ext in imgTypes || file.type.startsWith("image/")) {
      if (file.size > 5 * 1024 * 1024) {
        return { kind: "error", name, message: `${name} is too large for an image (max 5 MB). Please resize it.` };
      }
      return {
        kind: "image",
        name,
        mimeType: imgTypes[ext] ?? file.type,
        base64: arrayBufferToBase64(await file.arrayBuffer()),
      };
    }

    // ── Plain text / CSV / JSON / Markdown / YAML ────────────────────────────
    return { kind: "text", name, text: await file.text() };

  } catch (err) {
    return {
      kind: "error",
      name,
      message: `Could not read ${name}: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false); // file extraction in progress
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, proposals, processing]);

  function removeFile(i: number) {
    setPendingFiles((f) => f.filter((_, idx) => idx !== i));
  }

  // ── Voice ─────────────────────────────────────────────────────────────────

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
    if (listening) { stopListening(); return; }

    committedRef.current = input;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SR() as any;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: { results: { isFinal: boolean; [k: number]: { transcript: string } }[]; resultIndex: number }) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          committedRef.current = (committedRef.current + " " + t).trimStart();
        } else {
          interim = t;
        }
      }
      setInput(committedRef.current + (interim ? " " + interim : ""));
      setInterimText(interim);
    };
    rec.onerror = (e: { error: string }) => {
      if (e.error !== "no-speech") setError(`Voice error: ${e.error}`);
      stopListening();
    };
    rec.onend = () => {
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

  // ── Send ──────────────────────────────────────────────────────────────────

  async function send() {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending || processing) return;
    if (listening) { stopListening(); committedRef.current = ""; }

    const filesToProcess = [...pendingFiles];
    setInput("");
    setPendingFiles([]);
    setError(null);

    // Show user message immediately
    const displayContent =
      text +
      (filesToProcess.length
        ? (text ? "\n" : "") + filesToProcess.map((f) => `[attached: ${f.name}]`).join("\n")
        : "");
    setMessages((m) => [...m, { role: "user", content: displayContent }]);

    // Extract file content in browser (may take a moment for large PDFs)
    let attachments: Attachment[] = [];
    if (filesToProcess.length > 0) {
      setProcessing(true);
      attachments = await Promise.all(filesToProcess.map(processFile));
      setProcessing(false);
    }

    setSending(true);
    let assistantIndex = -1; // index of the live assistant message being streamed
    try {
      const res = await fetch("/jarvis/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text, attachments }),
      });

      if (!res.ok) {
        // Error responses come back as plain JSON, not a stream
        let msg = `Server error (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          msg = errData.error || errData.message || msg;
        } catch { /* keep default */ }
        setError(msg);
        setSending(false);
        return;
      }

      if (!res.body) {
        setError("No response stream from server.");
        setSending(false);
        return;
      }

      // Consume the newline-delimited JSON stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";

      const handleEvent = (evt: {
        type: string;
        text?: string;
        threadId?: string;
        reply?: string;
        proposals?: Proposal[];
        error?: string;
      }) => {
        if (evt.type === "meta") {
          if (!threadId && evt.threadId) {
            setThreadId(evt.threadId);
            window.history.replaceState(null, "", `/jarvis/chat?t=${evt.threadId}`);
          }
        } else if (evt.type === "delta" && evt.text) {
          streamedText += evt.text;
          setMessages((m) => {
            const copy = [...m];
            if (assistantIndex === -1) {
              copy.push({ role: "assistant", content: streamedText });
              assistantIndex = copy.length - 1;
            } else {
              copy[assistantIndex] = { role: "assistant", content: streamedText };
            }
            return copy;
          });
        } else if (evt.type === "done") {
          // Finalize text (in case tool calls produced text after deltas)
          const finalReply = evt.reply ?? streamedText;
          setMessages((m) => {
            const copy = [...m];
            if (assistantIndex === -1) {
              copy.push({ role: "assistant", content: finalReply });
            } else {
              copy[assistantIndex] = { role: "assistant", content: finalReply };
            }
            return copy;
          });
          setProposals(
            (evt.proposals ?? []).map((p) => ({ id: p.id, summary: p.summary, kind: p.kind })),
          );
        } else if (evt.type === "error") {
          setError(evt.error ?? "Something went wrong.");
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try { handleEvent(JSON.parse(line)); } catch { /* ignore partial */ }
          }
        }
      }
      // Flush any trailing event
      if (buffer.trim()) {
        try { handleEvent(JSON.parse(buffer.trim())); } catch { /* ignore */ }
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  async function confirm(id: string) {
    const r = await applyProposal(id);
    if (r?.ok) {
      const p = proposals.find((x) => x.id === id);
      setProposals((ps) => ps.filter((x) => x.id !== id));
      setMessages((m) => [...m, { role: "assistant", content: `Saved: ${p?.summary ?? "change"}.` }]);
    } else {
      setError(r?.error ?? "Could not save.");
    }
  }
  async function discard(id: string) {
    await discardProposal(id);
    setProposals((ps) => ps.filter((x) => x.id !== id));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_20px_50px_-24px_rgba(30,27,75,0.28)] backdrop-blur-sm">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
            </span>
            <p className="mt-4 max-w-sm text-sm text-zinc-500">
              Ask anything about your ventures. Attach documents (PDF, Excel, Word, PowerPoint, CSV...) or tap the mic to speak.
            </p>
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-zinc-800 to-zinc-900 px-4 py-2.5 text-sm text-white shadow-sm">
                {m.content}
              </span>
            ) : (
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-zinc-200/80">
                <Markdown tone="light">{m.content}</Markdown>
              </div>
            )}
          </div>
        ))}

        {processing ? (
          <div>
            <span className="inline-block rounded-2xl bg-zinc-50 px-4 py-2 text-sm text-zinc-400 ring-1 ring-zinc-200">
              Reading files...
            </span>
          </div>
        ) : sending ? (
          <div>
            <span className="inline-block rounded-2xl bg-zinc-50 px-4 py-2 text-sm text-zinc-400 ring-1 ring-zinc-200">
              Thinking...
            </span>
          </div>
        ) : null}

        {proposals.length > 0 ? (
          <div className="space-y-2">
            {proposals.map((p) => (
              <div key={p.id} className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50 to-violet-50/60 p-3.5 shadow-sm">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                    {p.kind.replace(/_/g, " ")}
                  </span>
                  <p className="text-sm text-indigo-950">{p.summary}</p>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => confirm(p.id)}
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => discard(p.id)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
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
      <div className="border-t border-zinc-200/70 bg-white/60 p-3 backdrop-blur">
        {/* Attached files */}
        {pendingFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700"
              >
                <svg className="h-3 w-3 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button onClick={() => removeFile(i)} className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-200" aria-label="Remove">
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Listening banner */}
        {listening ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="font-medium">Listening</span>
            {interimText ? (
              <span className="truncate italic text-red-500">{interimText}</span>
            ) : (
              <span className="text-red-400">Speak now...</span>
            )}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="hidden"
            onChange={(e) => {
              // Capture files synchronously BEFORE clearing the input, otherwise
              // the deferred state updater reads an already-emptied file list.
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setPendingFiles((prev) => [...prev, ...picked]);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            className="shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (!listening) committedRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            rows={2}
            placeholder={listening ? "Listening... (your words appear here)" : "Message Jarvis..."}
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
          />

          <button
            type="button"
            onClick={toggleVoice}
            title={listening ? "Stop recording" : "Speak to Jarvis"}
            className={`shrink-0 rounded-lg p-2 transition-colors ${
              listening ? "bg-red-100 text-red-600 hover:bg-red-200" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
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
            disabled={sending || processing || (!input.trim() && pendingFiles.length === 0)}
            className="shrink-0 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
