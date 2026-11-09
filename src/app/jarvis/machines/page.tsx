import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { statusOf, viewJob, type MachineStatus } from "@/lib/jarvis/tools-machines";
import { MachinesBoard } from "@/components/jarvis/machines/MachinesBoard";

export const dynamic = "force-dynamic";

export default async function MachinesPage() {
  await verifySession();
  await ensureV2Tables();
  const [machines, jobs] = await Promise.all([
    prisma.jarvisMachine.findMany({ orderBy: { name: "asc" } }),
    prisma.jarvisJob.findMany({ where: { kind: "machine_task" }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);

  const machineData = machines.map((m) => ({
    id: m.id,
    name: m.name,
    hostname: m.hostname,
    os: m.os,
    lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
    status: statusOf(m.status) as MachineStatus,
  }));
  const jobData = jobs.map((j) => {
    const v = viewJob(j);
    return {
      ...v,
      createdAt: v.createdAt.toISOString(),
      finishedAt: v.finishedAt ? v.finishedAt.toISOString() : null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Computers</h1>
        <p className="mt-1 text-sm text-zinc-500">
          See every computer, what is open on it, and send it work from your phone.
        </p>
      </div>
      <MachinesBoard machines={machineData} jobs={jobData} />
    </div>
  );
}
