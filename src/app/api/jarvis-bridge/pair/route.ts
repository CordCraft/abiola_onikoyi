import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { consumePairingCode, json, newSecret, sha256 } from "../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { code, name, hostname?, os? } -> { machineId, secret, name }
// The code is single use and expires after 15 minutes. Re-pairing an existing
// name rotates that computer's secret.
export async function POST(req: Request) {
  await ensureV2Tables();
  let body: { code?: string; name?: string; hostname?: string; os?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON" }, 400);
  }
  const code = String(body.code || "");
  const name = String(body.name || "").trim().slice(0, 60);
  if (!code || !name) return json({ ok: false, error: "code and name are required" }, 400);

  if (!(await consumePairingCode(code))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return json({ ok: false, error: "Invalid or expired pairing code" }, 403);
  }

  const secret = newSecret();
  const data = {
    secretHash: sha256(secret),
    hostname: body.hostname ? String(body.hostname).slice(0, 120) : null,
    os: body.os ? String(body.os).slice(0, 120) : null,
  };
  const existing = await prisma.jarvisMachine.findUnique({ where: { name } });
  const machine = existing
    ? await prisma.jarvisMachine.update({ where: { id: existing.id }, data })
    : await prisma.jarvisMachine.create({ data: { name, ...data } });
  return json({ ok: true, machineId: machine.id, secret, name: machine.name });
}
