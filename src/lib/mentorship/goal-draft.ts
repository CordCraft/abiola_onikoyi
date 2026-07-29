import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { MentorshipMentee } from "@prisma/client";

// Drafts three starter goals from a mentee's signup profile so their first
// portal visit already reflects their story. The mentor refines these in the
// first one-on-one. Uses the same plain-JSON pattern as generate-post.ts;
// falls back to sensible templates when the API key is absent or the call
// fails, so signup never blocks on the model.

const MODEL = "claude-opus-4-8";

type DraftGoal = {
  title: string;
  detail: string;
  targetMonth: number;
};

const DRAFT_NOTE =
  "Drafted from your signup answers. Refine it with your mentor in your first one-on-one.";

function fallbackGoals(mentee: MentorshipMentee): DraftGoal[] {
  const interest = mentee.interests?.split(",")[0]?.trim() || "your focus area";
  return [
    {
      title: `Map your path into ${interest}`,
      detail: `Turn your 2-year vision into a concrete plan: the roles to target, the skills gap to close, and the people to learn from. ${DRAFT_NOTE}`,
      targetMonth: 1,
    },
    {
      title: "Build visible proof of your ability",
      detail: `Overhaul your CV and LinkedIn, and start one small project or certification in ${interest} you can point to. ${DRAFT_NOTE}`,
      targetMonth: 2,
    },
    {
      title: "Deliver a capstone artifact",
      detail: `Finish the programme with one tangible output: a published article, a completed project, a certification, or an application package. ${DRAFT_NOTE}`,
      targetMonth: 3,
    },
  ];
}

export function profileSummary(mentee: MentorshipMentee): string {
  const lines = [
    `Name: ${mentee.name}`,
    mentee.level ? `Level: ${mentee.level} chemical engineering, UNILAG` : null,
    mentee.gradYear ? `Expected graduation: ${mentee.gradYear}` : null,
    mentee.interests ? `Interests: ${mentee.interests}` : null,
    mentee.skills ? `Skills and tools: ${mentee.skills}` : null,
    mentee.dreamRoles ? `Dream roles: ${mentee.dreamRoles}` : null,
    mentee.backgroundStory ? `Background story: ${mentee.backgroundStory}` : null,
    mentee.aspirations ? `2-year vision: ${mentee.aspirations}` : null,
    mentee.longTermVision ? `5-year vision: ${mentee.longTermVision}` : null,
    mentee.expectations ? `Wants from the mentorship: ${mentee.expectations}` : null,
    mentee.challenges ? `Biggest challenge: ${mentee.challenges}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

async function generateWithClaude(
  mentee: MentorshipMentee,
): Promise<DraftGoal[]> {
  const client = new Anthropic();
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 1200,
      system:
        "You are helping a senior petroleum engineer (17+ years, Shell and Saudi Aramco) mentor Nigerian chemical engineering students through a three-month programme (month 1: discovery and direction, month 2: build and exposure, month 3: deliver and launch). Given a mentee's self-reported profile, draft exactly 3 personal, specific, achievable goals, one per programme month. Write titles under 60 characters in plain language. Each detail is 1 to 3 sentences describing what done looks like, grounded in the mentee's own story and aspirations. Do not use em dashes anywhere. Respond with ONLY a JSON array of objects with keys: title, detail, targetMonth (1, 2 or 3).",
      messages: [
        {
          role: "user",
          content: `Draft the 3 goals for this mentee:\n\n${profileSummary(mentee)}`,
        },
      ],
    },
    { timeout: 20_000 },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of goals");

  const goals = parsed
    .filter(
      (g): g is { title: unknown; detail: unknown; targetMonth: unknown } =>
        typeof g === "object" && g !== null,
    )
    .map((g) => ({
      title: String(g.title ?? "").slice(0, 120),
      detail: `${String(g.detail ?? "").slice(0, 800)}\n\n${DRAFT_NOTE}`,
      targetMonth:
        Number(g.targetMonth) >= 1 && Number(g.targetMonth) <= 3
          ? Number(g.targetMonth)
          : 1,
    }))
    .filter((g) => g.title)
    .slice(0, 3);

  if (goals.length === 0) throw new Error("No usable goals in response");
  return goals;
}

// Creates the draft goals for a mentee who has none yet. Never throws.
export async function draftInitialGoals(menteeId: string): Promise<void> {
  try {
    const mentee = await prisma.mentorshipMentee.findUnique({
      where: { id: menteeId },
    });
    if (!mentee) return;

    const existing = await prisma.mentorshipGoal.count({
      where: { menteeId },
    });
    if (existing > 0) return;

    let goals: DraftGoal[];
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        goals = await generateWithClaude(mentee);
      } catch {
        goals = fallbackGoals(mentee);
      }
    } else {
      goals = fallbackGoals(mentee);
    }

    await prisma.mentorshipGoal.createMany({
      data: goals.map((g) => ({ menteeId, ...g })),
    });
  } catch {
    // Goal drafting is a bonus; signup must never fail because of it.
  }
}
