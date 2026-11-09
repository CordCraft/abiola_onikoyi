import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { executeTool, jarvisTools } from "@/lib/jarvis/tools";
import { executeMachineTool, machineTools } from "@/lib/jarvis/tools-machines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal stateless MCP server (Streamable HTTP, JSON responses only) so the
// Claude app on the phone or desktop can use Jarvis as a custom connector.
// URL: /api/jarvis-mcp/<JARVIS_MCP_TOKEN>. The secret path is the credential.

const LATEST_PROTOCOL = "2025-06-18";
const SUPPORTED = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

function tokenOk(given: string): boolean {
  const expected = process.env.JARVIS_MCP_TOKEN;
  if (!expected || expected.length < 16) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const notFound = () => new Response("Not found", { status: 404 });

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const getTodayTool = {
  name: "get_today",
  description:
    "Today at a glance: open tasks due today or overdue, the latest morning briefing, and recent unhandled Jarvis signals (new or pushed).",
  input_schema: { type: "object" as const, properties: {} },
};

async function getToday(): Promise<string> {
  await ensureV2Tables();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const [tasks, briefing, signals] = await Promise.all([
    prisma.jarvisTask.findMany({
      where: { status: { not: "done" }, dueDate: { not: null, lte: endOfToday } },
      orderBy: { dueDate: "asc" },
      take: 30,
    }),
    prisma.jarvisNote.findFirst({
      where: { body: { startsWith: "Morning briefing:" } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.jarvisSignal.findMany({
      where: { status: { in: ["new", "pushed"] } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 15,
    }),
  ]);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const parts: string[] = [];
  parts.push(
    tasks.length
      ? `Tasks due or overdue:\n${tasks.map((t) => `- ${t.title} [${t.priority}, due ${day(t.dueDate)}] id:${t.id}`).join("\n")}`
      : "Tasks due or overdue: none.",
  );
  parts.push(
    briefing
      ? `Latest briefing (${briefing.createdAt.toISOString().slice(0, 16)}Z):\n${briefing.body.replace(/^Morning briefing:\s*/, "")}`
      : "Latest briefing: none yet.",
  );
  parts.push(
    signals.length
      ? `Signals needing attention:\n${signals
          .map((s) => `- [${s.kind}, score ${s.score}] ${s.title}${s.detail ? `: ${s.detail.slice(0, 160)}` : ""} id:${s.id}`)
          .join("\n")}`
      : "Signals needing attention: none.",
  );
  return parts.join("\n\n");
}

const MACHINE_NAMES = new Set(machineTools.map((t) => t.name));

function toolList() {
  const all = [...jarvisTools, getTodayTool] as {
    name: string;
    description?: string;
    input_schema?: unknown;
  }[];
  return all
    .filter((t) => t.input_schema)
    .map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.input_schema }));
}

async function handle(msg: Rpc): Promise<Record<string, unknown> | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  // Notifications and responses carry no id: nothing to answer.
  if (msg.id === undefined || msg.id === null) return null;

  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED.has(asked) ? asked : LATEST_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "jarvis", version: "1.0.0" },
        instructions: "Jarvis is Abiola's private second brain: projects, tasks, notes, documents and his computers.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: toolList() });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const args = msg.params?.arguments ?? {};
      if (!toolList().some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      try {
        const text =
          name === "get_today"
            ? await getToday()
            : MACHINE_NAMES.has(name)
              ? // Over the connector, computer tasks are look-only: a leaked URL must not edit files.
                await executeMachineTool(name, name === "run_on_computer" ? { ...(args as Record<string, unknown>), mode: "plan" } : args)
              : await executeTool(name, args);
        const failed = /^(Error|Unknown tool)\b/i.test(text);
        return ok({ content: [{ type: "text", text }], isError: failed });
      } catch (e) {
        return ok({
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : "tool failed"}` }],
          isError: true,
        });
      }
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!tokenOk(token)) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const headers = { "cache-control": "no-store" };
  if (Array.isArray(body)) {
    const out = (await Promise.all((body as Rpc[]).map(handle))).filter(Boolean);
    return out.length ? Response.json(out, { headers }) : new Response(null, { status: 202 });
  }
  const res = await handle(body as Rpc);
  return res ? Response.json(res, { headers }) : new Response(null, { status: 202 });
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!tokenOk(token)) return notFound();
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!tokenOk(token)) return notFound();
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}
