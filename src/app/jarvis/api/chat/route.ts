import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { profile } from "@/content/profile";
import { buildContext } from "@/lib/jarvis/context";
import { jarvisTools, executeTool } from "@/lib/jarvis/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";
const MAX_TOOL_LOOPS = 6;
const MAX_FILE_BYTES = 30 * 1024 * 1024; // 30 MB per file

type SupportedImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type FileResult =
  | { kind: "block"; block: Anthropic.ContentBlockParam }
  | { kind: "error"; message: string }
  | { kind: "toobig" };

/** Extract text from a PPTX file (ZIP of XML) without any extra library. */
async function extractPptxText(buffer: Buffer): Promise<string> {
  // PPTX is a ZIP. Use XLSX's zip reader since it's already a dependency.
  const zip = XLSX.CFB.read(buffer, { type: "buffer" });
  const texts: string[] = [];
  for (const entry of zip.FileIndex) {
    if (entry.name.match(/ppt\/slides\/slide\d+\.xml/)) {
      const xml = entry.content ? Buffer.from(entry.content).toString("utf-8") : "";
      // Strip XML tags and grab text runs
      const stripped = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (stripped) texts.push(stripped);
    }
  }
  return texts.join("\n\n") || "(no text content found in presentation)";
}

async function fileToContentBlock(file: File): Promise<FileResult> {
  if (file.size > MAX_FILE_BYTES) return { kind: "toobig" };

  const nameLower = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  // ---- PDF ----------------------------------------------------------------
  if (nameLower.endsWith(".pdf") || file.type === "application/pdf") {
    return {
      kind: "block",
      block: {
        type: "document",
        title: file.name,
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
      } as Anthropic.DocumentBlockParam,
    };
  }

  // ---- Images -------------------------------------------------------------
  if (IMAGE_TYPES.has(file.type)) {
    return {
      kind: "block",
      block: {
        type: "image",
        source: { type: "base64", media_type: file.type as SupportedImageType, data: buffer.toString("base64") },
      },
    };
  }

  // ---- Excel (.xlsx / .xls / .csv via SheetJS) ----------------------------
  if (nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls") ||
      nameLower.endsWith(".ods") ||
      file.type.includes("spreadsheet") || file.type.includes("excel")) {
    try {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const parts: string[] = wb.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        return `Sheet: ${name}\n${csv}`;
      });
      const text = parts.join("\n\n---\n\n");
      return {
        kind: "block",
        block: {
          type: "document",
          title: file.name,
          source: { type: "text", media_type: "text/plain", data: text },
        } as Anthropic.DocumentBlockParam,
      };
    } catch (e) {
      return { kind: "error", message: `Could not parse ${file.name}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ---- Word (.docx) via mammoth -------------------------------------------
  if (nameLower.endsWith(".docx") || nameLower.endsWith(".doc") ||
      file.type.includes("wordprocessingml") || file.type.includes("msword")) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        kind: "block",
        block: {
          type: "document",
          title: file.name,
          source: { type: "text", media_type: "text/plain", data: result.value },
        } as Anthropic.DocumentBlockParam,
      };
    } catch (e) {
      return { kind: "error", message: `Could not parse ${file.name}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ---- PowerPoint (.pptx) via ZIP+XML extraction --------------------------
  if (nameLower.endsWith(".pptx") || nameLower.endsWith(".ppt") ||
      file.type.includes("presentationml") || file.type.includes("powerpoint")) {
    try {
      const text = await extractPptxText(buffer);
      return {
        kind: "block",
        block: {
          type: "document",
          title: file.name,
          source: { type: "text", media_type: "text/plain", data: text },
        } as Anthropic.DocumentBlockParam,
      };
    } catch (e) {
      return { kind: "error", message: `Could not parse ${file.name}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ---- Plain text / Markdown / CSV / JSON ---------------------------------
  {
    const isText =
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.type === "" ||
      nameLower.endsWith(".txt") || nameLower.endsWith(".md") ||
      nameLower.endsWith(".csv") || nameLower.endsWith(".json") ||
      nameLower.endsWith(".yaml") || nameLower.endsWith(".yml");
    if (isText) {
      return {
        kind: "block",
        block: {
          type: "document",
          title: file.name,
          source: { type: "text", media_type: "text/plain", data: buffer.toString("utf-8") },
        } as Anthropic.DocumentBlockParam,
      };
    }
  }

  // ---- Unknown: try as plain text, fall back gracefully -------------------
  try {
    const text = buffer.toString("utf-8");
    // Rough heuristic: if more than 30% of chars are non-printable, it's binary
    const nonPrintable = (text.match(/[\x00-\x08\x0e-\x1f\x7f-\x9f]/g) ?? []).length;
    if (nonPrintable / text.length > 0.3) {
      return {
        kind: "error",
        message: `${file.name} appears to be a binary file Jarvis cannot read. Try converting it to PDF or text.`,
      };
    }
    return {
      kind: "block",
      block: {
        type: "document",
        title: file.name,
        source: { type: "text", media_type: "text/plain", data: text },
      } as Anthropic.DocumentBlockParam,
    };
  } catch {
    return {
      kind: "error",
      message: `${file.name} could not be read. Try converting it to PDF or text.`,
    };
  }
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

  // Process files — separate readable blocks from error notices
  const fileResults = await Promise.all(uploadedFiles.map(fileToContentBlock));
  const fileBlocks: Anthropic.ContentBlockParam[] = [];
  const errorNotices: string[] = [];
  for (const result of fileResults) {
    if (result.kind === "block") fileBlocks.push(result.block);
    else if (result.kind === "error") errorNotices.push(result.message);
    else errorNotices.push("One file was too large (max 30 MB) and was skipped.");
  }

  const userContent: Anthropic.ContentBlockParam[] = [];
  const fullText = [message, ...errorNotices].filter(Boolean).join("\n\n");
  if (fullText) userContent.push({ type: "text", text: fullText });
  userContent.push(...fileBlocks);

  if (userContent.length === 0) {
    return NextResponse.json({ error: "No readable content." }, { status: 400 });
  }

  // Persist text representation to DB
  const attachedNames = uploadedFiles.map((f) => `[attached: ${f.name}]`).join("\n");
  const dbContent = [message, attachedNames].filter(Boolean).join("\n");
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
