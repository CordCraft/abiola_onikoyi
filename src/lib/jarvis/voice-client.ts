// Browser-only voice layer for Jarvis: microphone capture with an energy based
// voice activity detector, Whisper transcription via the site proxy, and a
// sentence-by-sentence Kokoro speaker with browser speechSynthesis fallback.
//
// Server side lives in services/voice (Railway). Requests go straight to it with
// a short-lived HMAC token from /jarvis/api/voice/token (no Netlify hop); on any
// failure they fall back to the proxy routes under /jarvis/api/voice/*. A 503
// from the proxy means "not configured", and the speaker then falls back to
// speechSynthesis.

export const VOICE_PREF_KEY = "jarvis-tts-voice";

const PROXY_URLS = {
  stt: "/jarvis/api/voice/stt",
  tts: "/jarvis/api/voice/tts",
  voices: "/jarvis/api/voice/voices",
} as const;
type VoiceEndpoint = keyof typeof PROXY_URLS;
const TOKEN_URL = "/jarvis/api/voice/token";

// Netlify caps request bodies near 6 MB; the proxy rejects above 5.5 MB.
const MAX_UPLOAD_BYTES = 5.2 * 1024 * 1024;

export class VoiceUnavailableError extends Error {
  constructor(message = "Voice service is not available") {
    super(message);
    this.name = "VoiceUnavailableError";
  }
}

// ── Direct path to the voice service ─────────────────────────────────────────

type DirectConfig = { url: string; token: string; exp: number };

let direct: DirectConfig | null = null;
let directInflight: Promise<DirectConfig | null> | null = null;
let directFailedAt = 0;
const DIRECT_BACKOFF_MS = 60_000;
const REFRESH_BEFORE_MS = 60_000;

function fetchDirect(): Promise<DirectConfig | null> {
  if (directInflight) return directInflight;
  directInflight = (async () => {
    try {
      const res = await fetch(TOKEN_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as Partial<DirectConfig>;
      if (!j.url || !j.token || typeof j.exp !== "number") throw new Error("bad payload");
      direct = { url: j.url.replace(/\/+$/, ""), token: j.token, exp: j.exp };
      return direct;
    } catch {
      direct = null;
      directFailedAt = Date.now();
      return null;
    } finally {
      directInflight = null;
    }
  })();
  return directInflight;
}

// Returns a usable direct config, refreshing in the background before expiry.
async function getDirect(): Promise<DirectConfig | null> {
  const left = direct ? direct.exp * 1000 - Date.now() : -1;
  if (direct && left > REFRESH_BEFORE_MS) return direct;
  if (direct && left > 5_000) {
    void fetchDirect(); // refresh ahead of expiry; keep using the current token meanwhile
    return direct;
  }
  if (Date.now() - directFailedAt < DIRECT_BACKOFF_MS) return null;
  return fetchDirect();
}

// Direct first, proxy on any failure (network error, CORS, rejected token).
async function voiceFetch(name: VoiceEndpoint, init: RequestInit = {}): Promise<Response> {
  const d = await getDirect();
  if (d) {
    try {
      const headers = new Headers(init.headers);
      headers.set("x-voice-token", d.token);
      const res = await fetch(`${d.url}/${name}`, { ...init, headers });
      if (res.status !== 401 && res.status !== 403) return res;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
    }
    direct = null;
    directFailedAt = Date.now();
  }
  return fetch(PROXY_URLS[name], init);
}

// Call when voice mode starts: fetches the token and wakes the service so the
// first real request is not a cold start.
export function warmVoice(): void {
  void getDirect().then((d) => {
    if (d) fetch(`${d.url}/health`, { cache: "no-store" }).catch(() => {});
  });
}

// ── Service discovery ────────────────────────────────────────────────────────

export type VoiceInfo = { id: string; label: string; lang: string; gender: string; accent: string };
type VoiceList = { default: string; voices: VoiceInfo[] };

let voiceCache: VoiceList | null = null;
let voiceFailedAt = 0;

// Doubles as the "is the voice service configured and up?" probe.
export async function loadVoices(): Promise<VoiceList | null> {
  if (voiceCache) return voiceCache;
  if (Date.now() - voiceFailedAt < 30_000) return null;
  try {
    const res = await voiceFetch("voices", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as VoiceList;
    if (!Array.isArray(data.voices)) throw new Error("bad payload");
    voiceCache = data;
    return data;
  } catch {
    voiceFailedAt = Date.now();
    return null;
  }
}

export async function voiceServiceAvailable(): Promise<boolean> {
  return (await loadVoices()) !== null;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

export function stripMarkdownForSpeech(s: string): string {
  return s
    .replace(/\[\[doc:[^|\]]+\|([^\]]+)\]\]/g, "")
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, ", ")
    .replace(/\[saved:[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FIRST_CLAUSE_MIN = 25;
const FIRST_CLAUSE_MAX = 60;

// Index just past the end of the first speakable unit of `text`: a sentence end,
// or a comma/semicolon/colon after at least FIRST_CLAUSE_MIN chars, or a word
// boundary at FIRST_CLAUSE_MAX chars. Returns 0 when it is not decidable yet.
export function firstClauseEnd(text: string): number {
  let cand = -1;
  const re = /[.!?]+["')\]]*(?=\s)|[,;:](?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const isClause = /^[,;:]/.test(m[0]);
    if (isClause && end < FIRST_CLAUSE_MIN) continue;
    cand = end;
    break;
  }
  if (cand > 0 && cand <= FIRST_CLAUSE_MAX) return cand;
  if (text.length >= FIRST_CLAUSE_MAX) {
    const sp = text.lastIndexOf(" ", FIRST_CLAUSE_MAX);
    return sp > 0 ? sp : FIRST_CLAUSE_MAX;
  }
  return 0;
}

// Splits into speakable chunks. The first clause stands alone so audio
// starts quickly; later sentences are merged up to maxLen.
export function splitSentences(text: string, maxLen = 200): string[] {
  const head = firstClauseEnd(text);
  if (head > 0 && head < text.length) {
    const first = text.slice(0, head).trim();
    const rest = text.slice(head).trim();
    if (first && rest) return [first, ...splitSentencesRest(rest, maxLen)];
  }
  return splitSentencesRest(text, maxLen);
}

function splitSentencesRest(text: string, maxLen: number): string[] {
  const raw = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const pieces: string[] = [];
  for (const s of raw) {
    if (s.length <= maxLen) {
      pieces.push(s);
      continue;
    }
    let cur = "";
    for (const part of s.split(/(?<=[,;:])\s+|\s+/)) {
      if ((cur + " " + part).length > maxLen && cur) {
        pieces.push(cur.trim());
        cur = part;
      } else {
        cur = cur ? cur + " " + part : part;
      }
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  if (pieces.length === 0) return [];
  const out: string[] = [pieces[0]];
  let cur = "";
  for (const p of pieces.slice(1)) {
    if ((cur + " " + p).length > maxLen && cur) {
      out.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? cur + " " + p : p;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ── Audio context ────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) throw new Error("Web Audio is not supported in this browser");
    audioCtx = new AC();
  }
  return audioCtx;
}

// Call synchronously inside a user gesture (tap). iOS refuses to play Web Audio
// until the context has been resumed from a gesture.
export function unlockAudio(opts?: { playbackOnly?: boolean }) {
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    // Playback category ignores the ring/silent switch; with the mic open Safari needs play-and-record.
    if (nav.audioSession) nav.audioSession.type = opts?.playbackOnly ? "playback" : "play-and-record";
  } catch { /* unsupported */ }
  try {
    const c = getCtx();
    if (c.state !== "running") void c.resume();
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
  } catch { /* fine */ }
}

// True when Web Audio is allowed to play (false before a user gesture on iOS).
export function audioRunning(): boolean {
  try {
    return getCtx().state === "running";
  } catch {
    return false;
  }
}

// ── Transcription ────────────────────────────────────────────────────────────

export type Transcript = { text: string; language: string; durationSec: number };

export async function transcribe(
  blob: Blob,
  opts?: { prompt?: string; signal?: AbortSignal },
): Promise<Transcript> {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error("That recording is too long to transcribe in one piece.");
  const t = blob.type;
  const ext = t.includes("mp4") || t.includes("aac") ? "m4a" : t.includes("ogg") ? "ogg" : t.includes("wav") ? "wav" : "webm";
  const fd = new FormData();
  fd.append("audio", blob, `utterance.${ext}`);
  if (opts?.prompt) fd.append("prompt", opts.prompt);
  const res = await voiceFetch("stt", { method: "POST", body: fd, signal: opts?.signal });
  if (res.status === 503) throw new VoiceUnavailableError();
  if (!res.ok) {
    let msg = `Transcription failed (HTTP ${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = String(j.error);
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  const j = (await res.json()) as Partial<Transcript>;
  return { text: (j.text ?? "").trim(), language: j.language ?? "en", durationSec: j.durationSec ?? 0 };
}

// ── Microphone listener with voice activity detection ────────────────────────

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* keep trying */ }
  }
  return "";
}

export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it in your browser or phone settings.";
  }
  if (name === "NotFoundError") return "No microphone was found.";
  if (name === "NotReadableError") return "The microphone is in use by another app.";
  return e instanceof Error && e.message ? e.message : "Could not start the microphone.";
}

export type ListenerMode = "listen" | "boost";

export type ListenerOptions = {
  // Silence that ends an utterance.
  silenceMs?: number;
  // Hard cap; a longer utterance is flushed and a new one begins.
  maxUtteranceMs?: number;
  // Voiced audio shorter than this (clicks, coughs) is dropped.
  minSpeechMs?: number;
  onLevel?: (level01: number) => void;
  onSpeechStart?: () => void;
  onUtterance: (blob: Blob, voicedMs: number) => void;
  onError?: (message: string) => void;
};

export interface Listener {
  start(): Promise<void>;
  // flush=true emits the utterance in progress (if any) before closing.
  stop(flush?: boolean): Promise<void>;
  // "boost" demands much louder, longer speech before reporting a start; used
  // while Jarvis is talking so the speaker's own echo does not self-interrupt.
  setMode(mode: ListenerMode): void;
  readonly speaking: boolean;
}

export function createListener(opts: ListenerOptions): Listener {
  const silenceMs = opts.silenceMs ?? 550;
  const maxUtteranceMs = opts.maxUtteranceMs ?? 60_000;
  const minSpeechMs = opts.minSpeechMs ?? 250;
  const mime = pickRecorderMime();

  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let segStart = 0;
  let active = false;
  let mode: ListenerMode = "listen";

  let floor = 0.01;
  let calibUntil = 0;
  let calibSum = 0;
  let calibN = 0;
  let speaking = false;
  let speechStartAt = 0;
  let aboveSince = 0;
  let lastVoiceAt = 0;
  let smoothLevel = 0;
  const samples = new Float32Array(1024);

  function newRecorder() {
    if (!stream) return;
    const myChunks: Blob[] = [];
    chunks = myChunks;
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
    r.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) myChunks.push(e.data);
    };
    r.start();
    rec = r;
    segStart = performance.now();
  }

  // Close the current segment and immediately open a fresh one (no capture gap).
  function rotate(emit: boolean, voicedMs: number): Promise<void> {
    const old = rec;
    const oldChunks = chunks;
    if (active) newRecorder();
    else rec = null;
    if (!old) return Promise.resolve();
    return new Promise<void>((resolve) => {
      old.onstop = () => {
        if (emit && oldChunks.length) {
          const blob = new Blob(oldChunks, { type: old.mimeType || mime || "audio/webm" });
          if (blob.size > 800) opts.onUtterance(blob, voicedMs);
        }
        resolve();
      };
      try {
        if (old.state !== "inactive") old.stop();
        else old.onstop?.(new Event("stop"));
      } catch {
        resolve();
      }
    });
  }

  function rmsNow(): number {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function endSpeech(now: number) {
    const voiced = Math.max(0, lastVoiceAt - speechStartAt);
    speaking = false;
    aboveSince = 0;
    void rotate(voiced >= minSpeechMs && now > 0, voiced);
  }

  function tick() {
    if (!active) return;
    const now = performance.now();
    const rms = rmsNow();

    if (now < calibUntil) {
      calibSum += rms;
      calibN += 1;
      floor = Math.min(0.04, Math.max(0.003, calibSum / calibN));
    } else if (!speaking) {
      // Track the room: fall fast, rise slowly.
      if (rms < floor) floor = floor * 0.9 + rms * 0.1;
      else if (rms < floor * 3) floor += (rms - floor) * 0.01;
      floor = Math.min(0.05, Math.max(0.002, floor));
    }

    const boost = mode === "boost";
    const threshold = Math.max(0.015, floor * 2.5) * (boost ? 3 : 1);
    const exitThreshold = threshold * (boost ? 0.35 : 0.6);

    if (now >= calibUntil) {
      if (!speaking) {
        if (rms > threshold) {
          if (!aboveSince) aboveSince = now;
          if (now - aboveSince >= (boost ? 350 : 120)) {
            speaking = true;
            speechStartAt = aboveSince;
            lastVoiceAt = now;
            opts.onSpeechStart?.();
          }
        } else {
          aboveSince = 0;
          // Keep a rolling ~2s pre-roll so the first word is never clipped.
          if (rec && now - segStart > 2000) void rotate(false, 0);
        }
      } else {
        if (rms > exitThreshold) lastVoiceAt = now;
        if (now - lastVoiceAt > silenceMs || now - speechStartAt > maxUtteranceMs) endSpeech(now);
      }
    }

    const target = Math.min(1, Math.max(0, (rms - floor) * 9));
    smoothLevel = target > smoothLevel ? target : smoothLevel * 0.8 + target * 0.2;
    opts.onLevel?.(smoothLevel);
  }

  function cleanup() {
    if (timer) clearInterval(timer);
    timer = null;
    try { source?.disconnect(); } catch { /* fine */ }
    source = null;
    analyser = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    rec = null;
    opts.onLevel?.(0);
  }

  return {
    get speaking() {
      return speaking;
    },
    setMode(m) {
      mode = m;
      if (m === "boost") aboveSince = 0;
    },
    async start() {
      if (active) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot record audio.");
      }
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record audio.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const c = getCtx();
      if (c.state !== "running") void c.resume();
      source = c.createMediaStreamSource(stream);
      analyser = c.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser); // not to destination: no mic monitoring
      active = true;
      speaking = false;
      aboveSince = 0;
      mode = "listen";
      calibSum = 0;
      calibN = 0;
      calibUntil = performance.now() + 600;
      newRecorder();
      timer = setInterval(tick, 30);
      const track = stream.getAudioTracks()[0];
      track?.addEventListener("ended", () => {
        if (active) {
          active = false;
          cleanup();
          opts.onError?.("The microphone was disconnected.");
        }
      });
    },
    async stop(flush = false) {
      if (!active) return;
      const wasSpeaking = speaking;
      const voiced = Math.max(0, lastVoiceAt - speechStartAt);
      let pending: Promise<void> = Promise.resolve();
      if (flush && wasSpeaking && voiced >= minSpeechMs) {
        // Close the segment while still "active" so the final blob is emitted.
        const old = rec;
        const oldChunks = chunks;
        rec = null;
        if (old) {
          pending = new Promise<void>((resolve) => {
            old.onstop = () => {
              if (oldChunks.length) {
                const blob = new Blob(oldChunks, { type: old.mimeType || mime || "audio/webm" });
                if (blob.size > 800) opts.onUtterance(blob, voiced);
              }
              resolve();
            };
            try { old.stop(); } catch { resolve(); }
          });
        }
      } else if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch { /* fine */ }
      }
      active = false;
      speaking = false;
      await pending;
      cleanup();
    },
  };
}

// ── Speaker ──────────────────────────────────────────────────────────────────

export type SpeakOptions = {
  voice?: string;
  speed?: number;
  onLevel?: (level01: number) => void;
  onStart?: () => void;
};
export type SpeakResult = "done" | "stopped" | "failed";

// Speech that starts while the reply is still streaming in. push() text deltas
// as they arrive, finish() when the reply is complete; done settles when the
// audio has finished (or was stopped / could not play).
export type LiveSpeech = {
  push(delta: string): void;
  finish(): void;
  done: Promise<SpeakResult>;
};

function hasOpenMarkup(t: string): boolean {
  const open = (t.match(/\[\[/g) ?? []).length;
  const close = (t.match(/\]\]/g) ?? []).length;
  return open > close || (t.match(/```/g) ?? []).length % 2 === 1 || /\[saved:[^\]]*$/.test(t);
}

// Where to cut the next chunk out of streamed text (0 = wait for more).
function streamCut(text: string, first: boolean): number {
  if (first) return firstClauseEnd(text);
  const m = /[.!?]+["')\]]*(?=\s)/.exec(text);
  if (m) return m.index + m[0].length;
  if (text.length > 260) {
    const comma = Math.max(text.lastIndexOf(", ", 240), text.lastIndexOf("; ", 240), text.lastIndexOf(": ", 240));
    if (comma > 80) return comma + 1;
    const sp = text.lastIndexOf(" ", 240);
    return sp > 0 ? sp : 240;
  }
  return 0;
}

export function readVoicePref(): string {
  try {
    return localStorage.getItem(VOICE_PREF_KEY) ?? "";
  } catch {
    return "";
  }
}

class Speaker {
  private gen = 0;
  private abort: AbortController | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private utter: SpeechSynthesisUtterance | null = null;
  private browserDone: (() => void) | null = null;
  private onLevel: ((v: number) => void) | undefined;
  private active = false;
  private streamWake: (() => void) | null = null;

  get speaking() {
    return this.active;
  }

  stop() {
    this.gen += 1;
    this.abort?.abort();
    this.abort = null;
    try { this.source?.stop(); } catch { /* not started */ }
    this.source = null;
    if (this.utter) {
      this.utter.onend = null;
      this.utter.onerror = null;
      this.utter = null;
      try { window.speechSynthesis?.cancel(); } catch { /* fine */ }
    }
    const done = this.browserDone;
    this.browserDone = null;
    done?.();
    this.stopLevels();
    this.active = false;
    const w = this.streamWake;
    this.streamWake = null;
    w?.();
  }

  private startLevels(mode: "web" | "fake") {
    if (this.levelTimer) clearInterval(this.levelTimer);
    const data = new Uint8Array(512);
    let phase = 0;
    this.levelTimer = setInterval(() => {
      let lvl = 0;
      if (mode === "web" && this.analyser) {
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        lvl = Math.min(1, Math.sqrt(sum / data.length) * 3.5);
      } else {
        phase += 0.35;
        lvl = 0.35 + 0.25 * Math.sin(phase) * Math.sin(phase * 0.37);
      }
      this.onLevel?.(lvl);
    }, 40);
  }

  private stopLevels() {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.onLevel?.(0);
  }

  private async fetchBuffer(text: string, voice: string, speed: number | undefined, signal: AbortSignal) {
    let res: Response;
    try {
      res = await voiceFetch("tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: voice || undefined, speed }),
        signal,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new VoiceUnavailableError("Voice service unreachable");
    }
    if (!res.ok) throw new VoiceUnavailableError(`Voice service error (${res.status})`);
    const bytes = await res.arrayBuffer();
    try {
      return await getCtx().decodeAudioData(bytes);
    } catch {
      throw new VoiceUnavailableError("Could not decode audio");
    }
  }

  private playBuffer(buf: AudioBuffer): Promise<void> {
    return new Promise<void>((resolve) => {
      const c = getCtx();
      if (!this.analyser) {
        this.analyser = c.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.connect(c.destination);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(this.analyser);
      this.source = src;
      src.onended = () => {
        if (this.source === src) this.source = null;
        resolve();
      };
      src.start();
    });
  }

  private browserSpeak(text: string, gen: number, voice: string): Promise<SpeakResult> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve("failed");
    const chunks = splitSentences(text, 220);
    if (chunks.length === 0) return Promise.resolve("done");
    return new Promise<SpeakResult>((resolve) => {
      let idx = 0;
      let finished = false;
      const finish = (r: SpeakResult) => {
        if (finished) return;
        finished = true;
        this.browserDone = null;
        this.utter = null;
        resolve(r);
      };
      this.browserDone = () => finish("stopped");
      this.startLevels("fake");
      const next = () => {
        if (gen !== this.gen) return finish("stopped");
        if (idx >= chunks.length) return finish("done");
        const u = new SpeechSynthesisUtterance(chunks[idx++]);
        u.rate = 1.04;
        try {
          const v = window.speechSynthesis.getVoices().find((x) => x.name === voice);
          if (v) u.voice = v;
        } catch { /* fine */ }
        u.onend = () => setTimeout(next, 50);
        u.onerror = () => finish(gen === this.gen ? "failed" : "stopped");
        this.utter = u; // hold the ref (iOS GC bug)
        window.speechSynthesis.speak(u);
      };
      try { window.speechSynthesis.cancel(); } catch { /* fine */ }
      setTimeout(next, 80);
    });
  }

  // Resolves when playback finished ("done"), was interrupted ("stopped"), or
  // nothing could speak ("failed"). Starting a new speak() stops the previous.
  async speak(text: string, opts: SpeakOptions = {}): Promise<SpeakResult> {
    this.stop();
    const gen = this.gen;
    const plain = stripMarkdownForSpeech(text);
    if (!plain) return "done";
    const chunks = splitSentences(plain);
    if (chunks.length === 0) return "done";

    const voice = opts.voice ?? readVoicePref();
    this.onLevel = opts.onLevel;
    this.active = true;
    const abort = new AbortController();
    this.abort = abort;

    const fetches: Promise<AudioBuffer>[] = [];
    const get = (i: number) => {
      if (i >= chunks.length) return;
      if (!fetches[i]) {
        const p = this.fetchBuffer(chunks[i], voice, opts.speed, abort.signal);
        p.catch(() => {}); // surfaced where awaited; avoid unhandled noise after stop()
        fetches[i] = p;
      }
    };

    let started = false;
    try {
      get(0);
      for (let i = 0; i < chunks.length; i++) {
        let buf: AudioBuffer;
        try {
          buf = await fetches[i];
        } catch (e) {
          if (gen !== this.gen) return "stopped";
          if ((e as Error)?.name === "AbortError") return "stopped";
          // Service missing or failing: finish the rest with the browser voice.
          return await this.browserSpeak(chunks.slice(i).join(" "), gen, voice);
        }
        if (gen !== this.gen) return "stopped";
        get(i + 1); // prefetch the next sentence while this one plays
        if (!started) {
          started = true;
          this.startLevels("web");
          opts.onStart?.();
        }
        await this.playBuffer(buf);
        if (gen !== this.gen) return "stopped";
      }
      return "done";
    } finally {
      if (gen === this.gen) {
        this.stopLevels();
        this.active = false;
        this.abort = null;
      }
    }
  }

  // Starts speaking before the whole reply exists. The first clause goes to TTS
  // as soon as it streams in; later chunks are whole sentences, synthesized in
  // order while the previous one plays.
  speakStream(opts: SpeakOptions = {}): LiveSpeech {
    this.stop();
    const gen = this.gen;
    const voice = opts.voice ?? readVoicePref();
    this.onLevel = opts.onLevel;
    this.active = true;
    const abort = new AbortController();
    this.abort = abort;

    const chunks: string[] = [];
    const fetches: Promise<AudioBuffer>[] = [];
    let pending = "";
    let first = true;
    let ended = false;
    const notify = () => {
      const w = this.streamWake;
      this.streamWake = null;
      w?.();
    };
    const alive = () => gen === this.gen;

    const enqueue = (raw: string) => {
      const plain = stripMarkdownForSpeech(raw);
      if (!plain) return;
      for (const piece of plain.length > 260 ? splitSentencesRest(plain, 200) : [plain]) {
        const i = chunks.length;
        chunks.push(piece);
        // Synthesize in order: a later chunk must never delay an earlier one.
        const prev = i === 0 ? Promise.resolve() : fetches[i - 1].then(() => undefined, () => undefined);
        const p = prev.then(() => this.fetchBuffer(piece, voice, opts.speed, abort.signal));
        p.catch(() => {});
        fetches.push(p);
      }
      notify();
    };

    const drain = (final: boolean) => {
      if (!alive()) return;
      for (;;) {
        if (!final && hasOpenMarkup(pending)) break;
        const cut = streamCut(pending, first);
        if (cut <= 0 || cut >= pending.length) break;
        enqueue(pending.slice(0, cut));
        pending = pending.slice(cut).replace(/^\s+/, "");
        first = false;
      }
      if (final && pending.trim()) {
        enqueue(pending);
        pending = "";
      }
    };

    const run = async (): Promise<SpeakResult> => {
      let started = false;
      try {
        for (let i = 0; ; i++) {
          while (i >= chunks.length && !ended && alive()) {
            await new Promise<void>((r) => {
              this.streamWake = r;
            });
          }
          if (!alive()) return "stopped";
          if (i >= chunks.length) return "done";
          let buf: AudioBuffer;
          try {
            buf = await fetches[i];
          } catch (e) {
            if (!alive() || (e as Error)?.name === "AbortError") return "stopped";
            while (!ended && alive()) {
              await new Promise<void>((r) => {
                this.streamWake = r;
              });
            }
            if (!alive()) return "stopped";
            return await this.browserSpeak(chunks.slice(i).join(" "), gen, voice);
          }
          if (!alive()) return "stopped";
          if (!started) {
            started = true;
            this.startLevels("web");
            opts.onStart?.();
          }
          await this.playBuffer(buf);
          if (!alive()) return "stopped";
        }
      } finally {
        if (alive()) {
          this.stopLevels();
          this.active = false;
          this.abort = null;
        }
      }
    };

    return {
      push: (delta) => {
        if (ended || !alive()) return;
        pending += delta;
        drain(false);
      },
      finish: () => {
        if (ended) return;
        drain(true);
        ended = true;
        notify();
      },
      done: run(),
    };
  }
}

let speakerInstance: Speaker | null = null;

// One shared speaker so only a single thing talks at a time (chat voice mode
// and the per-message Listen buttons share it).
export function getSpeaker(): Speaker {
  if (!speakerInstance) speakerInstance = new Speaker();
  return speakerInstance;
}

export type { Speaker };
