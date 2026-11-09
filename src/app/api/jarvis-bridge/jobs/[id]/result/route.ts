import { prisma } from "@/lib/prisma";
import { asResult, authMachine, json, ownedJob, toJson, unauthorized } from "../../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { text, costUsd?, sessionId?, exitCode, error? } finishes the task.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const machine = await authMachine(req);
  if (!machine) return unauthorized();
  const { id } = await ctx.params;
  const job = await ownedJob(machine, id);
  if (!job) return json({ ok: false, error: "Not found" }, 404);

  let body: { text?: unknown; costUsd?: unknown; sessionId?: unknown; exitCode?: unknown; error?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON" }, 400);
  }
  const exitCode = Number.isFinite(Number(body.exitCode)) ? Number(body.exitCode) : 1;
  const result = asResult(job.result);
  const text = String(body.text ?? "").slice(0, 100_000);
  const cancelled = job.status === "cancelled";
  await prisma.jarvisJob.update({
    where: { id },
    data: {
      status: cancelled ? "cancelled" : exitCode === 0 ? "done" : "failed",
      error: exitCode === 0 ? null : String(body.error ?? text).slice(0, 500) || "Failed",
      finishedAt: new Date(),
      result: toJson({
        ...result,
        text,
        costUsd: typeof body.costUsd === "number" ? body.costUsd : null,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
        exitCode,
      }),
    },
  });
  return json({ ok: true });
}
