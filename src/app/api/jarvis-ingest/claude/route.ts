import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexRecord } from "@/lib/jarvis/embeddings";
import { ensureSyncTables } from "@/lib/jarvis/sync/setup";
import { recordActivity, resolveProjectId } from "@/lib/jarvis/sync/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Receives Claude Code session reports from the jarvis-sync hook on the
// laptop (~/.claude/hooks/jarvis-sync.mjs). Same secret as /api/capture.
//
// POST {
//   sessionId, cwd, gitRemote?, branch?, firstPrompt?, lastMessage?, at?,
//   memory?: [{ name, content }]   // Claude's project memory files
// }
type Body = {
  sessionId?: string;
  cwd?: string;
  gitRemote?: string | null;
  branch?: string | null;
  firstPrompt?: string | null;
  lastMessage?: string | null;
  at?: string;
  memory?: { name?: string; content?: string }[];
};

function repoFromRemote(remote?: string | null): string | null {
  const m = remote?.match(/github\.com[/:]([^/]+\/[^/\s]+?)(?:\.git)?\s*$/i);
  return m ? m[1] : null;
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-capture-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  await ensureSyncTables();
  const out: { session?: string; memory: number } = { memory: 0 };

  if (body.sessionId && body.cwd) {
    const repo = repoFromRemote(body.gitRemote);
    const folder = body.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || body.cwd;
    const subject = repo ?? folder;
    const projectId = await resolveProjectId("claude", subject, {
      autoCreate: Boolean(repo),
      alsoTry: repo ? [{ source: "github", subject: repo }] : [],
    });
    const first = (body.firstPrompt ?? "").replace(/\s+/g, " ").trim();
    await recordActivity({
      source: "claude",
      kind: "session",
      externalId: `claude:session:${body.sessionId}`,
      subject,
      title: `Claude Code session in ${folder}${first ? `: ${first.slice(0, 140)}` : ""}`,
      detail: [
        body.branch ? `Branch ${body.branch}` : "",
        body.lastMessage ? `Latest from Claude:\n${body.lastMessage.slice(0, 3000)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      state: "active",
      projectId,
      occurredAt: body.at ? new Date(body.at) : new Date(),
    });
    out.session = subject;
  }

  // Claude's memory files describe where every project stands. Keep one
  // document per file, updated in place, so Jarvis can search them.
  for (const m of (body.memory ?? []).slice(0, 60)) {
    const name = (m.name ?? "").trim();
    const content = (m.content ?? "").trim();
    if (!name || !content) continue;
    const docName = `Claude memory: ${name}`.slice(0, 200);
    const existing = await prisma.jarvisDocument.findFirst({ where: { name: docName } });
    if (existing?.content === content) continue;
    const doc = existing
      ? await prisma.jarvisDocument.update({ where: { id: existing.id }, data: { content: content.slice(0, 200_000) } })
      : await prisma.jarvisDocument.create({ data: { name: docName, content: content.slice(0, 200_000) } });
    void indexRecord("document", doc.id, doc.content, doc.name);
    out.memory++;
  }

  return NextResponse.json({ ok: true, ...out });
}
