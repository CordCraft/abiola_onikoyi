import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { buildToday } from "@/lib/jarvis/mobile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Open tasks matching ?q= (Siri resolves "mark the tax filing done" with this).
export async function GET(req: Request) {
  if (!(await getSession())) return unauthorized();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const tasks = await prisma.jarvisTask.findMany({
    where: { status: { in: ["todo", "doing"] }, ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 30,
    select: { id: true, title: true, priority: true, status: true, dueDate: true },
  });
  return NextResponse.json({ tasks });
}

// Quick add from the app, Siri or a widget. due: "today" | "tomorrow" | YYYY-MM-DD.
export async function POST(req: Request) {
  if (!(await getSession())) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { title?: string; due?: string; priority?: string };
  const title = String(body.title ?? "").trim().slice(0, 300);
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  let dueDate: Date | null = null;
  if (body.due === "today" || body.due === "tomorrow") {
    const { date } = await buildToday(1);
    const d = new Date(date); // midnight UTC of the owner's local day, the tools' convention
    if (body.due === "tomorrow") d.setUTCDate(d.getUTCDate() + 1);
    dueDate = d;
  } else if (body.due && /^\d{4}-\d{2}-\d{2}$/.test(body.due)) {
    dueDate = new Date(body.due);
  }
  const priority = ["low", "medium", "high"].includes(String(body.priority)) ? String(body.priority) : "medium";

  const task = await prisma.jarvisTask.create({ data: { title, dueDate, priority } });
  return NextResponse.json({ ok: true, task: { id: task.id, title: task.title } });
}
