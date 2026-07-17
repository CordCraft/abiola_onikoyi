import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { buildContext } from "@/lib/jarvis/context";
import { sendPushToAll } from "@/lib/jarvis/push";
import { profile } from "@/content/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";

// Sunday-evening review ritual: Jarvis reflects on the week and opens a chat
// thread with the review plus three planning questions, then pushes a link.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const weekAgo = new Date(Date.now() - 7 * 864e5);

  try {
    const [completedTasks, newNotes, newDecisions, newDocs, context, goals] = await Promise.all([
      prisma.jarvisTask.findMany({
        where: { status: "done", completedAt: { gt: weekAgo } },
        include: { project: { select: { name: true } } },
        take: 30,
      }),
      prisma.jarvisNote.count({ where: { createdAt: { gt: weekAgo } } }),
      prisma.jarvisDecision.findMany({
        where: { createdAt: { gt: weekAgo } },
        include: { project: { select: { name: true } } },
        take: 15,
      }),
      prisma.jarvisDocument.count({ where: { createdAt: { gt: weekAgo } } }),
      buildContext(),
      prisma.jarvisGoal.findMany({
        where: { status: "active" },
        include: { milestones: true },
      }),
    ]);

    const goalLines = goals.map((g) => {
      const done = g.milestones.filter((m) => m.done).length;
      const open = g.milestones.filter((m) => !m.done);
      const overdue = open.filter((m) => m.dueDate && m.dueDate.getTime() < Date.now()).length;
      return `- ${g.title}: ${done}/${g.milestones.length} milestones done${overdue ? `, ${overdue} overdue` : ""}${open.length === 0 ? " (NO open milestone: needs a next step or closure)" : ""}`;
    });

    const weekSummary = [
      `Completed tasks this week (${completedTasks.length}):`,
      ...completedTasks.map((t) => `- ${t.title}${t.project ? ` (${t.project.name})` : ""}`),
      `Decisions made this week (${newDecisions.length}):`,
      ...newDecisions.map((d) => `- ${d.title}${d.project ? ` (${d.project.name})` : ""}`),
      `Notes captured: ${newNotes}. Documents added: ${newDocs}.`,
      `Goal progress:`,
      ...(goalLines.length ? goalLines : ["- (no active goals)"]),
    ].join("\n");

    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: `You are Jarvis, ${profile.name}'s chief of staff, opening the Sunday weekly review. Using the week's activity and the live snapshot, write: (1) a short reflection on the week, 4-6 lines: what moved, what stalled, what was decided; (2) one line on goal progress, calling out any goal with no open milestone or overdue milestones and suggesting the next milestone; (3) exactly three sharp questions to plan next week, each on its own line starting "Q1:", "Q2:", "Q3:". Conversational, plain text, no markdown headings, no em dashes.\n\n## This week's activity\n${weekSummary}\n\n${context}`,
      messages: [{ role: "user", content: "Open my weekly review." }],
    });

    const review = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!review) {
      return NextResponse.json(
        { ok: false, error: `No review text (stop_reason: ${response.stop_reason})` },
        { status: 502 },
      );
    }

    const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date());
    const thread = await prisma.jarvisThread.create({
      data: {
        title: `Weekly review — ${date}`,
        messages: {
          create: [{ role: "assistant", content: review }],
        },
      },
    });

    const push = await sendPushToAll({
      title: "Your weekly review is ready",
      body: "Jarvis has reflected on the week and has three questions for you.",
      url: `/jarvis/chat?t=${thread.id}`,
      tag: `jarvis-review-${new Date().toISOString().slice(0, 10)}`,
    });

    return NextResponse.json({ ok: true, threadId: thread.id, ...push });
  } catch (err) {
    console.error("weekly-review failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Review failed" },
      { status: 500 },
    );
  }
}
