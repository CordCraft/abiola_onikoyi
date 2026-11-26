import "server-only";
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/lib/jarvis/v2/signals";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { approveItem, closeItem, getItem, itemContext, needsYou, parseWhen, snoozeItem, type Item } from "@/lib/jarvis/items";
import { startTurnStep } from "@/lib/jarvis/app-turn";

// WhatsApp "Message yourself" is a Jarvis inbox. The listener forwards what
// the owner types in his own chat to /api/jarvis-app/wa; this file answers.
//   "list"          numbered list of what needs him
//   "3 done"        close item 3 (also "done 3", "2, 5 done")
//   "3 tomorrow"    move it (friday, next week, later)
//   "3 send"        send the drafted reply / do the proposed action
//   "3 drop"        no longer needed
//   "3 <anything>"  talk to Jarvis about item 3 (its own chat)
//   anything else   a normal chat with Jarvis, answered here

const LIST_KEY = "wa_item_list";
const THREAD_KEY = "wa_thread";

export async function sendWhatsAppSelf(text: string): Promise<void> {
  await ensureV2Tables();
  await enqueueJob("send_whatsapp_self", { text: text.slice(0, 3800) });
}

async function getSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.jarvisSetting.findUnique({ where: { key } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const v = JSON.stringify(value);
  await prisma.jarvisSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export async function rememberWaThread(threadId: string): Promise<void> {
  await setSetting(THREAD_KEY, { threadId, at: new Date().toISOString() }).catch(() => {});
}

// One running WhatsApp conversation, restarted after 12 quiet hours.
async function currentWaThread(): Promise<string | null> {
  const s = await getSetting<{ threadId: string; at: string }>(THREAD_KEY);
  if (!s || Date.now() - new Date(s.at).getTime() > 12 * 3600e3) return null;
  return s.threadId;
}

function line(n: number, i: Item): string {
  const bits = [i.project, i.due ? `${i.overdue ? "overdue " : ""}${i.due}` : null].filter(Boolean).join(", ");
  return `${n}. ${i.title}${bits ? ` (${bits})` : ""}`;
}

export async function listText(reason?: string): Promise<string> {
  const items = await needsYou(10);
  await setSetting(LIST_KEY, { at: new Date().toISOString(), refs: items.map((i) => i.ref) });
  if (!items.length) return "Nothing needs you right now. All clear.";
  const head = reason === "morning" ? `Good morning. ${items.length} thing${items.length === 1 ? "" : "s"} need you today:` : `Needs you (${items.length}):`;
  return `${head}\n${items.map((i, n) => line(n + 1, i)).join("\n")}\n\nReply "2 done", "3 tomorrow", "1 send", "4 drop", or "5 <anything>" to talk about one.`;
}

async function refsFor(nums: number[]): Promise<(string | null)[]> {
  const s = await getSetting<{ refs: string[] }>(LIST_KEY);
  return nums.map((n) => s?.refs?.[n - 1] ?? null);
}

const DONE = /^(done|did it|did|handled|sorted|ok done|closed?|finished|completed?|paid|sent|yes done|✅|👍|✔️?)$/i;
const DROP = /^(drop|skip|no|not needed|cancel|ignore|dismiss|remove|delete)$/i;
const SEND = /^(send|send it|do it|go|go ahead|approve|yes)$/i;

export async function handleWa(input: { text?: string; command?: string; reason?: string }, base: string): Promise<void> {
  await ensureV2Tables();
  if (input.command === "list") {
    await sendWhatsAppSelf(await listText(input.reason));
    return;
  }
  const text = (input.text ?? "").trim();
  if (!text) return;

  if (/^(list|items|todo|to do|tasks|\?|menu|what'?s (left|on)|whats (left|on))$/i.test(text)) {
    await sendWhatsAppSelf(await listText());
    return;
  }

  // "3 done", "2, 5 done", "done 3", "3 friday", "3 I already paid him"
  let m = /^((?:\d{1,2}\s*(?:,|&|and)?\s*)+)([\s\S]*)$/i.exec(text);
  const lead = /^(done|drop|skip|send|close)\s+((?:\d{1,2}\s*(?:,|&|and)?\s*)+)$/i.exec(text);
  if (lead) m = [text, lead[2], lead[1]] as unknown as RegExpExecArray;
  if (m) {
    const nums = [...m[1].matchAll(/\d{1,2}/g)].map((x) => Number(x[0])).filter((n) => n > 0);
    const rest = m[2].trim().replace(/[.!]+$/, "");
    const refs = await refsFor(nums);
    if (refs.some((r) => !r)) {
      await sendWhatsAppSelf(`I don't have item ${nums.filter((_, i) => !refs[i]).join(", ")} on the last list.\n\n${await listText()}`);
      return;
    }
    const when = rest ? parseWhen(rest) : null;
    const out: string[] = [];
    if (!rest || DONE.test(rest) || DROP.test(rest) || SEND.test(rest) || when) {
      for (const ref of refs as string[]) {
        const found = await getItem(ref);
        const title = found?.item.title ?? ref;
        let r: string;
        if (!rest) {
          r = found ? `${found.item.title}${found.item.detail ? `\n${found.item.detail}` : ""}${found.item.note ? `\nYour plan: ${found.item.note}` : ""}` : "Not found.";
        } else if (DONE.test(rest)) r = await closeItem(ref, "You marked it done on WhatsApp.");
        else if (DROP.test(rest)) r = await closeItem(ref, "Not needed (you said so on WhatsApp).", ref.startsWith("task") ? "archived" : "done");
        else if (SEND.test(rest)) r = `${title}: ${await approveItem(ref)}`;
        else r = `${title}: ${await snoozeItem(ref, when!)}`;
        out.push(r);
      }
      const left = rest ? (await needsYou(200)).length : null;
      await sendWhatsAppSelf(`${out.join("\n")}${left !== null ? `\n\n${left} left. Send "list" for the list.` : ""}`);
      return;
    }
    // Free text about one item: its own chat, answered here.
    if (refs.length === 1) {
      const found = await getItem(refs[0]!);
      if (found) {
        const threadId = found.item.threadId;
        const message = threadId ? rest :`${itemContext(found.item)}\n\n[Sent from WhatsApp; keep the answer short and plain.]\n\n${rest}`;
        await startTurnStep({ threadId, message, item: found.item.ref, via: "whatsapp" }, base);
        return;
      }
    }
  }

  // Anything else is a normal chat with Jarvis.
  const threadId = await currentWaThread();
  const message = threadId ? text : `[Sent from WhatsApp, the owner's own chat. Keep answers short and plain: no tables, no headings. His numbered list is in "list" and he can reply "3 done".]\n\n${text}`;
  await startTurnStep({ threadId, message, via: "whatsapp" }, base);
}
