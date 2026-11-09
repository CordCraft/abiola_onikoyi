import "server-only";
import type { JarvisSignal } from "@prisma/client";
import type { SignalView } from "@/components/jarvis/SignalCard";
import { actionLabel } from "@/lib/jarvis/v2/signals";

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";

type ActionJson = { type?: string; payload?: { text?: string; to?: string; start?: string; title?: string } };
type ResultJson = { error?: string; event?: { link?: string; account?: string }; mode?: string };

export function toView(s: JarvisSignal): SignalView {
  const action = (s.action ?? {}) as ActionJson;
  const result = (s.result ?? {}) as ResultJson;
  const at = action.type === "calendar_event" && action.payload?.start ? new Date(action.payload.start) : s.dueAt;
  let resultNote: string | null = null;
  if (result.error) resultNote = `Failed: ${result.error}`;
  else if (result.event?.account) resultNote = `Added to ${result.event.account}.`;
  else if (result.mode === "draft") resultNote = "Saved as a draft.";
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    detail: s.detail,
    why: s.why,
    score: s.score,
    source: s.source,
    status: s.status,
    actionType: action.type ?? null,
    actionLabel: actionLabel(action.type),
    replyText: action.payload?.text ?? null,
    replyTo: action.payload?.to ?? null,
    when: at && !Number.isNaN(at.getTime())
      ? at.toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : null,
    createdAt: s.createdAt.toISOString(),
    resultNote,
  };
}
