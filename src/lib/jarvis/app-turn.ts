import "server-only";
import { prisma } from "@/lib/prisma";
import { encryptSession } from "@/lib/jwt";
import { sendPushToAll } from "@/lib/jarvis/push";

// Runs a Jarvis chat turn on the owner's behalf for a reply typed into a
// notification banner, then sends Jarvis's answer back as a notification
// (which can be replied to again, continuing the same chat).
//
// It drives the normal chat route (same tools, memory and checkpointing) with
// a short-lived server-minted session. One step = one chat invocation. When
// the chat route checkpoints a long turn, the next step is started as a fresh
// request to /api/jarvis-app/turn, so no single function runs long.

export type TurnStep = {
  threadId?: string | null;
  message?: string;
  resumeStateId?: string;
  replyTo?: string | null; // notification id being answered
  hop?: number;
};

const MAX_HOPS = 6;

export function siteBase(req?: Request): string {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || (req ? new URL(req.url).origin : "http://localhost:3000");
}

// Kick off a step in its own invocation and return once it has been accepted.
export async function startTurnStep(step: TurnStep, base: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("app-turn: CRON_SECRET missing, cannot run reply turns");
    return false;
  }
  try {
    const res = await fetch(`${base}/api/jarvis-app/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify(step),
    });
    return res.ok;
  } catch (err) {
    console.error("app-turn: could not start step", err);
    return false;
  }
}

type ChatEvent = { type: string; threadId?: string; text?: string; reply?: string; stateId?: string; error?: string };

export async function runTurnStep(step: TurnStep, base: string): Promise<void> {
  const hop = step.hop ?? 0;
  const token = await encryptSession({
    user: process.env.ADMIN_USERNAME || "jarvis-app",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  let threadId = step.threadId ?? null;
  let text = "";
  let reply: string | null = null;
  let resume: string | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(`${base}/jarvis/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `session=${token}` },
      body: JSON.stringify(step.resumeStateId ? { threadId, resumeStateId: step.resumeStateId } : { threadId, message: step.message, attachments: [], voice: false }),
    });
    if (!res.ok || !res.body) {
      error = `chat answered HTTP ${res.status}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt: ChatEvent;
          try {
            evt = JSON.parse(line) as ChatEvent;
          } catch {
            continue;
          }
          if (evt.type === "meta" && evt.threadId) threadId = evt.threadId;
          else if (evt.type === "delta" && evt.text) text += evt.text;
          else if (evt.type === "done") {
            reply = evt.reply ?? text;
            if (evt.threadId) threadId = evt.threadId;
          } else if (evt.type === "resume" && evt.stateId) resume = evt.stateId;
          else if (evt.type === "error") error = evt.error ?? "Jarvis hit an error";
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (resume && hop < MAX_HOPS) {
    const ok = await startTurnStep({ threadId, resumeStateId: resume, replyTo: step.replyTo, hop: hop + 1 }, base);
    if (ok) return;
    error = "could not continue the reply";
  }

  if (error) console.error(`app-turn: reply turn failed (hop ${hop}): ${error}`);
  const answer = (reply ?? text).trim();
  if (step.replyTo) {
    await prisma.jarvisNotification.update({ where: { id: step.replyTo }, data: { threadId: threadId ?? undefined } }).catch(() => {});
  }
  if (!answer && !error) return;

  await sendPushToAll({
    title: error ? "Jarvis could not finish that" : "Jarvis",
    body: error ? `${error}. Open Jarvis to try again.` : plain(answer),
    url: threadId ? `/jarvis/chat?t=${threadId}` : "/jarvis/chat",
    kind: "reply",
    threadId: threadId ?? undefined,
    tag: `jarvis-answer-${Date.now()}`,
  });
}

// Notification banners show plain text: drop markdown and citation markup.
function plain(s: string): string {
  return s
    .replace(/\[\[doc:[^|\]]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 900);
}
