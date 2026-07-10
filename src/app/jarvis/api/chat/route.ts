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
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

type SupportedImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function fileToContentBlock(
  file: File,
): Promise<Anthropic.ContentBlockParam | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const type = file.type;

  if (type === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    } as Anthropic.ContentBlockParam;
  }
  if (IMAGE_TYPES.has(type)) {
    return {
      type: "image",
      source: { type: "base64", media_type: type as SupportedImageType, data: base64 },
    };
  }
  // Plain text / markdown / CSV — embed as text
  const text = buffer.toString("utf-8");
  return { type: "text", text: `[File: ${file.name}]\n${text}` };
}

export async function POST(req: Request) {
  await verifySession();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  // Accept both JSON (text-only) and multipart/form-data (with files)
  const contentType = req.headers.get("content-type") ?? "";
  let message = "";
  let threadId: string | null = null;
  let uploadedFiles: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    message = ((fd.get("message") as string | null) ?? "").trim();
    threadId = (fd.get("threadId") as string | null) ?? null;
    uploadedFiles = fd.getAll("files").filter((v): v is File => v instanceof File);
  } else {
    const body = (await req.json().catch(() => ({}))) as {
      threadId?: string;
      message?: string;
    };
    message = (body.message ?? "").trim();
    threadId = body.threadId ?? null;
  }

  if (!message && uploadedFiles.length === 0) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  // Resolve or create thread
  if (threadId) {
    const exists = await prisma.jarvisThread.findUnique({ where: { id: threadId } });
    if (!exists) threadId = null;
  }
  if (!threadId) {
    const title = message.slice(0, 60) || uploadedFiles.map((f) => f.name).join(", ").slice(0, 60);
    const t = await prisma.jarvisThread.create({ data: { title } });
    threadId = t.id;
  }

  // Prior messages
  const prior = await prisma.jarvisMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });

  // Build content for this turn
  const fileBlocks: Anthropic.ContentBlockParam[] = (
    await Promise.all(uploadedFiles.map(fileToContentBlock))
  ).filter((b): b is Anthropic.ContentBlockParam => b !== null);

  const userContent: Anthropic.ContentBlockParam[] = [];
  if (message) userContent.push({ type: "text", text: message });
  userContent.push(...fileBlocks);

  // Persist text representation to DB
  const dbContent =
    message +
    (uploadedFiles.length
      ? (message ? "\n" : "") + uploadedFiles.map((f) => `[attached: ${f.name}]`).join("\n")
      : "");
  await prisma.jarvisMessage.create({
    data: { threadId, role: "user", content: dbContent },
  });

  const context = await buildContext();
  const system = `You are Jarvis, ${profile.name}'s personal chief-of-staff and second brain. You have live access to their ventures, projects, tasks, goals, notes and decisions (snapshot below). Be concise, direct, and action-oriented. Use the read tools to look things up when needed.

When the user wants to record or change something (a new task, note, decision, project, goal, or a status change), call the matching propose_* tool. Those create a pending card the user must Confirm before it is saved. Never claim something has been saved; say you have proposed it. Do not use em dashes.

When the user attaches files, read and analyse their content before responding. If a file describes a project or venture, offer to create it.

${context}`;

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...prior.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    {
      role: "user",
      content: userContent.length === 1 && userContent[0].type === "text"
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
