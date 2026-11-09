"use client";

import { useEffect, useRef, useState } from "react";
import { getSpeaker, unlockAudio } from "@/lib/jarvis/voice-client";

// Play/stop button that reads text aloud with the user's chosen Jarvis voice
// (Kokoro via the voice service, browser speechSynthesis if it is unavailable).
export function SpeakButton({ text, label = "Listen" }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const genRef = useRef(0);

  useEffect(() => {
    return () => {
      // Only silence the shared speaker if this button started the current speech.
      if (genRef.current > 0) {
        genRef.current += 1;
        getSpeaker().stop();
      }
    };
  }, []);

  function stop() {
    genRef.current += 1;
    getSpeaker().stop();
    setSpeaking(false);
  }

  function play() {
    if (!text.trim()) return;
    unlockAudio({ playbackOnly: true });
    const gen = ++genRef.current;
    setSpeaking(true);
    void getSpeaker()
      .speak(text)
      .then(() => {
        if (gen === genRef.current) setSpeaking(false);
      });
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
