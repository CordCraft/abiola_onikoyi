import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { profile } from "@/content/profile";
import { buildContext } from "@/lib/jarvis/context";
import { jarvisTools, executeTool } from "@/lib/jarvis/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";
const MAX_TOOL_LOOPS = 6;

export async function POST(req: Request) {
  await verifySession();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  const bodyJson = (await req.json().catch(() => ({}))) as {
    threadId?: string;
    message?: string;
  };
  const message = (bodyJson.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  // Resolve or create the thread.
  let threadId = bodyJson.threadId ?? null;
  if (threadId) {
    const exists = await prisma.jarvisThread.findUnique({ where: { id: threadId } });
    if (!exists) threadId = null;
  }
  if (!threadId) {
    const t = await prisma.jarvisThread.create({
      data: { title: message.slice(0, 60) },
    });
    threadId = t.id;
  }

  // Prior conversation (persisted text only) + the new user message.
  const prior = await prisma.jarvisMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });
  await prisma.jarvisMessage.create({
    data: { threadId, role: "user", content: message },
  });

  const context = await buildContext();
  const system = `You are Jarvis, ${profile.name}'s personal chief-of-staff and second brain. You have live access to their ventures, projects, tasks, goals, notes and decisions (snapshot below). Be concise, direct, and action-oriented. Use the read tools to look things up when needed.

When the user wants to record or change something (a new task, note, decision, project, goal, or a status change), call the matching propose_* tool. Those create a pending card the user must Confirm before it is saved. Never claim something has been saved; say you have proposed it. Do not use em dashes.

${context}`;

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...prior.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  let finalText = "";
  try {
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system,
        tools: jarvisTools,
        messages,
      });

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            const out = await executeTool(block.name, block.input, threadId);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: out,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed." },
      { status: 500 },
    );
  }

  if (!finalText) finalText = "(no response)";

  await prisma.jarvisMessage.create({
    data: { threadId, role: "assistant", content: finalText },
  });
  await prisma.jarvisThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });

  const proposals = await prisma.jarvisProposal.findMany({
    where: { threadId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ threadId, reply: finalText, proposals });
}
