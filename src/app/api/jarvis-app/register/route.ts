import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureCompanionTables } from "@/lib/jarvis/companion-setup";
import { phoneAuthorised } from "@/lib/jarvis/phone-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The native app registers its Expo push token on every launch.
// POST { pushToken: "ExponentPushToken[...]", name?: "Abiola's iPhone" }
export async function POST(req: Request) {
  if (!(await phoneAuthorised(req))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { pushToken?: string; name?: string } | null;
  const pushToken = String(body?.pushToken ?? "").trim();
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(pushToken)) return NextResponse.json({ error: "pushToken must be an Expo push token" }, { status: 400 });
  await ensureCompanionTables();
  await prisma.jarvisAppDevice.upsert({
    where: { pushToken },
    create: { pushToken, name: body?.name?.slice(0, 80) ?? null },
    update: { lastSeenAt: new Date(), name: body?.name?.slice(0, 80) ?? undefined },
  });
  return NextResponse.json({ ok: true });
}

// The app forgets this phone (sign out).
export async function DELETE(req: Request) {
  if (!(await phoneAuthorised(req))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { pushToken?: string } | null;
  if (body?.pushToken) await prisma.jarvisAppDevice.delete({ where: { pushToken: body.pushToken } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
