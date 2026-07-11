import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { buildContext } from "@/lib/jarvis/context";
import { getUpcomingEvents, formatEvents } from "@/lib/jarvis/calendar";
import { profile } from "@/content/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";

// Generates the morning briefing with Claude and delivers it to every
// subscribed device via Web Push. Triggered by the Netlify scheduled function.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return NextResponse.json({ ok: true, skipped: "VAPID keys not configured" });
  }

  const subscriptions = await prisma.jarvisPushSubscription.findMany();
  if (subscriptions.length === 0) {
    return NextResponse.json({ ok: true, skipped: "No subscribed devices" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  try {
    // Live workspace snapshot + calendar + preferences + resurfaced memories.
    const [context, events, prefs, feedback, oldNotes, oldDecisions] = await Promise.all([
      buildContext(),
      getUpcomingEvents(1),
      prisma.jarvisSetting.findUnique({ where: { key: "briefing_prefs" } }),
      prisma.jarvisSetting.findUnique({ where: { key: "briefing_feedback" } }),
      prisma.jarvisNote.findMany({
        where: { createdAt: { lt: new Date(Date.now() - 21 * 864e5) } },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { project: { select: { name: true } } },
      }),
      prisma.jarvisDecision.findMany({
        where: { createdAt: { lt: new Date(Date.now() - 21 * 864e5) } },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { project: { select: { name: true } } },
      }),
    ]);

    // Resurface up to two old items (age-weighted random) so past knowledge
    // keeps circulating instead of rotting.
    const pool = [
      ...oldNotes.map((n) => `note${n.project ? ` on ${n.project.name}` : ""}: ${n.body.slice(0, 180)}`),
      ...oldDecisions.map((d) => `decision${d.project ? ` on ${d.project.name}` : ""}: ${d.title} (${d.rationale.slice(0, 120)})`),
    ];
    const resurfaced: string[] = [];
    for (let i = 0; i < 2 && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      resurfaced.push(pool.splice(idx, 1)[0]);
    }

    const extras = [
      events?.length ? `## Today's calendar\n${formatEvents(events)}` : "",
      prefs?.value ? `## The user's standing briefing preferences (follow these)\n${prefs.value}` : "",
      feedback?.value ? `## Recent briefing feedback (+1 good, -1 bad)\n${feedback.value}` : "",
      resurfaced.length
        ? `## From the archives (optionally weave ONE in if relevant today)\n${resurfaced.map((r) => `- ${r}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: `You are Jarvis, ${profile.name}'s chief of staff. Write today's morning briefing from the workspace snapshot below. Rules: 3 to 6 short lines, most important first. Cover: today's meetings if any, anything overdue or due soon, stalled projects that need a push, and the single highest-leverage action for today. Plain text only, no markdown, no preamble, no sign-off, no em dashes. If there is genuinely nothing actionable, say so in one line.\n\n${extras}\n\n${context}`,
      messages: [{ role: "user", content: "Write today's briefing." }],
    });

    const briefing = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .slice(0, 1500);

    if (!briefing) {
      return NextResponse.json(
        { ok: false, error: `Model returned no briefing text (stop_reason: ${response.stop_reason})` },
        { status: 502 },
      );
    }

    // Store the briefing as a note so it is part of the record.
    await prisma.jarvisNote.create({
      data: { body: `Morning briefing:\n${briefing}` },
    });

    webpush.setVapidDetails("mailto:abiolaonikoyi@gmail.com", publicKey, privateKey);

    const payload = JSON.stringify({
      title: "Jarvis morning briefing",
      body: briefing.length > 240 ? briefing.slice(0, 237) + "..." : briefing,
      url: "/jarvis",
      tag: `jarvis-briefing-${new Date().toISOString().slice(0, 10)}`,
    });

    let sent = 0;
    let pruned = 0;
    let failed = 0;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600 * 6, urgency: "normal" },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription is dead; remove it.
          await prisma.jarvisPushSubscription
            .delete({ where: { endpoint: sub.endpoint } })
            .catch(() => {});
          pruned += 1;
        } else {
          // 401/403 (VAPID mismatch) and transient errors must be visible in
          // the function log, not silently swallowed.
          failed += 1;
          console.error(`daily-briefing: push failed (${status ?? "?"}) for a device`, err);
        }
      }
    }

    return NextResponse.json(
      { ok: sent > 0 || subscriptions.length === 0, sent, pruned, failed, devices: subscriptions.length },
      { status: sent === 0 && failed > 0 ? 502 : 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Briefing failed" },
      { status: 500 },
    );
  }
}
