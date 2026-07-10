import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { profile } from "@/content/profile";
import { buildContext } from "@/lib/jarvis/context";
import { jarvisTools, executeTool } from "@/lib/jarvis/tools";
import type { Attachment } from "@/components/jarvis/JarvisChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";
const MAX_TOOL_LOOPS = 6;

type SupportedImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function buildAttachmentBlocks(attachments: Attachment[]): {
  blocks: Anthropic.ContentBlockParam[];
  notices: string[];
} {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const notices: string[] = [];

  for (const att of attachments) {
    if (att.kind === "text") {
      if (!att.text.trim()) continue;
      blocks.push({
        type: "document",
        title: att.name,
        source: { type: "text", media_type: "text/plain", data: att.text },
      } as Anthropic.DocumentBlockParam);
    } else if (att.kind === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType as SupportedImageType,
          data: att.base64,
        },
      });
    } else {
      // kind === "error" — surface the message as a text note so Claude can explain
      notices.push(att.message);
    }
  }

  return { blocks, notices };
}

export async function POST(req: Request) {
  await verifySession();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    threadId?: string;
    message?: string;
    attachments?: Attachment[];
  };

  const message = (body.message ?? "").trim();
  const attachments: Attachment[] = body.attachments ?? [];

  if (!message && attachments.length === 0) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  // Resolve or create thread
  let threadId = body.threadId ?? null;
  if (threadId) {
    const exists = await prisma.jarvisThread.findUnique({ where: { id: threadId } });
    if (!exists) threadId = null;
  }
  if (!threadId) {
    const title =
      message.slice(0, 60) ||
      attachments
        .map((a) => a.name)
        .join(", ")
        .slice(0, 60);
    const t = await prisma.jarvisThread.create({ data: { title } });
    threadId = t.id;
  }

  // Prior messages
  const prior = await prisma.jarvisMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });

  // Build content blocks from pre-processed attachments
  const { blocks: attBlocks, notices } = buildAttachmentBlocks(attachments);

  const userContent: Anthropic.ContentBlockParam[] = [];
  const fullText = [message, ...notices].filter(Boolean).join("\n\n");
  if (fullText) userContent.push({ type: "text", text: fullText });
  userContent.push(...attBlocks);

  if (userContent.length === 0) {
    return NextResponse.json({ error: "No readable content." }, { status: 400 });
  }

  // Persist text summary to DB
  const attachedNames = attachments
    .filter((a) => a.kind !== "error")
    .map((a) => `[attached: ${a.name}]`)
    .join("\n");
  const dbContent = [message, attachedNames].filter(Boolean).join("\n");
  await prisma.jarvisMessage.create({
    data: { threadId, role: "user", content: dbContent },
  });

  const context = await buildContext();
  const system = `You are Jarvis, ${profile.name}'s personal chief-of-staff and second brain. You have live access to their ventures, projects, tasks, goals, notes and decisions (snapshot below). Be concise, direct, and action-oriented. Use the read tools to look things up when needed.

When the user wants to record or change something (a new task, note, decision, project, goal, or a status change), call the matching propose_* tool. Those create a pending card the user must Confirm before it is saved. Never claim something has been saved; say you have proposed it. Do not use em dashes.

When the user attaches files, read and analyse their full content before responding. If they describe a project or venture, extract key details and propose the relevant records.

${context}`;

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...prior.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    {
      role: "user",
      content:
        userContent.length === 1 && userContent[0].type === "text"
          ? (userContent[0] as Anthropic.TextBlockParam).text
          : userContent,
    },
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
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: out });
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
