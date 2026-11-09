import { prisma } from "@/lib/prisma";
import { asResult, authMachine, json, ownedJob, toJson, unauthorized } from "../../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { lines: string[] } appends to result.progress (last 50 kept).
// Responds { cancel: true } when the owner cancelled the task from the page.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const machine = await authMachine(req);
  if (!machine) return unauthorized();
  const { id } = await ctx.params;
  const job = await ownedJob(machine, id);
  if (!job) return json({ ok: false, error: "Not found" }, 404);
  if (job.status === "cancelled") return json({ ok: true, cancel: true });
  if (job.status !== "running") return json({ ok: true, cancel: false });

  let body: { lines?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const lines = Array.isArray(body.lines)
    ? body.lines.map((l) => String(l).slice(0, 300)).filter(Boolean).slice(0, 40)
    : [];
  if (lines.length) {
    const result = asResult(job.result);
    const progress = [...(result.progress ?? []), ...lines].slice(-50);
    await prisma.jarvisJob.update({
      where: { id },
      data: { result: toJson({ ...result, progress, lastProgressAt: new Date().toISOString() }) },
    });
  }
  return json({ ok: true, cancel: false });
}
