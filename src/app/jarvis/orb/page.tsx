"use client";

import { useEffect, useState } from "react";
import { JarvisOrb, type OrbState } from "@/components/jarvis/Orb";

const STATES: OrbState[] = ["idle", "listening", "thinking", "speaking"];

export default function OrbShowcase() {
  const [state, setState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0.4);
  const [auto, setAuto] = useState(false);

  // Optional fake audio so the voice reaction can be judged without a mic.
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      const t = Date.now() / 1000;
      setLevel(Math.max(0, Math.min(1, 0.45 + 0.35 * Math.sin(t * 7) * Math.sin(t * 2.3) + 0.15 * Math.sin(t * 17))));
    }, 50);
    return () => clearInterval(id);
  }, [auto]);

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-zinc-950 px-4 py-10">
      <h1 className="text-xl font-semibold text-white">Orb</h1>
      <JarvisOrb state={state} level={level} size={320} />

      <div className="flex flex-wrap justify-center gap-2">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(s)}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${
              state === s
                ? "bg-sky-500 text-zinc-950"
                : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="flex w-full max-w-sm flex-col gap-2 text-sm text-zinc-300">
        Level: {level.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={level}
          disabled={auto}
          onChange={(e) => setLevel(Number(e.target.value))}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Simulate speech
      </label>

      <div className="flex items-end gap-6">
        <JarvisOrb state={state} level={level} size={96} />
        <JarvisOrb state={state} level={level} size={48} />
      </div>
    </main>
  );
}
