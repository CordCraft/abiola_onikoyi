import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { buildContext } from "@/lib/jarvis/context";
import { jarvisTools, executeTool, type SavedRecord } from "@/lib/jarvis/tools";
import { profile } from "@/content/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";
const MAX_LOOPS = 6;
// Only the tools the filing job needs; no web, no destructive surface.
const FILING_TOOLS = new Set([
  "list_projects",
  "get_project",
  "file_note",
  "create_task",
  "log_note",
]);

// Nightly inbox filing: Jarvis attaches each quick capture to the right
// project (and turns action-like captures into tasks) so mornings start clean.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const inbox = await prisma.jarvisNote.findMany({
    where: { source: "capture", projectId: null },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (!inbox.length) {
    return NextResponse.json({ ok: true, skipped: "Inbox empty" });
  }

  const context = await buildContext();
  const system = `You are Jarvis, ${profile.name}'s chief of staff, doing the nightly inbox filing. For EACH inbox item in the snapshot below: file_note it to the clearly matching project; if it reads like an action, ALSO create_task for it on that project; if no project clearly fits, leave it in the inbox (do nothing for that item). Never invent projects. Work through every item, then reply with one line per item saying what you did. Do not use em dashes.\n\n${context}`;

  const tools = jarvisTools.filter((t) => FILING_TOOLS.has(t.name));
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "File my inbox now." },
  ];
  const saved: SavedRecord[] = [];

  try {
    for (let i = 0; i < MAX_LOOPS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system,
        tools,
        messages,
      });

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            let out: string;
            try {
              out = await executeTool(block.name, block.input, {
                onSaved: (r) => saved.push(r),
              });
            } catch (e) {
              out = `Tool failed: ${e instanceof Error ? e.message : String(e)}`;
            }
            results.push({ type: "tool_result", tool_use_id: block.id, content: out });
          }
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      break;
    }
  } catch (err) {
    console.error("auto-file failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Filing failed", filed: saved.length },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, inbox: inbox.length, actions: saved.length });
}
