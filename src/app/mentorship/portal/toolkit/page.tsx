import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import { Card, CardTitle, Pill } from "@/components/mentorship/ui";
import { RequestToolForm } from "@/components/mentorship/plan-forms";
import { CopyButton } from "@/components/mentorship/CopyButton";

export const metadata = { title: "AI Toolkit" };

// The three tools the mentor can provision. Quickstarts are deliberately
// copy-paste-runnable so the first API call takes minutes, not evenings.
const TOOLS: {
  tool: string;
  name: string;
  tagline: string;
  bestFor: string;
  quickstart: string;
}[] = [
  {
    tool: "anthropic",
    name: "Claude API (Anthropic)",
    tagline: "Text intelligence: analysis, summaries, structured JSON output.",
    bestFor:
      "Your project's brain. Incident analysis, data summaries, essay critique, mock interviews. Start here; both capstones use it.",
    quickstart: `# pip install anthropic
import anthropic

client = anthropic.Anthropic(api_key="YOUR_KEY")
msg = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=500,
    messages=[{"role": "user", "content": "Explain HAZOP guidewords simply."}],
)
print(msg.content[0].text)`,
  },
  {
    tool: "openai",
    name: "OpenAI API",
    tagline: "A second model family: compare outputs, embeddings, Whisper audio.",
    bestFor:
      "Model comparison weeks and anything needing embeddings or audio transcription. Good engineers evaluate more than one model.",
    quickstart: `# pip install openai
from openai import OpenAI

client = OpenAI(api_key="YOUR_KEY")
resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Explain HAZOP guidewords simply."}],
)
print(resp.choices[0].message.content)`,
  },
  {
    tool: "fal",
    name: "fal.ai",
    tagline: "Image and media generation with fast hosted models.",
    bestFor:
      "Project banners, diagrams, and creative assets: repo covers, LinkedIn visuals, showcase slides.",
    quickstart: `# pip install fal-client   (set FAL_KEY env var)
import fal_client

result = fal_client.subscribe(
    "fal-ai/flux/schnell",
    arguments={"prompt": "clean minimal banner, engineering data dashboard"},
)
print(result["images"][0]["url"])`,
  },
];

export default async function ToolkitPage() {
  const mentee = await verifyMentee();
  const rows = await prisma.mentorshipAiTool.findMany({
    where: { menteeId: mentee.id },
  });
  const byTool = new Map(rows.map((r) => [r.tool, r]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          AI Toolkit
        </h1>
        <p className="mt-1 text-zinc-400">
          Real API keys, provisioned by your mentor, for building real things.
          Request a tool when your programme calls for it and say what you plan
          to build. Keep keys out of GitHub: use environment variables or app
          secrets, never commit them.
        </p>
      </div>

      {TOOLS.map((t) => {
        const row = byTool.get(t.tool);
        const status = row?.status ?? "available";
        return (
          <Card key={t.tool}>
            <CardTitle
              kicker={t.tagline}
              title={t.name}
              action={
                status === "granted" ? (
                  <Pill tone="green">Granted</Pill>
                ) : status === "requested" ? (
                  <Pill tone="amber">Requested</Pill>
                ) : (
                  <Pill tone="neutral">Available</Pill>
                )
              }
            />
            <p className="text-sm leading-relaxed text-zinc-400">{t.bestFor}</p>

            {status === "granted" && row?.apiKey ? (
              <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                    Your API key
                  </p>
                  <CopyButton
                    text={row.apiKey}
                    label="Copy key"
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
                  />
                </div>
                <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-lg bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-300">
                  {row.apiKey}
                </code>
                {row.note ? (
                  <p className="mt-2 text-xs text-zinc-500">{row.note}</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4">
                <RequestToolForm tool={t.tool} requested={status === "requested"} />
              </div>
            )}

            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-accent">
                Quickstart
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-zinc-950/60 p-4 font-mono text-xs leading-relaxed text-zinc-300">
                {t.quickstart}
              </pre>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
