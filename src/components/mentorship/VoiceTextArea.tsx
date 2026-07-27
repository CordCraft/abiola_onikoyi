"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { polishText } from "@/app/mentorship/join/voice-actions";
import { Spinner } from "@/components/mentorship/Spinner";

// Textarea with optional voice dictation. Speech is transcribed live into the
// box (Web Speech API where available); when the speaker stops, the whole box
// is tidied up by AI (grammar, punctuation, fillers) so mentees can talk
// freely without worrying about correctness. Controlled component: parent
// owns the value, and onChange handlers must use functional state updates
// (recognition callbacks capture the closure once at start).

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function getRecognizer(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceTextArea({
  id,
  name,
  value,
  onChange,
  rows = 3,
  placeholder,
  className = "",
}: {
  id: string;
  name: string;
  value: string;
  onChange: (text: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  // SSR renders "unsupported"; the client snapshot flips it after hydration.
  const supported = useSyncExternalStore(
    () => () => {},
    () => !!getRecognizer(),
    () => false,
  );
  const [mode, setMode] = useState<"idle" | "listening" | "polishing">("idle");
  const [note, setNote] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");
  const stoppingRef = useRef(false);

  function finish() {
    recRef.current = null;
    const dictated = finalRef.current.trim();
    if (!dictated) {
      setMode("idle");
      return;
    }
    const full = (baseRef.current + finalRef.current).trim();
    onChange(full);
    setMode("polishing");
    polishText(full)
      .then((r) => {
        if (r.text?.trim()) onChange(r.text.trim());
      })
      .finally(() => setMode("idle"));
  }

  function start() {
    const Recognizer = getRecognizer();
    if (!Recognizer) return;
    setNote(null);
    const rec = new Recognizer();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-NG";
    baseRef.current = value.trim() ? value.trim() + " " : "";
    finalRef.current = "";
    stoppingRef.current = false;

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalRef.current += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      onChange((baseRef.current + finalRef.current + interim).trimStart());
    };
    rec.onerror = (event) => {
      stoppingRef.current = true;
      setMode("idle");
      recRef.current = null;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setNote("Microphone access was blocked. Allow it in your browser, or just type.");
      } else if (event.error !== "aborted" && event.error !== "no-speech") {
        setNote("Voice input hit a snag. You can keep typing.");
      }
    };
    rec.onend = () => {
      // Fires on manual stop and on browser silence timeout alike.
      if (!stoppingRef.current) {
        stoppingRef.current = true;
        finish();
      }
    };

    recRef.current = rec;
    setMode("listening");
    rec.start();
  }

  function stop() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    recRef.current?.stop();
    finish();
  }

  // Stop cleanly if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      recRef.current?.stop();
    };
  }, []);

  return (
    <div>
      <div className="relative">
        <textarea
          id={id}
          name={name}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${className} ${supported ? "pr-12" : ""} ${
            mode === "listening" ? "border-accent/60 ring-2 ring-accent/20" : ""
          }`}
        />
        {supported ? (
          <button
            type="button"
            onClick={mode === "listening" ? stop : start}
            disabled={mode === "polishing"}
            aria-label={mode === "listening" ? "Stop recording" : "Speak instead of typing"}
            title={mode === "listening" ? "Stop recording" : "Speak instead of typing"}
            className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border transition-colors ${
              mode === "listening"
                ? "pulse-ring border-red-400/60 bg-red-500/20 text-red-300"
                : "border-white/15 bg-white/[0.05] text-zinc-400 hover:border-accent/50 hover:text-accent"
            } disabled:opacity-50`}
          >
            {mode === "listening" ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
              </svg>
            )}
          </button>
        ) : null}
      </div>
      {mode === "listening" ? (
        <p className="mt-1.5 flex items-center gap-2 text-xs text-accent">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400" />
          Listening... speak freely, then press stop. AI tidies it up for you.
        </p>
      ) : mode === "polishing" ? (
        <p className="mt-1.5 flex items-center gap-2 text-xs text-zinc-400">
          <Spinner className="h-3 w-3" /> Tidying up your words with AI...
        </p>
      ) : note ? (
        <p className="mt-1.5 text-xs text-amber-300">{note}</p>
      ) : supported ? (
        <p className="mt-1.5 text-xs text-zinc-600">
          Tip: tap the mic and just talk. AI cleans up the wording when you stop.
        </p>
      ) : null}
    </div>
  );
}
