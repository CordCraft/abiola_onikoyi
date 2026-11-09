import { prisma } from "@/lib/prisma";
import { authMachine, json, toJson, unauthorized } from "../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST status snapshot from the bridge agent every ~30s.
export async function POST(req: Request) {
  const machine = await authMachine(req);
  if (!machine) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON" }, 400);
  }
  const status = {
    uptimeSec: Number(body.uptimeSec) || null,
    claudeVersion: typeof body.claudeVersion === "string" ? body.claudeVersion.slice(0, 80) : null,
    bridgeVersion: Number(body.bridgeVersion) || 1,
    roots: Array.isArray(body.roots) ? body.roots.slice(0, 10).map((r) => String(r).slice(0, 260)) : [],
    busyJobId: typeof body.busyJobId === "string" ? body.busyJobId : null,
    repos: Array.isArray(body.repos) ? body.repos.slice(0, 80) : [],
    sessions: Array.isArray(body.sessions) ? body.sessions.slice(0, 10) : [],
  };
  await prisma.jarvisMachine.update({
    where: { id: machine.id },
    data: {
      status: toJson(status),
      lastSeenAt: new Date(),
      hostname: typeof body.hostname === "string" ? body.hostname.slice(0, 120) : machine.hostname,
      os: typeof body.os === "string" ? body.os.slice(0, 120) : machine.os,
    },
  });
  return json({ ok: true, serverTime: new Date().toISOString() });
}
