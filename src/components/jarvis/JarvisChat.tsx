"use client";

import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { Markdown } from "@/components/Markdown";
import { undoRecord, saveMeetingTranscript } from "@/app/jarvis/actions";
import { JarvisOrb, type OrbState } from "@/components/jarvis/Orb";
import {
  audioRunning,
  createListener,
  getSpeaker,
  loadVoices,
  micErrorMessage,
  stripMarkdownForSpeech,
  transcribe,
  unlockAudio,
  VoiceUnavailableError,
  voiceServiceAvailable,
  type Listener,
  type VoiceInfo,
} from "@/lib/jarvis/voice-client";

const OUTBOX_KEY = "jarvis-outbox";
const VOICE_KEY = "jarvis-tts-voice";

type OutboxItem = { text: string; ts: number };

function readOutbox(): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeOutbox(items: OutboxItem[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-20)));
  } catch { /* storage full or unavailable */ }
}

export type SavedRecord = {
  kind: string;
  id: string;
  summary: string;
  undoable: boolean;
  undone?: boolean;
};
export type ChatItem =
  | { kind: "msg"; role: "user" | "assistant"; content: string }
  | { kind: "receipts"; records: SavedRecord[] };

export type Attachment =
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; mimeType: string; base64: string }
  | { kind: "pdf-scan"; name: string; pages: { mimeType: string; base64: string }[] }
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
      let extractedChars = 0;
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const lineText = content.items
          .map((item: unknown) => {
            const t = item as { str?: string; hasEOL?: boolean };
            return (t.str ?? "") + (t.hasEOL ? "\n" : "");
          })
          .join("");
        extractedChars += lineText.trim().length;
        pageTexts.push(`[Page ${p}]\n${lineText.trim()}`);
      }

      // Scanned PDF: essentially no text layer. Render pages to images so
      // Jarvis can read them with vision and transcribe into a document.
      if (extractedChars < Math.max(120, pdf.numPages * 25)) {
        const pages: { mimeType: string; base64: string }[] = [];
        const maxPages = Math.min(pdf.numPages, 12);
        for (let p = 1; p <= maxPages; p++) {
          const page = await pdf.getPage(p);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(1.8, 1200 / base.width);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
          pages.push({ mimeType: "image/jpeg", base64: dataUrl.split(",")[1] ?? "" });
        }
        if (pages.length) {
          return { kind: "pdf-scan", name, pages };
        }
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

// ── Citation helper ──────────────────────────────────────────────────────────

// [[doc:<id>|<name>]] citation markers become clickable document chips.
function renderCitations(s: string): string {
  return s.replace(
    /\[\[doc:([A-Za-z0-9]+)\|([^\]|]+)\]\]/g,
    (_, id, name) => `[\u{1F4C4} ${String(name).trim()}](/jarvis/documents/${id})`,
  );
}

type VoicePhase = "standby" | "capturing" | "thinking" | "speaking";

// ── Voice overlay (orb) ───────────────────────────────────────────────────────

// The audio level changes ~30 times a second; polling it here keeps those
// re-renders inside this small component instead of the whole chat.
function useLiveLevel(state: OrbState, mic: RefObject<number>, play: RefObject<number>): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const v = state === "speaking" ? play.current : state === "listening" ? mic.current : 0;
      setLevel((prev) => (Math.abs(prev - v) < 0.01 ? prev : v));
    }, 33);
    return () => clearInterval(t);
  }, [state, mic, play]);
  return level;
}

function VoiceOverlay({
  state,
  micRef,
  playRef,
  status,
  userLine,
  replyLine,
  onTap,
  onClose,
}: {
  state: OrbState;
  micRef: RefObject<number>;
  playRef: RefObject<number>;
  status: string;
  userLine: string;
  replyLine: string;
  onTap: () => void;
  onClose: () => void;
}) {
  const level = useLiveLevel(state, micRef, playRef);
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-gradient-to-b from-zinc-950 via-zinc-950 to-indigo-950 px-6 py-4 text-center">
      <button
        type="button"
        onClick={onTap}
        aria-label="Tap to talk or interrupt"
        className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <JarvisOrb state={state} level={level} size={220} />
      </button>
      <p className="min-h-[1.25rem] max-w-md text-sm font-medium text-indigo-100">{status}</p>
      {userLine ? (
        <p className="line-clamp-2 max-w-md text-xs italic text-zinc-400">&ldquo;{userLine}&rdquo;</p>
      ) : null}
      {replyLine ? <p className="line-clamp-5 max-w-md text-sm text-zinc-300">{replyLine}</p> : null}
      <button type="button" onClick={onClose} className="text-xs text-zinc-400 underline hover:text-zinc-200">
        End voice mode
      </button>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function JarvisChat({
  initialThreadId,
  initialItems,
  initialInput,
}: {
  initialThreadId: string | null;
  initialItems: ChatItem[];
  initialInput?: string;
}) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [items, setItems] = useState<ChatItem[]>(initialItems);
  const [input, setInput] = useState(initialInput ?? "");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [workStatus, setWorkStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dictation (push-to-talk into the textarea)
  const [dictating, setDictating] = useState(false);
  const [interimText, setInterimText] = useState("");

  // Hands-free voice mode
  const [voiceMode, setVoiceMode] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("standby");
  const [voiceLive, setVoiceLive] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string>("");
  // Whisper/Kokoro voice service: null until probed, false when not configured
  const [cloudVoice, setCloudVoice] = useState<boolean | null>(null);
  const [kokoro, setKokoro] = useState<{ voices: VoiceInfo[]; default: string } | null>(null);
  const [transcribing, setTranscribing] = useState(0);
  // ?voice=1 deep link blocked by the browser: ask for one tap
  const [needsTap, setNeedsTap] = useState(false);

  // Meeting recorder
  const [meeting, setMeeting] = useState(false);
  const [meetingLive, setMeetingLive] = useState("");
  const [meetingSaving, setMeetingSaving] = useState(false);
  const meetingBufRef = useRef("");
  const meetingStartRef = useRef(0);

  // Offline outbox
  const [outboxCount, setOutboxCount] = useState(0);

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
  const speakGenRef = useRef(0);
  const cloudRef = useRef<boolean | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const cloudModeRef = useRef<"off" | "dictation" | "voice" | "meeting">("off");
  // Which engine the CURRENT hands-free session uses (fixed when it starts)
  const voiceCloudRef = useRef(false);
  const micLevelRef = useRef(0);
  const playLevelRef = useRef(0);
  const txQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Listener callbacks are created once; they reach current-render logic here.
  const cloudHandlersRef = useRef<{
    speechStart: (mode: "dictation" | "voice" | "meeting") => void;
    utterance: (mode: "dictation" | "voice" | "meeting", blob: Blob) => void;
    error: (mode: "dictation" | "voice" | "meeting", message: string) => void;
  }>({ speechStart: () => {}, utterance: () => {}, error: () => {} });
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

  // ── Cloud engine primitives (Whisper listening via voice-client) ──────────

  const stopCloudListening = useCallback(async (flush = false) => {
    const l = listenerRef.current;
    listenerRef.current = null;
    cloudModeRef.current = "off";
    micLevelRef.current = 0;
    if (l) await l.stop(flush);
  }, []);

  const startCloudListening = useCallback(
    async (mode: "dictation" | "voice" | "meeting") => {
      await stopCloudListening();
      const l = createListener({
        silenceMs: mode === "meeting" ? 1400 : 800,
        maxUtteranceMs: mode === "meeting" ? 40_000 : 60_000,
        onLevel: (v) => {
          micLevelRef.current = v;
        },
        onSpeechStart: () => cloudHandlersRef.current.speechStart(mode),
        onUtterance: (blob) => cloudHandlersRef.current.utterance(mode, blob),
        onError: (m) => cloudHandlersRef.current.error(mode, m),
      });
      listenerRef.current = l;
      cloudModeRef.current = mode;
      try {
        await l.start();
      } catch (e) {
        if (listenerRef.current === l) {
          listenerRef.current = null;
          cloudModeRef.current = "off";
        }
        throw e;
      }
      // Stopped while the permission prompt was open: do not leave the mic on.
      if (listenerRef.current !== l) await l.stop();
    },
    [stopCloudListening],
  );

  const resolveCloud = useCallback(async () => {
    const ok = await voiceServiceAvailable();
    cloudRef.current = ok;
    setCloudVoice(ok);
    return ok;
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
    void stopCloudListening();
  }, [stopCloudListening]);

  const startRecognition = useCallback((mode: "dictation" | "voice" | "meeting") => {
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

      if (mode === "meeting") {
        for (const f of finals) {
          meetingBufRef.current = (meetingBufRef.current + " " + f).trimStart();
        }
        const tail = meetingBufRef.current.slice(-160);
        setMeetingLive((tail.length < meetingBufRef.current.length ? "..." : "") + tail + (interim ? " " + interim : ""));
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
        else if (mode === "meeting") setMeeting(false);
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

  const armFollowupWindow = useCallback((ms = 8000) => {
    if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
    followupTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "capturing" && !captureBufRef.current.trim()) {
        setPhase("standby");
        setVoiceLive("");
      }
    }, ms);
  }, [setPhase]);

  // ── Text to speech ─────────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    // Bump the generation so any in-flight speak() promise goes inert and its
    // completion callback cannot resume the chain or re-trigger onDone.
    speakGenRef.current += 1;
    getSpeaker().stop();
    playLevelRef.current = 0;
    listenerRef.current?.setMode("listen");
  }, []);

  const speak = useCallback((text: string, onDone: () => void) => {
    const gen = ++speakGenRef.current;
    // While Jarvis talks the mic only reacts to clearly louder speech (barge-in),
    // so its own voice leaking into the mic does not interrupt it.
    listenerRef.current?.setMode("boost");
    void getSpeaker()
      .speak(text, {
        onLevel: (v) => {
          playLevelRef.current = v;
        },
      })
      .then(() => {
        if (gen !== speakGenRef.current) return; // barge-in or newer speech
        playLevelRef.current = 0;
        listenerRef.current?.setMode("listen");
        onDone();
      });
  }, []);

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
        if (voiceCloudRef.current) {
          setPhase("capturing");
          armFollowupWindow(12000);
        } else {
          setPhase("standby");
          startRecognition("voice");
        }
        return;
      }
      exitVoiceMode();
      return;
    }
    if (meeting) return; // do not hijack an active meeting recording
    // Unlock audio output inside the user gesture (required on iOS)
    unlockAudio();
    try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance("")); } catch { /* fine */ }
    void (async () => {
      const cloud = await resolveCloud();
      if (!cloud && !speechAvailable()) {
        setError(
          "Voice is not available. The voice service is not configured and this browser has no built-in speech recognition.",
        );
        return;
      }
      if (voiceModeRef.current) return; // double tap
      if (dictating) {
        stopRecognition();
        setDictating(false);
        setInterimText("");
      }
      setError(null);
      voiceCloudRef.current = cloud;
      voiceModeRef.current = true;
      setVoiceMode(true);
      void acquireWakeLock();
      if (cloud) {
        // A tap starts the conversation: listen straight away, no wake word.
        setPhase("capturing");
        try {
          await startCloudListening("voice");
          armFollowupWindow(12000);
        } catch (e) {
          setError(micErrorMessage(e));
          exitVoiceMode();
        }
      } else {
        setPhase("standby");
        startRecognition("voice");
      }
    })();
  }, [acquireWakeLock, armFollowupWindow, dictating, meeting, exitVoiceMode, resolveCloud, setPhase, startCloudListening, startRecognition, stopRecognition, stopSpeaking]);

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
        if (voiceCloudRef.current) {
          setPhase("capturing");
          startCloudListening("voice")
            .then(() => armFollowupWindow(12000))
            .catch((e) => {
              setError(micErrorMessage(e));
              exitVoiceMode();
            });
        } else {
          setPhase("standby");
          startRecognition("voice");
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWakeLock, armFollowupWindow, exitVoiceMode, setPhase, startCloudListening, startRecognition, stopRecognition, stopSpeaking]);

  // /jarvis/chat?voice=1 starts hands-free right away. If the browser blocks
  // audio or the mic without a gesture (iOS), show a single big tap target.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("voice") !== "1") return;
    const t = setTimeout(() => {
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("voice");
        window.history.replaceState(null, "", u.pathname + u.search);
      } catch { /* fine */ }
      unlockAudio();
      if (!audioRunning()) {
        setNeedsTap(true);
        return;
      }
      toggleVoiceMode();
      setTimeout(() => {
        if (!voiceModeRef.current) setNeedsTap(true);
      }, 2500);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Probe the voice service once: decides Whisper/Kokoro vs the browser's own voice
  useEffect(() => {
    let alive = true;
    void loadVoices().then((v) => {
      if (!alive) return;
      cloudRef.current = v !== null;
      setCloudVoice(v !== null);
      if (v) setKokoro({ voices: v.voices, default: v.default });
    });
    return () => {
      alive = false;
    };
  }, []);

  // TTS voices load asynchronously on most platforms
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
      if (all.length) setVoices(all);
    };
    // Defer initial reads so state updates never run synchronously in the effect
    queueMicrotask(() => {
      load();
      try {
        setVoiceName(localStorage.getItem(VOICE_KEY) ?? "");
      } catch { /* fine */ }
    });
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Offline outbox: count on mount, flush when the connection returns
  useEffect(() => {
    queueMicrotask(() => setOutboxCount(readOutbox().length));
    const flush = async () => {
      let queue = readOutbox();
      while (queue.length && navigator.onLine) {
        if (sendingRef.current) break; // resume on next online/interval tick
        const item = queue[0];
        writeOutbox(queue.slice(1));
        setOutboxCount(queue.length - 1);
        await sendRef.current(item.text);
        queue = readOutbox();
      }
    };
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // ── Meeting recorder ───────────────────────────────────────────────────────

  async function toggleMeeting() {
    if (voiceMode || dictating) return;
    if (meeting) {
      if (cloudModeRef.current === "meeting") {
        // Flush the utterance in progress, then wait for every chunk to transcribe
        await stopCloudListening(true);
        await txQueueRef.current;
      } else {
        stopRecognition();
      }
      setMeeting(false);
      setMeetingLive("");
      const transcript = meetingBufRef.current.trim();
      meetingBufRef.current = "";
      if (!transcript) return;
      setMeetingSaving(true);
      try {
        const r = await saveMeetingTranscript(transcript);
        if (r.error || !r.id) {
          setError(r.error ?? "Could not save the transcript.");
        } else {
          setItems((it) => [
            ...it,
            {
              kind: "receipts",
              records: [
                {
                  kind: "document",
                  id: r.id!,
                  summary: `Saved meeting transcript "${r.name}"`,
                  undoable: true,
                },
              ],
            },
          ]);
          void sendRef.current(
            `Analyse the meeting transcript "${r.name}" [doc:${r.id}]: read it, then save the key decisions (log_decision), action items (create_task), and a short summary note (log_note) under the right project. Cite the document.`,
          );
        }
      } finally {
        setMeetingSaving(false);
      }
      return;
    }
    const cloud = await resolveCloud();
    if (!cloud && !speechAvailable()) {
      setError("Voice recognition is not available. The voice service is not configured and this browser has no built-in speech recognition.");
      return;
    }
    setError(null);
    meetingBufRef.current = "";
    meetingStartRef.current = Date.now();
    setMeetingLive("");
    if (cloud) {
      try {
        await startCloudListening("meeting");
        setMeeting(true);
      } catch (e) {
        setError(micErrorMessage(e));
      }
    } else if (startRecognition("meeting")) {
      setMeeting(true);
    }
  }

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
      void listenerRef.current?.stop();
      listenerRef.current = null;
      getSpeaker().stop();
      try { wakeLockRef.current?.release?.(); } catch { /* fine */ }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
    };
  }, []);

  // ── Dictation (push-to-talk) ───────────────────────────────────────────────

  function toggleDictation() {
    if (voiceMode || meeting) return; // hands-free / meeting own the mic
    if (dictating) {
      // Cloud: flush the utterance in progress so the last words are kept
      if (cloudModeRef.current === "dictation") void stopCloudListening(true);
      else stopRecognition();
      setDictating(false);
      setInterimText("");
      return;
    }
    void (async () => {
      const cloud = await resolveCloud();
      if (!cloud && !speechAvailable()) {
        setError(
          "Voice input is not available. The voice service is not configured and this browser has no built-in speech recognition.",
        );
        return;
      }
      setError(null);
      committedRef.current = input;
      if (cloud) {
        try {
          await startCloudListening("dictation");
          setDictating(true);
        } catch (e) {
          setError(micErrorMessage(e));
        }
      } else if (startRecognition("dictation")) {
        setDictating(true);
      }
    })();
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
    let gotResponse = false;
    let gotDone = false;
    let gotError = false;
    // Long turns checkpoint server-side and hand back a resume token; the
    // turn continues seamlessly in a fresh request.
    let pendingResume: string | null = null;

    const handleEvent = (evt: {
      type: string;
      text?: string;
      threadId?: string;
      reply?: string;
      record?: SavedRecord;
      saved?: SavedRecord[];
      stateId?: string;
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
      } else if (evt.type === "status" && evt.text) {
        setWorkStatus(evt.text);
      } else if (evt.type === "delta") {
        setWorkStatus(null);
      } else if (evt.type === "done") {
        gotDone = true;
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
      } else if (evt.type === "resume" && evt.stateId) {
        pendingResume = evt.stateId;
      } else if (evt.type === "error") {
        gotError = true;
        setError(evt.error ?? "Something went wrong.");
      }
      // "ping" and unknown events: keep-alive only, nothing to do
    };

    try {
      let resumeToken: string | null = null;
      let rounds = 0;

      do {
        pendingResume = null;
        const res = await fetch("/jarvis/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            resumeToken
              ? { threadId: threadIdRef.current, resumeStateId: resumeToken }
              : { threadId: threadIdRef.current, message: text, attachments, voice: isVoice },
          ),
          signal: controller.signal,
        });
        gotResponse = true;

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

        // Server checkpointed a long turn: continue it in a fresh request.
        resumeToken = pendingResume;
        if (resumeToken) setWorkStatus("Still working...");
        rounds += 1;
      } while (resumeToken && !gotError && rounds < 12);

      // Stream closed without a terminal event: the server was cut off.
      if (!gotDone && !gotError) {
        setError(
          "The connection dropped mid-reply. Anything Jarvis saved is safe; reload the page to see it, then try again.",
        );
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        // If the request never reached the server, queue text-only messages
        // for automatic resend when the connection returns.
        if (!gotResponse && text && attachments.length === 0) {
          writeOutbox([...readOutbox(), { text, ts: Date.now() }]);
          setOutboxCount(readOutbox().length);
          setError("You're offline. The message is queued and will send automatically.");
        } else {
          setError("Network error. Please try again.");
        }
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      setWorkStatus(null);
      if (isVoice && voiceModeRef.current) {
        const cloud = voiceCloudRef.current;
        if (finalReply) {
          setPhase("speaking");
          if (!cloud) stopRecognition(); // never transcribe our own voice
          speak(finalReply, () => {
            if (!voiceModeRef.current) return;
            setPhase("capturing"); // follow-up window: no wake word needed
            captureBufRef.current = "";
            setVoiceLive("");
            if (cloud) {
              // The listener keeps running through speech; only a hidden tab stopped it.
              if (!listenerRef.current && !document.hidden) {
                startCloudListening("voice").catch((e) => {
                  setError(micErrorMessage(e));
                  exitVoiceMode();
                });
              }
            } else {
              setTimeout(() => {
                // Do not reopen the mic while the tab is hidden; the
                // visibilitychange handler resumes on return.
                if (voiceModeRef.current && !document.hidden) startRecognition("voice");
              }, 300);
            }
            armFollowupWindow();
          });
        } else {
          setPhase(cloud ? "capturing" : "standby");
          if (cloud) armFollowupWindow();
        }
      }
    }
  }
  sendRef.current = send;

  // ── Cloud listener callbacks (assigned each render, called via ref) ────────

  function enqueueTranscription(blob: Blob, onText: (text: string) => void) {
    setTranscribing((n) => n + 1);
    txQueueRef.current = txQueueRef.current.then(async () => {
      try {
        const t = await transcribe(blob);
        if (t.text) onText(t.text);
      } catch (e) {
        if (e instanceof VoiceUnavailableError) {
          cloudRef.current = false;
          setCloudVoice(false);
          setError("The voice service is unavailable. Tap the mic again to use the browser's voice input instead.");
        } else {
          setError(e instanceof Error ? e.message : "Could not transcribe that.");
        }
      } finally {
        setTranscribing((n) => Math.max(0, n - 1));
      }
    });
  }

  async function handleVoiceUtterance(blob: Blob) {
    if (!voiceModeRef.current) return;
    const prev = phaseRef.current;
    if (prev === "thinking") return; // busy with the previous turn: drop it
    const base: VoicePhase = prev === "standby" ? "standby" : "capturing";
    if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
    setPhase("thinking");
    const restore = () => {
      setPhase(base);
      if (base === "capturing") armFollowupWindow();
    };
    let text = "";
    try {
      text = (await transcribe(blob)).text;
    } catch (e) {
      if (!voiceModeRef.current) return;
      if (e instanceof VoiceUnavailableError) {
        cloudRef.current = false;
        setCloudVoice(false);
        setError("The voice service is unavailable, so hands-free has stopped. Tap the headset to use the browser's voice.");
        exitVoiceMode();
        return;
      }
      setError(e instanceof Error ? e.message : "Could not transcribe that.");
      restore();
      return;
    }
    if (!voiceModeRef.current) return;
    if (base === "standby") {
      // Wake word is matched on the Whisper transcript, so it works on iPhone too
      const m = text.match(WAKE_RE);
      if (!m) {
        setPhase("standby");
        return;
      }
      text = text.slice((m.index ?? 0) + m[0].length).trim();
      if (!text) {
        setPhase("capturing");
        setVoiceLive("");
        armFollowupWindow();
        return;
      }
    } else {
      text = text.replace(WAKE_RE, " ").trim();
    }
    if (!text || sendingRef.current) {
      restore();
      return;
    }
    setVoiceLive("");
    void sendRef.current(text, { voice: true });
  }

  cloudHandlersRef.current = {
    speechStart: (mode) => {
      if (mode !== "voice" || !voiceModeRef.current) return;
      if (phaseRef.current === "speaking") {
        // Barge-in: the user started talking over Jarvis
        stopSpeaking();
        setPhase("capturing");
      }
      if (phaseRef.current === "capturing") {
        if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
        setVoiceLive("");
      }
    },
    utterance: (mode, blob) => {
      if (mode === "dictation") {
        enqueueTranscription(blob, (text) => {
          committedRef.current = (committedRef.current + " " + text).trimStart();
          setInput(committedRef.current);
        });
      } else if (mode === "meeting") {
        enqueueTranscription(blob, (text) => {
          meetingBufRef.current = (meetingBufRef.current + " " + text).trimStart();
          const tail = meetingBufRef.current.slice(-160);
          setMeetingLive((tail.length < meetingBufRef.current.length ? "..." : "") + tail);
        });
      } else {
        void handleVoiceUtterance(blob);
      }
    },
    error: (mode, message) => {
      setError(message);
      if (mode === "voice") exitVoiceMode();
      else if (mode === "dictation") setDictating(false);
    },
  };

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
      ? voiceCloudRef.current
        ? 'Say "Hey Jarvis" or tap the orb'
        : 'Say "Hey Jarvis" to start'
      : voicePhase === "capturing"
        ? voiceLive || "Listening..."
        : voicePhase === "thinking"
          ? "Thinking..."
          : "Speaking. Tap or just talk to interrupt.";
  const orbState: OrbState =
    voicePhase === "capturing" ? "listening" : voicePhase === "standby" ? "idle" : voicePhase;
  const lastMsg = [...items].reverse().find((i) => i.kind === "msg");
  const lastUserMsg = [...items].reverse().find((i) => i.kind === "msg" && i.role === "user");
  const lastUserLine =
    lastUserMsg && lastUserMsg.kind === "msg" ? lastUserMsg.content.replace(/\[attached:[^\]]*\]/g, "").trim().slice(0, 200) : "";
  const lastReplyLine =
    lastMsg && lastMsg.kind === "msg" && lastMsg.role === "assistant"
      ? stripMarkdownForSpeech(lastMsg.content).slice(0, 400)
      : "";

  function onOrbTap() {
    if (voicePhase === "speaking") {
      toggleVoiceMode(); // barge-in
    } else if (voiceCloudRef.current && voicePhase === "standby") {
      setPhase("capturing");
      armFollowupWindow(12000);
    } else if (voiceCloudRef.current && voicePhase === "capturing") {
      if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
      setPhase("standby");
      setVoiceLive("");
    }
  }

  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[420px] flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_20px_50px_-24px_rgba(30,27,75,0.28)] backdrop-blur-sm md:h-[calc(100dvh-12rem)]">
      <div className="relative flex min-h-0 flex-1 flex-col">
      {voiceMode ? (
        <VoiceOverlay
          state={orbState}
          micRef={micLevelRef}
          playRef={playLevelRef}
          status={voiceStatus}
          userLine={lastUserLine}
          replyLine={voicePhase === "thinking" || voicePhase === "capturing" ? "" : lastReplyLine}
          onTap={onOrbTap}
          onClose={exitVoiceMode}
        />
      ) : needsTap ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-zinc-950 via-zinc-950 to-indigo-950 px-6 text-center">
          <JarvisOrb state="idle" level={0} size={220} />
          <button
            type="button"
            onClick={() => {
              setNeedsTap(false);
              toggleVoiceMode();
            }}
            className="rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-indigo-500/30"
          >
            Tap to start talking
          </button>
          <button type="button" onClick={() => setNeedsTap(false)} className="text-xs text-zinc-400 underline">
            Not now
          </button>
        </div>
      ) : null}
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
                  <Markdown tone="light">{renderCitations(item.content)}</Markdown>
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
            <span className="inline-flex items-center gap-2 rounded-2xl bg-zinc-50 px-4 py-2 text-sm text-zinc-400 ring-1 ring-zinc-200">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500" />
              {workStatus ?? "Thinking..."}
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}
      </div>
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

        {/* Offline outbox */}
        {outboxCount > 0 ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {outboxCount} message{outboxCount > 1 ? "s" : ""} queued, will send when back online
          </div>
        ) : null}

        {/* Meeting recorder banner */}
        {meeting || meetingSaving ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="font-medium">
              {meetingSaving ? "Saving transcript..." : "Recording meeting"}
            </span>
            {meeting ? (
              <span className="min-w-0 flex-1 truncate italic text-red-500">
                {meetingLive || "Capturing what is said..."}
              </span>
            ) : null}
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
            {cloudVoice && kokoro && kokoro.voices.length > 0 ? (
              <select
                value={kokoro.voices.some((v) => v.id === voiceName) ? voiceName : kokoro.default}
                onChange={(e) => {
                  setVoiceName(e.target.value);
                  try {
                    localStorage.setItem(VOICE_KEY, e.target.value);
                  } catch { /* fine */ }
                }}
                className="max-w-[150px] shrink-0 rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-600"
                title="Jarvis's speaking voice on this device"
              >
                {kokoro.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            ) : voices.length > 0 ? (
              <select
                value={voiceName}
                onChange={(e) => {
                  setVoiceName(e.target.value);
                  try {
                    if (e.target.value) localStorage.setItem(VOICE_KEY, e.target.value);
                    else localStorage.removeItem(VOICE_KEY);
                  } catch { /* fine */ }
                }}
                className="max-w-[130px] shrink-0 rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-600"
                title="Jarvis's speaking voice on this device"
              >
                <option value="">Default voice</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name.replace(/^(Microsoft|Google) /, "").slice(0, 24)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : dictating ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="font-medium">Listening</span>
            {transcribing > 0 ? (
              <span className="truncate italic text-red-500">Transcribing...</span>
            ) : interimText ? (
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

          {/* Meeting recorder */}
          <button
            type="button"
            onClick={() => void toggleMeeting()}
            title={meeting ? "Stop and analyse the meeting" : "Record a meeting"}
            aria-label="Record meeting"
            disabled={voiceMode || dictating || meetingSaving}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-30 ${
              meeting ? "bg-red-100 text-red-600 hover:bg-red-200" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {meeting ? (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            )}
          </button>

          {/* Dictation mic */}
          <button
            type="button"
            onClick={toggleDictation}
            title={dictating ? "Stop dictation" : "Dictate a message"}
            aria-label="Dictate"
            disabled={voiceMode || meeting}
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
            aria-label="Send"
            className="grid h-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 px-3 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 md:px-5"
          >
            <span className="hidden md:inline">Send</span>
            <svg className="h-5 w-5 md:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
