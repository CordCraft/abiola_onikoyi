"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Markdown } from "@/components/Markdown";
import { undoRecord } from "@/app/jarvis/actions";

type Msg = { role: "user" | "assistant"; content: string };
type SavedRecord = {
  kind: string;
  id: string;
  summary: string;
  undoable: boolean;
  undone?: boolean;
};
type ChatItem =
  | { kind: "msg"; role: "user" | "assistant"; content: string }
  | { kind: "receipts"; records: SavedRecord[] };

export type Attachment =
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; mimeType: string; base64: string }
  | { kind: "error"; name: string; message: string };

const ACCEPTED =
  ".pdf,.txt,.md,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif" +
  ",.xlsx,.xls,.ods,.docx,.pptx";

// Base64 inflates by 4/3 and Netlify caps request bodies at 6 MB.
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;

const WAKE_RE = /(?:^|\s)(?:hey[,.\s]+)?(?:jarvis|jervis|jarvus|jarves|travis)\b[,.!?]*\s*/i;

// ── Browser-side file processing ─────────────────────────────────────────────
// All extraction happens client-side; only extracted text/base64 travels to the
// server (Netlify functions cap bodies at 6MB).

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function capText(name: string, text: string): Attachment {
  if (text.length > MAX_TEXT_CHARS) {
    return {
      kind: "text",
      name,
      text: text.slice(0, MAX_TEXT_CHARS) + "\n\n[truncated: file was larger than the upload limit]",
    };
  }
  return { kind: "text", name, text };
}

async function processFile(file: File): Promise<Attachment> {
  const name = file.name;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  // Legacy binary Office formats have no browser parser here.
  if (ext === "doc" || ext === "ppt") {
    return {
      kind: "error",
      name,
      message: `${name}: legacy .${ext} files are not supported. Re-save as .${ext}x or PDF.`,
    };
  }

  try {
    // Excel / ODS
    if (["xlsx", "xls", "ods"].includes(ext) || file.type.includes("spreadsheet") || file.type.includes("excel")) {
      const mod = await import("xlsx");
      const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const data = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(data, { type: "array" });
      const text = wb.SheetNames.map(
        (sn) => `Sheet: ${sn}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`,
      ).join("\n\n---\n\n");
      return capText(name, text || "(empty spreadsheet)");
    }

    // Word
    if (["docx", "doc"].includes(ext) || file.type.includes("wordprocessingml") || file.type.includes("msword")) {
      const mod = await import("mammoth");
      const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return capText(name, result.value || "(no text extracted from document)");
    }

    // PowerPoint (pptx is a ZIP of XML; use jszip to read slide XML properly)
    if (["pptx", "ppt"].includes(ext) || file.type.includes("presentationml") || file.type.includes("powerpoint")) {
      const mod = await import("jszip");
      const JSZip = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const zip = await (JSZip as unknown as { loadAsync: (d: ArrayBuffer) => Promise<{ files: Record<string, { async: (t: "string") => Promise<string> }> }> }).loadAsync(
        await file.arrayBuffer(),
      );
      const slideNames = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
          const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
          return na - nb;
        });
      const texts: string[] = [];
      for (const sn of slideNames) {
        const xml = await zip.files[sn].async("string");
        const runs = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
          .map((m) => m[1])
          .filter(Boolean);
        if (runs.length) texts.push(`[Slide ${texts.length + 1}]\n${runs.join(" ")}`);
      }
      return capText(name, texts.join("\n\n") || "(no text found in presentation)");
    }

    // PDF
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
      return capText(name, pageTexts.join("\n\n"));
    }

    // Images
    const imgTypes: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg",
      png: "image/png", gif: "image/gif", webp: "image/webp",
    };
    if (ext in imgTypes || file.type.startsWith("image/")) {
      if (file.size > MAX_IMAGE_BYTES) {
        return { kind: "error", name, message: `${name} is too large for an image (max 3.5 MB).` };
      }
      return {
        kind: "image",
        name,
        mimeType: imgTypes[ext] ?? file.type,
        base64: arrayBufferToBase64(await file.arrayBuffer()),
      };
    }

    // Plain text and everything else that reads as text
    return capText(name, await file.text());
  } catch (err) {
    return {
      kind: "error",
      name,
      message: `Could not read ${name}: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

// ── Text-to-speech helpers ───────────────────────────────────────────────────

function stripMarkdownForSpeech(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, ", ")
    .replace(/\[saved:[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkSentences(text: string, maxLen = 220): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).length > maxLen && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur = cur ? cur + " " + s : s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

type VoicePhase = "standby" | "capturing" | "thinking" | "speaking";

// ── Component ─────────────────────────────────────────────────────────────────

export function JarvisChat({
  initialThreadId,
  initialMessages,
}: {
  initialThreadId: string | null;
  initialMessages: Msg[];
}) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [items, setItems] = useState<ChatItem[]>(
    initialMessages.map((m) => ({ kind: "msg" as const, ...m })),
  );
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dictation (push-to-talk into the textarea)
  const [dictating, setDictating] = useState(false);
  const [interimText, setInterimText] = useState("");

  // Hands-free voice mode
  const [voiceMode, setVoiceMode] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("standby");
  const [voiceLive, setVoiceLive] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const committedRef = useRef("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const shouldListenRef = useRef(false);
  const voiceModeRef = useRef(false);
  const phaseRef = useRef<VoicePhase>("standby");
  const captureBufRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakGenRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef = useRef<any>(null);
  const threadIdRef = useRef(initialThreadId);
  threadIdRef.current = threadId;
  const sendingRef = useRef(false);
  // The recognition callbacks are created once (useCallback with []), so they
  // must reach the CURRENT render's send() through a ref, or voice sends run
  // with permanently stale state (empty attachments, broken in-flight guard).
  const sendRef = useRef<(overrideText?: string, opts?: { voice?: boolean }) => Promise<void>>(
    async () => {},
  );

  const setPhase = useCallback((p: VoicePhase) => {
    phaseRef.current = p;
    setVoicePhase(p);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, sending, processing, voicePhase]);

  function speechAvailable(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  }

  // ── Recognition core (shared by dictation and hands-free) ─────────────────

  const stopRecognition = useCallback(() => {
    shouldListenRef.current = false;
    try { recRef.current?.stop(); } catch { /* not started */ }
    recRef.current = null;
  }, []);

  const startRecognition = useCallback((mode: "dictation" | "voice") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return false;

    stopRecognition();
    shouldListenRef.current = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SR() as any;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    // Android Chrome can re-deliver already-final results; never re-process
    // below this high-water mark.
    let lastFinal = -1;

    rec.onresult = (e: {
      results: { isFinal: boolean; [k: number]: { transcript: string } }[];
      resultIndex: number;
    }) => {
      let interim = "";
      const finals: string[] = [];
      for (let i = Math.max(e.resultIndex, lastFinal + 1); i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finals.push(t);
          lastFinal = i;
        } else {
          interim += t;
        }
      }

      if (mode === "dictation") {
        for (const f of finals) {
          committedRef.current = (committedRef.current + " " + f).trimStart();
        }
        setInput(committedRef.current + (interim ? " " + interim : ""));
        setInterimText(interim);
        return;
      }

      // Hands-free mode
      const phase = phaseRef.current;
      if (phase === "thinking" || phase === "speaking") return;

      if (phase === "standby") {
        const probe = (finals.join(" ") + " " + interim).trim();
        const m = probe.match(WAKE_RE);
        if (m) {
          captureBufRef.current = "";
          setPhase("capturing");
          // Whatever followed the wake word in already-final text starts the buffer
          for (const f of finals) {
            const fm = f.match(WAKE_RE);
            if (fm) {
              const after = f.slice((fm.index ?? 0) + fm[0].length).trim();
              if (after) captureBufRef.current += (captureBufRef.current ? " " : "") + after;
            }
          }
          setVoiceLive(captureBufRef.current);
          armSilenceTimer();
          // A bare wake word with no command must fall back to standby
          armFollowupWindow();
        }
        return;
      }

      // capturing
      for (const f of finals) {
        const cleaned = f.replace(WAKE_RE, " ").trim();
        if (cleaned) {
          captureBufRef.current += (captureBufRef.current ? " " : "") + cleaned;
        }
      }
      setVoiceLive(
        captureBufRef.current + (interim ? " " + interim.replace(WAKE_RE, " ") : ""),
      );
      if (finals.length || interim) {
        armSilenceTimer();
        // The user is speaking: keep the follow-up window open mid-utterance
        armFollowupWindow();
      }
    };

    rec.onerror = (e: { error: string }) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow it in your browser settings.");
        shouldListenRef.current = false;
        if (mode === "voice") exitVoiceMode();
        else setDictating(false);
      }
      // no-speech / aborted / network: the onend restart handles recovery
    };

    rec.onend = () => {
      lastFinal = -1; // a fresh recognition session re-numbers its results
      if (shouldListenRef.current && recRef.current === rec) {
        // Auto-restart: continuous recognition ends on its own on many platforms
        setTimeout(() => {
          if (shouldListenRef.current && recRef.current === rec) {
            try { rec.start(); } catch { /* already started */ }
          }
        }, 250);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      return false;
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Silence detection for hands-free capture ──────────────────────────────

  const armSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      const text = captureBufRef.current.trim();
      if (phaseRef.current !== "capturing") return;
      if (text) {
        captureBufRef.current = "";
        setVoiceLive("");
        if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
        void sendRef.current(text, { voice: true });
      }
    }, 1300);
  }, []);

  const armFollowupWindow = useCallback(() => {
    if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
    followupTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "capturing" && !captureBufRef.current.trim()) {
        setPhase("standby");
        setVoiceLive("");
      }
    }, 8000);
  }, [setPhase]);

  // ── Text to speech ─────────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    // Bump the generation so any in-flight chunk chain goes inert: canceled
    // utterances still fire onend/onerror, which would otherwise resume the
    // chain or re-trigger onDone.
    speakGenRef.current += 1;
    const u = utterRef.current;
    if (u) {
      u.onend = null;
      u.onerror = null;
    }
    utterRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
  }, []);

  const speak = useCallback(
    (text: string, onDone: () => void) => {
      if (!("speechSynthesis" in window)) { onDone(); return; }
      const plain = stripMarkdownForSpeech(text);
      if (!plain) { onDone(); return; }
      const chunks = chunkSentences(plain);
      const gen = ++speakGenRef.current;
      let idx = 0;
      const next = () => {
        if (gen !== speakGenRef.current) return; // barge-in or newer speech
        if (!voiceModeRef.current || idx >= chunks.length) {
          utterRef.current = null;
          onDone();
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[idx++]);
        u.rate = 1.04;
        u.onend = () => setTimeout(next, 50);
        u.onerror = () => {
          if (gen !== speakGenRef.current) return;
          utterRef.current = null;
          onDone();
        };
        utterRef.current = u; // hold the ref (iOS GC bug)
        window.speechSynthesis.speak(u);
      };
      window.speechSynthesis.cancel();
      setTimeout(next, 100);
    },
    [],
  );

  // ── Wake lock (keep screen on in hands-free "desk mode") ──────────────────

  const acquireWakeLock = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav.wakeLock?.request) {
        wakeLockRef.current = await nav.wakeLock.request("screen");
      }
    } catch { /* unsupported or denied; fine */ }
  }, []);

  const releaseWakeLock = useCallback(() => {
    try { wakeLockRef.current?.release?.(); } catch { /* already released */ }
    wakeLockRef.current = null;
  }, []);

  // ── Hands-free mode lifecycle ──────────────────────────────────────────────

  const exitVoiceMode = useCallback(() => {
    voiceModeRef.current = false;
    setVoiceMode(false);
    stopRecognition();
    stopSpeaking();
    releaseWakeLock();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
    setVoiceLive("");
    setPhase("standby");
  }, [releaseWakeLock, setPhase, stopRecognition, stopSpeaking]);

  const toggleVoiceMode = useCallback(() => {
    if (voiceModeRef.current) {
      // Tap while speaking = barge-in: stop speech, go back to listening
      if (phaseRef.current === "speaking") {
        stopSpeaking();
        setPhase("standby");
        startRecognition("voice");
        return;
      }
      exitVoiceMode();
      return;
    }
    if (!speechAvailable()) {
      const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
      setError(
        standalone
          ? "Voice is not available inside the installed app on iPhone (an Apple limitation). Open abiolaonikoyi.com in Safari for voice, or use the app on Android or desktop."
          : "Voice input is not supported in this browser. Try Chrome, Edge, or Safari.",
      );
      return;
    }
    if (dictating) {
      stopRecognition();
      setDictating(false);
      setInterimText("");
    }
    setError(null);
    voiceModeRef.current = true;
    setVoiceMode(true);
    setPhase("standby");
    // Unlock TTS inside the user gesture (required on iOS)
    try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance("")); } catch { /* fine */ }
    void acquireWakeLock();
    startRecognition("voice");
  }, [acquireWakeLock, dictating, exitVoiceMode, setPhase, startRecognition, stopRecognition, stopSpeaking]);

  // Pause/resume on tab visibility changes
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (voiceModeRef.current) {
          stopRecognition();
          stopSpeaking();
        }
      } else if (voiceModeRef.current) {
        void acquireWakeLock();
        setPhase("standby");
        startRecognition("voice");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWakeLock, setPhase, startRecognition, stopRecognition, stopSpeaking]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      // Kill the voice mode FIRST so pending TTS/onDone callbacks (which fire
      // even after cancel) cannot restart speech or the microphone.
      voiceModeRef.current = false;
      speakGenRef.current += 1;
      abortRef.current?.abort();
      shouldListenRef.current = false;
      try { recRef.current?.stop(); } catch { /* fine */ }
      recRef.current = null;
      try { window.speechSynthesis?.cancel(); } catch { /* fine */ }
      try { wakeLockRef.current?.release?.(); } catch { /* fine */ }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
    };
  }, []);

  // ── Dictation (push-to-talk) ───────────────────────────────────────────────

  function toggleDictation() {
    if (voiceMode) return; // hands-free owns the mic
    if (dictating) {
      stopRecognition();
      setDictating(false);
      setInterimText("");
      return;
    }
    if (!speechAvailable()) {
      const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
      setError(
        standalone
          ? "Voice is not available inside the installed app on iPhone (an Apple limitation). Open abiolaonikoyi.com in Safari for voice, or use the app on Android or desktop."
          : "Voice input is not supported in this browser. Try Chrome, Edge, or Safari.",
      );
      return;
    }
    setError(null);
    committedRef.current = input;
    if (startRecognition("dictation")) setDictating(true);
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async function send(overrideText?: string, opts?: { voice?: boolean }) {
    const text = (overrideText ?? input).trim();
    const isVoice = opts?.voice === true;
    if ((!text && pendingFiles.length === 0) || sendingRef.current || sending || processing)
      return;
    sendingRef.current = true;

    if (dictating) {
      stopRecognition();
      setDictating(false);
      setInterimText("");
      committedRef.current = "";
    }
    if (isVoice) setPhase("thinking");

    const filesToProcess = [...pendingFiles];
    if (!overrideText) setInput("");
    setPendingFiles([]);
    setError(null);

    const displayContent =
      text +
      (filesToProcess.length
        ? (text ? "\n" : "") + filesToProcess.map((f) => `[attached: ${f.name}]`).join("\n")
        : "");
    setItems((it) => [...it, { kind: "msg", role: "user", content: displayContent }]);

    let attachments: Attachment[] = [];
    if (filesToProcess.length > 0) {
      setProcessing(true);
      attachments = await Promise.all(filesToProcess.map(processFile));
      setProcessing(false);
    }

    setSending(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let assistantIndex = -1;
    let receiptsIndex = -1;
    let streamedText = "";
    let finalReply = "";

    const handleEvent = (evt: {
      type: string;
      text?: string;
      threadId?: string;
      reply?: string;
      record?: SavedRecord;
      saved?: SavedRecord[];
      error?: string;
    }) => {
      if (evt.type === "meta") {
        if (!threadIdRef.current && evt.threadId) {
          threadIdRef.current = evt.threadId; // synchronous: no re-render race
          setThreadId(evt.threadId);
          window.history.replaceState(null, "", `/jarvis/chat?t=${evt.threadId}`);
        }
      } else if (evt.type === "saved" && evt.record) {
        const rec = evt.record;
        setItems((it) => {
          const copy = [...it];
          if (receiptsIndex === -1) {
            copy.push({ kind: "receipts", records: [rec] });
            receiptsIndex = copy.length - 1;
          } else {
            const entry = copy[receiptsIndex];
            if (entry.kind === "receipts") {
              copy[receiptsIndex] = { kind: "receipts", records: [...entry.records, rec] };
            }
          }
          return copy;
        });
      } else if (evt.type === "delta" && evt.text) {
        streamedText += evt.text;
        setItems((it) => {
          const copy = [...it];
          if (assistantIndex === -1) {
            copy.push({ kind: "msg", role: "assistant", content: streamedText });
            assistantIndex = copy.length - 1;
          } else {
            copy[assistantIndex] = { kind: "msg", role: "assistant", content: streamedText };
          }
          return copy;
        });
      } else if (evt.type === "done") {
        finalReply = evt.reply ?? streamedText;
        setItems((it) => {
          const copy = [...it];
          if (assistantIndex === -1) {
            copy.push({ kind: "msg", role: "assistant", content: finalReply });
          } else {
            copy[assistantIndex] = { kind: "msg", role: "assistant", content: finalReply };
          }
          return copy;
        });
      } else if (evt.type === "error") {
        setError(evt.error ?? "Something went wrong.");
      }
    };

    try {
      const res = await fetch("/jarvis/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: threadIdRef.current, message: text, attachments, voice: isVoice }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = `Server error (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          msg = errData.error || errData.message || msg;
        } catch { /* keep default */ }
        setError(msg);
        return;
      }
      if (!res.body) {
        setError("No response stream from server.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try { handleEvent(JSON.parse(line)); } catch { /* partial line */ }
          }
        }
      }
      if (buffer.trim()) {
        try { handleEvent(JSON.parse(buffer.trim())); } catch { /* ignore */ }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError("Network error. Please try again.");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      if (isVoice && voiceModeRef.current) {
        if (finalReply) {
          setPhase("speaking");
          stopRecognition(); // never transcribe our own voice
          speak(finalReply, () => {
            if (!voiceModeRef.current) return;
            setPhase("capturing"); // follow-up window: no wake word needed
            captureBufRef.current = "";
            setVoiceLive("");
            setTimeout(() => {
              // Do not reopen the mic while the tab is hidden; the
              // visibilitychange handler resumes on return.
              if (voiceModeRef.current && !document.hidden) startRecognition("voice");
            }, 300);
            armFollowupWindow();
          });
        } else {
          setPhase("standby");
        }
      }
    }
  }
  sendRef.current = send;

  async function undo(itemIdx: number, rec: SavedRecord) {
    const r = await undoRecord(rec.kind, rec.id);
    if (r?.ok) {
      setItems((it) => {
        const copy = [...it];
        const entry = copy[itemIdx];
        if (entry.kind === "receipts") {
          copy[itemIdx] = {
            kind: "receipts",
            records: entry.records.map((x) => (x.id === rec.id && x.kind === rec.kind ? { ...x, undone: true } : x)),
          };
        }
        return copy;
      });
    } else {
      setError(r?.error ?? "Could not undo.");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const voiceStatus =
    voicePhase === "standby"
      ? 'Say "Hey Jarvis" to start'
      : voicePhase === "capturing"
        ? voiceLive || "Listening..."
        : voicePhase === "thinking"
          ? "Thinking..."
          : "Speaking. Tap the headset to interrupt.";

  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[420px] flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_20px_50px_-24px_rgba(30,27,75,0.28)] backdrop-blur-sm md:h-[calc(100dvh-12rem)]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
            </span>
            <p className="mt-4 max-w-sm text-sm text-zinc-500">
              Ask anything about your ventures. Attach documents, or turn on the headset and say &quot;Hey Jarvis&quot;.
            </p>
          </div>
        ) : null}

        {items.map((item, i) =>
          item.kind === "msg" ? (
            <div key={i} className={item.role === "user" ? "flex justify-end" : ""}>
              {item.role === "user" ? (
                <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-zinc-800 to-zinc-900 px-4 py-2.5 text-sm text-white shadow-sm">
                  {item.content}
                </span>
              ) : (
                <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-zinc-200/80">
                  <Markdown tone="light">{item.content}</Markdown>
                </div>
              )}
            </div>
          ) : (
            <div key={i} className="space-y-1.5">
              {item.records.map((rec) => (
                <div
                  key={`${rec.kind}:${rec.id}`}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                    rec.undone
                      ? "border-zinc-200 bg-zinc-50 text-zinc-400"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                  }`}
                >
                  {rec.undone ? (
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                  <span className={rec.undone ? "line-through" : ""}>{rec.summary}</span>
                  {rec.undoable && !rec.undone ? (
                    <button
                      onClick={() => void undo(i, rec)}
                      className="ml-auto shrink-0 rounded-md px-2 py-0.5 font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ),
        )}

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
                <button
                  onClick={() => setPendingFiles((p) => p.filter((_, idx) => idx !== i))}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-200"
                  aria-label="Remove"
                >
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Hands-free status banner */}
        {voiceMode ? (
          <div
            className={`mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
              voicePhase === "speaking"
                ? "bg-indigo-50 text-indigo-700"
                : voicePhase === "capturing"
                  ? "bg-red-50 text-red-700"
                  : "bg-zinc-100 text-zinc-600"
            }`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {voicePhase === "capturing" || voicePhase === "standby" ? (
                <>
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${voicePhase === "capturing" ? "bg-red-400" : "bg-zinc-400"}`} />
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${voicePhase === "capturing" ? "bg-red-500" : "bg-zinc-500"}`} />
                </>
              ) : (
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{voiceStatus}</span>
          </div>
        ) : dictating ? (
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

        <div className="flex items-end gap-1.5 md:gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setPendingFiles((prev) => [...prev, ...picked]);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            aria-label="Attach file"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <textarea
            value={input}
            onChange={(e) => {
              const v = e.target.value;
              setInput(v);
              if (dictating && interimText) {
                // Preserve manual edits mid-dictation: strip the live interim
                // suffix so it is not double-committed when its final arrives.
                const suffix = " " + interimText;
                committedRef.current = v.endsWith(suffix) ? v.slice(0, -suffix.length) : v;
              } else {
                committedRef.current = v;
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={dictating ? "Listening..." : "Message Jarvis..."}
            className="min-w-0 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
          />

          {/* Dictation mic */}
          <button
            type="button"
            onClick={toggleDictation}
            title={dictating ? "Stop dictation" : "Dictate a message"}
            aria-label="Dictate"
            disabled={voiceMode}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-30 ${
              dictating ? "bg-red-100 text-red-600 hover:bg-red-200" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {dictating ? (
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

          {/* Hands-free toggle */}
          <button
            type="button"
            onClick={toggleVoiceMode}
            title={voiceMode ? "Turn off hands-free" : 'Hands-free: say "Hey Jarvis"'}
            aria-label="Hands-free voice mode"
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors ${
              voiceMode
                ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 14v-2a9 9 0 0118 0v2M3 14a2 2 0 002 2h1a1 1 0 001-1v-4a1 1 0 00-1-1H5a2 2 0 00-2 2zm18 0a2 2 0 01-2 2h-1a1 1 0 01-1-1v-4a1 1 0 011-1h1a2 2 0 012 2zM12 21v-2" />
            </svg>
          </button>

          <button
            onClick={() => void send()}
            disabled={sending || processing || (!input.trim() && pendingFiles.length === 0)}
            className="h-10 shrink-0 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 md:px-5"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
