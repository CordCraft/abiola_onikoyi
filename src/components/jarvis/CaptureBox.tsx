"use client";

import { useRef, useState } from "react";
import { captureText } from "@/app/jarvis/actions";

// Ten-second capture: thought in, saved to the Inbox, zero filing decisions.
// Jarvis files inbox items into projects when asked (or overnight).
export function CaptureBox({ autoFocus }: { autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  async function save() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await captureText(text);
      if (r.error) {
        setFlash(r.error);
      } else {
        setValue("");
        setFlash("Captured. Ask Jarvis to file your inbox any time.");
        setTimeout(() => setFlash(null), 3500);
      }
    } catch {
      // Offline: keep the text in the box so nothing is lost.
      setFlash("You're offline. Keep this tab open and try again when connected.");
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setFlash("Voice capture is not supported in this browser.");
      return;
    }
    if (listening) {
      try { recRef.current?.stop(); } catch { /* fine */ }
      recRef.current = null;
      setListening(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SR() as any;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    let committed = value;
    rec.onresult = (e: { results: { isFinal: boolean; [k: number]: { transcript: string } }[]; resultIndex: number }) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) committed = (committed + " " + t).trimStart();
        else interim += t;
      }
      setValue(committed + (interim ? " " + interim : ""));
    };
    rec.onend = () => {
      if (recRef.current === rec) {
        recRef.current = null;
        setListening(false);
      }
    };
    rec.onerror = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch { /* fine */ }
  }

  return (
    <div className="rounded-2xl border border-white/60 bg-white/80 p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_10px_30px_-12px_rgba(0,0,0,0.12)] backdrop-blur-sm">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
          autoFocus={autoFocus}
          rows={1}
          placeholder={listening ? "Listening..." : "Capture a thought... (saved to your inbox)"}
          className="min-h-[42px] min-w-0 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
        />
        <button
          type="button"
          onClick={toggleMic}
          aria-label="Dictate capture"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors ${
            listening ? "bg-red-100 text-red-600" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          }`}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !value.trim()}
          className="h-10 shrink-0 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
        >
          {busy ? "..." : "Capture"}
        </button>
      </div>
      {flash ? <p className="mt-2 text-xs text-zinc-500">{flash}</p> : null}
    </div>
  );
}
