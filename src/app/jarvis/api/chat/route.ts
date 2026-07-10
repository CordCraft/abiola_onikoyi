import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { profile } from "@/content/profile";
import { buildContext } from "@/lib/jarvis/context";
import { jarvisTools, executeTool } from "@/lib/jarvis/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow long document-analysis calls

const MODEL = "claude-opus-4-8";
const MAX_TOOL_LOOPS = 6;
// Keep each document under ~40k tokens. 1 token ≈ 4 chars.
const MAX_CHARS_PER_FILE = 120_000;

type SupportedImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

type Attachment =
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; mimeType: string; base64: string }
  | { kind: "error"; name: string; message: string };

function buildAttachmentBlocks(attachments: Attachment[]): {
  blocks: Anthropic.ContentBlockParam[];
  notices: string[];
} {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const notices: string[] = [];

  for (const att of attachments) {
    if (att.kind === "text") {
      let text = att.text.trim();
      if (!text) continue;
      if (text.length > MAX_CHARS_PER_FILE) {
        text =
          text.slice(0, MAX_CHARS_PER_FILE) +
          `\n\n[... document truncated at ${MAX_CHARS_PER_FILE.toLocaleString()} characters ...]`;
      }
      blocks.push({
        type: "document",
        title: att.name,
        source: { type: "text", media_type: "text/plain", data: text },
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
      notices.push(att.message);
    }
  }

  return { blocks, notices };
}

export async function POST(req: Request) {
  // Wrap everything so ANY unhandled exception returns proper JSON instead of
  // Netlify's opaque error body (which the client shows as "Request failed.").
  try {
    await verifySession();
  } catch {
    return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: { threadId?: string; message?: string; attachments?: Attachment[] };
  try {
    body = (await req.json()) as typeof body;
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse request body: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  const message = (body.message ?? "").trim();
  const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments : [];

  if (!message && attachments.length === 0) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  // Resolve or create thread
  let threadId = body.threadId ?? null;
  try {
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
  } catch (e) {
    return NextResponse.json(
      { error: `Database error: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
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
    return NextResponse.json({ error: "No readable content was sent." }, { status: 400 });
  }

  // Persist text summary to DB
  const attachedNames = attachments
    .filter((a) => a.kind !== "error")
    .map((a) => `[attached: ${a.name}]`)
    .join("\n");
  const dbContent = [message, attachedNames].filter(Boolean).join("\n");

  try {
    await prisma.jarvisMessage.create({
      data: { threadId, role: "user", content: dbContent },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not save message: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

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

  // Stream newline-delimited JSON events back to the client. Streaming keeps
  // the connection alive during long Opus calls (avoiding serverless TTFB
  // timeouts) and shows the reply live as it is written.
  const resolvedThreadId = threadId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      // Emit the threadId immediately so the client can update the URL and the
      // connection receives its first byte right away.
      send({ type: "meta", threadId: resolvedThreadId });

      let finalText = "";
      try {
        for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
          const messageStream = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system,
            tools: jarvisTools,
            messages,
          });

          // Stream text deltas live to the client
          messageStream.on("text", (delta) => {
            send({ type: "delta", text: delta });
          });

          const response = await messageStream.finalMessage();

          if (response.stop_reason === "tool_use") {
            messages.push({ role: "assistant", content: response.content });
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of response.content) {
              if (block.type === "tool_use") {
                const out = await executeTool(block.name, block.input, resolvedThreadId);
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
        send({ type: "error", error: `Anthropic API error: ${err instanceof Error ? err.message : String(err)}` });
        controller.close();
        return;
      }

      if (!finalText) finalText = "(no response)";

      // Persist and gather proposals
      try {
        await prisma.jarvisMessage.create({
          data: { threadId: resolvedThreadId, role: "assistant", content: finalText },
        });
        await prisma.jarvisThread.update({
          where: { id: resolvedThreadId },
          data: { updatedAt: new Date() },
        });
      } catch {
        // Non-fatal
      }

      const proposals = await prisma.jarvisProposal.findMany({
        where: { threadId: resolvedThreadId, status: "pending" },
        orderBy: { createdAt: "asc" },
      });

      send({ type: "done", threadId: resolvedThreadId, reply: finalText, proposals });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
