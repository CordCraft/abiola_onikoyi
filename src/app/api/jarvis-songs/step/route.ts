import { NextResponse, after } from "next/server";
import { runStep, sweepSongs, type Step } from "@/lib/jarvis/songs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal hand-off between the steps of a liked song (research, analysis,
// writing). Each step runs in its own invocation so none runs into Netlify's
// time limit. Lives under /api (outside the session proxy) and only answers
// the server itself, with x-cron-secret.
const STEPS: Step[] = ["research", "listening", "analysis", "writing"];

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; step?: Step; notify?: boolean; sweep?: boolean };
  // Scheduled (netlify/functions/songs-sweep.mts): move songs stuck listening.
  if (body.sweep) return NextResponse.json({ ok: true, moved: await sweepSongs() });
  if (!body.id || !body.step || !STEPS.includes(body.step)) {
    return NextResponse.json({ error: "id and step are required" }, { status: 400 });
  }
  const { id, step, notify } = body;
  after(() => runStep(id, step, { notify: Boolean(notify) }));
  return NextResponse.json({ ok: true }, { status: 202 });
}
