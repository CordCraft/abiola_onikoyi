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
  const system = `You are Jarvis, ${profile.name}'s personal chief-of-staff and second brain. You have live access to their ventures, projects, tasks, goals, notes and decisions (snapshot below). Be concise, direct, and action-oriented. Use the read tools to look things up when needed. Do not use em dashes.

## How you record things (CRITICAL)
To record or change ANYTHING (a task, note, decision, project, goal, or status change) you MUST call the matching propose_* tool. Each call creates a pending card the user Confirms before it is saved.

Hard rules, no exceptions:
- When the user asks you to save, record, add, update, or "load into the knowledge base", emit the propose_* tool call(s) IN THE SAME TURN. You can and should emit MULTIPLE tool calls in one turn.
- NEVER write "here they come", "I'll propose", "let me create", "I'll now add", or describe records in prose as a substitute for calling the tool. Narrating intent without emitting the tool call is a failure. Act first, then briefly confirm what you proposed.
- Always pass the correct projectId (shown as [project:<id>] in the snapshot) or projectName so the record attaches to the right project. For the Nikstalis Data Centre work, attach notes, decisions, and tasks to that project.
- After the tool calls, tell the user the cards are ready to Confirm. Never claim something is already saved; it is saved only after they Confirm.

## Working with attached files
When the user attaches files, read and analyse their FULL content. If they ask you to capture the content, immediately propose the concrete records: a project summary update (propose_update_project), one or more notes capturing the key findings (propose_log_note), decisions with rationale (propose_log_decision), and any concrete next actions as tasks (propose_create_task). Extract real specifics from the documents, do not ask the user to paste content you can already see.

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
      let usedTool = false;
      let forcedOnce = false;
      // Force the model to actually emit tool calls when the user clearly wants
      // something recorded (or attached files that should be captured), instead
      // of just describing the records in prose and ending the turn.
      const shouldForceTools =
        attachments.some((a) => a.kind !== "error") ||
        /\b(add|capture|save|record|log|update|create|store|load|note|task|decision|propose|knowledge base|memory|overview|project)\b/i.test(
          message,
        );

      try {
        for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
          // On a forcing pass we require a tool call via tool_choice.
          const forceThisPass = shouldForceTools && !usedTool && i > 0 && forcedOnce;

          const messageStream = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system,
            tools: jarvisTools,
            tool_choice: forceThisPass ? { type: "any" } : { type: "auto" },
            messages,
          });

          // Stream text deltas live to the client
          messageStream.on("text", (delta) => {
            send({ type: "delta", text: delta });
          });

          const response = await messageStream.finalMessage();

          if (response.stop_reason === "tool_use") {
            usedTool = true;
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

          // Model ended its turn. If it should have recorded something but never
          // called a tool, nudge it once to actually emit the tool calls.
          if (shouldForceTools && !usedTool && !forcedOnce) {
            forcedOnce = true;
            messages.push({ role: "assistant", content: response.content });
            messages.push({
              role: "user",
              content:
                "Now actually emit the propose_* tool calls for everything you just described. Call the tools directly. Do not reply with prose.",
            });
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
