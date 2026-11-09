import { prisma } from "@/lib/prisma";
import { authMachine, json, unauthorized } from "../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> { job } with the oldest queued task for this computer, atomically
// claimed (queued -> running), or { job: null }.
export async function GET(req: Request) {
  const machine = await authMachine(req);
  if (!machine) return unauthorized();
  const target = `machine:${machine.id}`;

  // Tasks the agent started but never finished (crash, reboot): fail them so
  // the page does not show them running forever.
  await prisma.jarvisJob.updateMany({
    where: { target, status: "running", startedAt: { lt: new Date(Date.now() - 150 * 60_000) } },
    data: { status: "failed", error: "The computer stopped reporting on this task.", finishedAt: new Date() },
  });

  for (let i = 0; i < 3; i++) {
    const next = await prisma.jarvisJob.findFirst({
      where: { target, kind: "machine_task", status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return json({ ok: true, job: null });
    const claimed = await prisma.jarvisJob.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 1) return json({ ok: true, job: { id: next.id, payload: next.payload } });
  }
  return json({ ok: true, job: null });
}
