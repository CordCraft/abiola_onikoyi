import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from "expo-audio";
import * as Speech from "expo-speech";
import { chat, synthesize, transcribe, VoiceUnavailableError, type ChatEvent } from "./api";

// Hands-free conversation with Jarvis, the native twin of the website's voice
// mode: record an utterance, end it on silence (energy VAD on the recorder's
// metering), transcribe with Whisper on the Jarvis voice service, stream the
// chat reply, and speak it sentence by sentence with Kokoro.
//
// Desk mode ("wake word") keeps listening for "Hey Jarvis", also with the
// screen off, because the app holds a background audio session.

export type Phase = "idle" | "standby" | "listening" | "thinking" | "speaking";

export const WAKE_RE = /(?:^|\s)(?:hey[,.\s]+)?(?:jarvis|jervis|jarvus|jarves|travis)\b[,.!?]*\s*/i;
const STOP_RE = /^(?:thanks?(?: you)?|that'?s all|goodbye|bye|stop|never ?mind)[.!\s]*(?:jarvis)?[.!]*$/i;

type Callbacks = {
  onPhase: (p: Phase) => void;
  onLevel?: (level: number) => void; // 0..1
  onHeard?: (text: string) => void;
  onReply?: (text: string) => void;
  onStatus?: (text: string) => void;
  onError?: (message: string) => void;
};

export class VoiceSession {
  private running = false;
  private threadId?: string;
  private abort?: AbortController;
  private speakingPlayer: ReturnType<typeof createAudioPlayer> | null = null;
  private voice = "bm_george";

  constructor(
    private recorder: AudioRecorder,
    private cb: Callbacks,
  ) {}

  get active() {
    return this.running;
  }

  setVoice(v: string) {
    this.voice = v;
  }

  // wake: desk mode (wait for "Hey Jarvis"). Otherwise listen straight away
  // and end the session after a quiet follow-up window.
  async start(opts: { wake: boolean; firstMessage?: string }) {
    if (this.running) return;
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      this.cb.onError?.("Microphone access is off. Turn it on in Settings, Jarvis.");
      return;
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsBackgroundRecording: opts.wake,
      interruptionMode: "doNotMix",
    });
    this.running = true;
    void this.loop(opts);
  }

  async stop() {
    this.running = false;
    this.abort?.abort();
    this.stopSpeaking();
    try {
      if (this.recorder.isRecording) await this.recorder.stop();
    } catch {
      /* already stopped */
    }
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
    this.cb.onPhase("idle");
  }

  private async loop(opts: { wake: boolean; firstMessage?: string }) {
    let followUp = !opts.wake;
    let pending = opts.firstMessage;
    while (this.running) {
      try {
        let text: string;
        if (pending) {
          text = pending;
          pending = undefined;
        } else {
          this.cb.onPhase(followUp ? "listening" : "standby");
          const uri = await this.capture(followUp ? 8000 : 20000);
          if (!this.running) break;
          if (!uri) {
            if (followUp && !opts.wake) break; // quiet: conversation over
            followUp = false;
            continue;
          }
          this.cb.onPhase("thinking");
          text = await transcribe(uri, "Hey Jarvis.");
          if (!this.running) break;
          if (!followUp) {
            const m = text.match(WAKE_RE);
            if (!m) continue; // not for us
            text = text.slice((m.index ?? 0) + m[0].length).trim();
            if (!text) {
              await this.say("Yes?");
              followUp = true;
              continue;
            }
          }
        }
        if (!text || text.replace(/[^a-z]/gi, "").length < 2) continue;
        this.cb.onHeard?.(text);
        if (STOP_RE.test(text)) {
          await this.say("Okay.");
          if (opts.wake) {
            followUp = false;
            continue;
          }
          break;
        }
        await this.converse(text);
        followUp = true;
      } catch (e) {
        if (!this.running) break;
        const msg = e instanceof Error ? e.message : String(e);
        this.cb.onError?.(msg);
        if (e instanceof VoiceUnavailableError) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (this.running) await this.stop();
  }

  // ── One utterance with silence detection ──────────────────────────────────
  private async capture(maxWaitMs: number): Promise<string | null> {
    await this.recorder.prepareToRecordAsync({ isMeteringEnabled: true });
    this.recorder.record();
    const started = Date.now();
    let floor = -50;
    let speechAt = 0;
    let lastLoud = 0;
    let loudRun = 0;
    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        const now = Date.now();
        const db = this.recorder.getStatus().metering ?? -160;
        this.cb.onLevel?.(Math.max(0, Math.min(1, (db + 60) / 50)));
        // Track the room's noise floor while nobody is talking
        if (!speechAt) floor = db < floor ? db : floor + (db - floor) * 0.02;
        const threshold = Math.max(floor + 12, -42);
        if (db > threshold) {
          loudRun += 1;
          lastLoud = now;
          if (!speechAt && loudRun >= 3) speechAt = now;
        } else {
          loudRun = 0;
        }
        const endOfSpeech = speechAt && now - lastLoud > 900;
        const gaveUp = !speechAt && now - started > maxWaitMs;
        const tooLong = now - started > 45000;
        if (!this.running || endOfSpeech || gaveUp || tooLong) {
          clearInterval(timer);
          try {
            await this.recorder.stop();
          } catch {
            /* fine */
          }
          resolve(speechAt && this.running ? this.recorder.uri : null);
        }
      }, 80);
    });
  }

  // ── Ask Jarvis and speak the reply as it streams ──────────────────────────
  private async converse(text: string) {
    this.abort = new AbortController();
    const queue: string[] = [];
    let buf = "";
    let streamDone = false;
    let full = "";

    const flush = (final: boolean) => {
      // Cut complete sentences off the front of the buffer
      for (;;) {
        const m = /^([\s\S]*?[.!?])(\s+|$)/.exec(buf);
        if (!m || (!final && m[2] === "")) break;
        const s = m[1].trim();
        if (s) queue.push(s);
        buf = buf.slice(m[0].length);
      }
      if (final && buf.trim()) {
        queue.push(buf.trim());
        buf = "";
      }
    };

    // Speaks queued sentences in order, fetching the next one's audio while
    // the current one plays.
    const speaker = (async () => {
      type Item = { text: string; audio: Promise<string | null> };
      const fetchItem = (s: string): Item => ({ text: s, audio: synthesize(s, this.voice).catch(() => null) });
      let next: Item | null = null;
      for (;;) {
        if (!this.running) return;
        if (!next) {
          const s = queue.shift();
          if (!s) {
            if (streamDone) return;
            await new Promise((r) => setTimeout(r, 60));
            continue;
          }
          next = fetchItem(s);
        }
        const cur: Item = next;
        next = queue.length ? fetchItem(queue.shift()!) : null;
        this.cb.onPhase("speaking");
        const audio = await cur.audio;
        if (!this.running) return;
        if (audio) await this.play(audio);
        else await this.speakFallback(cur.text);
      }
    })();

    try {
      const res = await chat(
        { message: text, threadId: this.threadId, voice: true },
        (e: ChatEvent) => {
          if (e.type === "delta") {
            buf += e.text;
            full += e.text;
            this.cb.onReply?.(full);
            flush(false);
          } else if (e.type === "status") {
            this.cb.onStatus?.(e.text);
          }
        },
        this.abort.signal,
      );
      this.threadId = res.threadId ?? this.threadId;
      if (!full && res.reply) {
        buf = res.reply;
        this.cb.onReply?.(res.reply);
      }
    } finally {
      flush(true);
      streamDone = true;
      await speaker;
    }
  }

  async say(text: string) {
    this.cb.onPhase("speaking");
    const audio = await synthesize(text, this.voice).catch(() => null);
    if (audio) await this.play(audio);
    else await this.speakFallback(text);
  }

  private play(uri: string): Promise<void> {
    return new Promise((resolve) => {
      const p = createAudioPlayer(uri);
      this.speakingPlayer = p;
      const done = () => {
        sub.remove();
        clearInterval(lvl);
        p.release();
        if (this.speakingPlayer === p) this.speakingPlayer = null;
        resolve();
      };
      const sub = p.addListener("playbackStatusUpdate", (s) => {
        if (s.didJustFinish) done();
      });
      // A gentle pulse for the orb while Jarvis talks
      let t = 0;
      const lvl = setInterval(() => this.cb.onLevel?.(0.45 + 0.35 * Math.abs(Math.sin((t += 0.35)))), 90);
      p.play();
      this.stopCurrent = done;
    });
  }

  private stopCurrent: (() => void) | null = null;

  private speakFallback(text: string): Promise<void> {
    return new Promise((resolve) => {
      Speech.speak(text, { language: "en-GB", onDone: () => resolve(), onStopped: () => resolve(), onError: () => resolve() });
    });
  }

  stopSpeaking() {
    try {
      this.speakingPlayer?.pause();
    } catch {
      /* gone */
    }
    this.stopCurrent?.();
    this.stopCurrent = null;
    Speech.stop();
  }
}
