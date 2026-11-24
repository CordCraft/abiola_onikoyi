import { File, Paths } from "expo-file-system";
import { loadPairing, shareToday, type Pairing } from "./storage";

export type TodayTask = {
  id: string;
  title: string;
  priority: string;
  status: string;
  due: string | null;
  bucket: "overdue" | "today" | "doing" | "next";
  project: string | null;
};

export type Today = {
  generatedAt: string;
  tz: string;
  date: string;
  counts: { overdue: number; today: number; doing: number; open: number; doneToday: number; signals: number };
  tasks: TodayTask[];
  speech: string;
};

export class UnauthorizedError extends Error {}

let cached: Pairing | null = null;
export function setPairingCache(p: Pairing | null) {
  cached = p;
}

async function pairing(): Promise<Pairing> {
  if (!cached) cached = await loadPairing();
  if (!cached) throw new UnauthorizedError("Not paired");
  return cached;
}

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const p = await pairing();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${p.token}`);
  const res = await fetch(`${p.host}${path}`, { ...init, headers });
  if (res.status === 401) throw new UnauthorizedError("Jarvis signed this app out. Pair it again.");
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await api(path, init);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `Jarvis answered ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getToday(): Promise<Today> {
  const t = await json<Today>("/jarvis/api/mobile/today?limit=40");
  shareToday(JSON.stringify({ ...t, tasks: t.tasks.slice(0, 8) }));
  return t;
}

export type TaskAction = "done" | "snooze" | "reopen" | "doing" | "today" | "high" | "medium" | "low";

export async function taskAction(taskId: string, action: TaskAction): Promise<void> {
  await json("/jarvis/api/task-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, action }),
  });
}

export async function addTask(title: string, due?: "today" | "tomorrow"): Promise<void> {
  await json("/jarvis/api/mobile/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, due }),
  });
}

// Push registration and banner replies use the companion routes the site
// already has (/api/jarvis-app/*); they accept this app's device token.
export async function registerPushToken(token: string, name = "iPhone"): Promise<void> {
  await json("/api/jarvis-app/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pushToken: token, name }),
  });
}

export async function unregisterPushToken(token: string): Promise<void> {
  await json("/api/jarvis-app/register", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pushToken: token }),
  });
}

export async function replyToNotification(
  notificationId: string,
  body: { action?: "reply" | "done" | "approve" | "dismiss"; text?: string },
): Promise<void> {
  await json("/api/jarvis-app/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notificationId, ...body }),
  });
}

// ── Voice ────────────────────────────────────────────────────────────────────

export class VoiceUnavailableError extends Error {}

// Uploads a recorded m4a as the raw request body (the site accepts audio/*).
export async function transcribe(uri: string, prompt?: string): Promise<string> {
  const bytes = await new File(uri).bytes();
  const qs = prompt ? `?prompt=${encodeURIComponent(prompt)}` : "";
  const res = await api(`/jarvis/api/voice/stt${qs}`, {
    method: "POST",
    headers: { "content-type": "audio/mp4" },
    body: bytes,
  });
  if (res.status === 503) throw new VoiceUnavailableError("Voice service is offline");
  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const j = (await res.json()) as { text?: string };
  return (j.text ?? "").trim();
}

let ttsSeq = 0;
// Returns a local file URI with the spoken mp3 for one sentence.
export async function synthesize(text: string, voice = "bm_george"): Promise<string> {
  const res = await api("/jarvis/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (res.status === 503) throw new VoiceUnavailableError("Voice service is offline");
  if (!res.ok) throw new Error(`Speech failed (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const file = new File(Paths.cache, `tts-${ttsSeq++ % 50}.mp3`);
  if (file.exists) file.delete();
  file.create();
  await file.write(buf);
  return file.uri;
}

// ── Chat (NDJSON stream, same route as the website) ──────────────────────────

export type ChatEvent =
  | { type: "meta"; threadId: string }
  | { type: "delta"; text: string }
  | { type: "status"; text: string }
  | { type: "saved"; record: { kind: string; summary: string } }
  | { type: "resume"; stateId: string }
  | { type: "done"; threadId: string; reply: string }
  | { type: "error"; error?: string; message?: string }
  | { type: "ping" };

export async function chat(
  body: { message?: string; threadId?: string; voice?: boolean },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<{ threadId?: string; reply: string }> {
  let payload: Record<string, unknown> = body;
  let threadId = body.threadId;
  let reply = "";
  // A long turn can hand over to a fresh server invocation ("resume").
  for (let hop = 0; hop < 8; hop++) {
    const res = await api("/jarvis/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Chat failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let resumeId: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let e: ChatEvent;
        try {
          e = JSON.parse(line) as ChatEvent;
        } catch {
          continue;
        }
        if (e.type === "meta") threadId = e.threadId;
        if (e.type === "delta") reply += e.text;
        if (e.type === "done") reply = e.reply || reply;
        if (e.type === "resume") resumeId = e.stateId;
        if (e.type === "error") throw new Error(e.error ?? e.message ?? "Jarvis hit an error");
        onEvent(e);
      }
    }
    if (!resumeId) break;
    payload = { threadId, resumeStateId: resumeId };
  }
  return { threadId, reply };
}
