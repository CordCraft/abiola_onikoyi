"use client";

import { useEffect, useRef, useState } from "react";

const VOICE_KEY = "jarvis-tts-voice";

function stripForSpeech(s: string): string {
  return s
    .replace(/\[\[doc:[^|\]]+\|([^\]]+)\]\]/g, "")
    .replace(/[*_#`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunk(text: string, maxLen = 220): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).length > maxLen && cur) {
      out.push(cur.trim());
      cur = s;
    } else {
      cur = cur ? cur + " " + s : s;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Play/stop button that reads text aloud with the user's chosen Jarvis voice.
export function SpeakButton({ text, label = "Listen" }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const genRef = useRef(0);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      queueMicrotask(() => setSupported(false));
    }
    return () => {
      genRef.current += 1;
      try { window.speechSynthesis?.cancel(); } catch { /* fine */ }
    };
  }, []);

  if (!supported) return null;

  function stop() {
    genRef.current += 1;
    const u = utterRef.current;
    if (u) { u.onend = null; u.onerror = null; }
    utterRef.current = null;
    try { window.speechSynthesis.cancel(); } catch { /* fine */ }
    setSpeaking(false);
  }

  function play() {
    const plain = stripForSpeech(text);
    if (!plain) return;
    const chunks = chunk(plain);
    const gen = ++genRef.current;
    let idx = 0;
    setSpeaking(true);
    const next = () => {
      if (gen !== genRef.current) return;
      if (idx >= chunks.length) {
        utterRef.current = null;
        setSpeaking(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[idx++]);
      u.rate = 1.04;
      try {
        const wanted = localStorage.getItem(VOICE_KEY);
        if (wanted) {
          const v = window.speechSynthesis.getVoices().find((x) => x.name === wanted);
          if (v) u.voice = v;
        }
      } catch { /* fine */ }
      u.onend = () => setTimeout(next, 50);
      u.onerror = () => { if (gen === genRef.current) { utterRef.current = null; setSpeaking(false); } };
      utterRef.current = u;
      window.speechSynthesis.speak(u);
    };
    window.speechSynthesis.cancel();
    setTimeout(next, 80);
  }

  return (
    <button
      type="button"
      onClick={() => (speaking ? stop() : play())}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        speaking ? "bg-indigo-100 text-indigo-700" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      }`}
      title={speaking ? "Stop" : "Read aloud"}
    >
      {speaking ? (
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      )}
      {speaking ? "Stop" : label}
    </button>
  );
}
