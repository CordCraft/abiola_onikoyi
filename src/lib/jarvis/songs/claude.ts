import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// One place for the Songs calls to Claude: Opus 5.5 with server-side refusal
// fallbacks, pause_turn handling for web search, and tolerant JSON parsing.

export const SONG_MODEL = "claude-opus-5-5";

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  cached ??= new Anthropic();
  return cached;
}

export type AskResult = { text: string; sources: { title: string; url: string }[] };

export async function ask(opts: {
  system: string;
  user: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  webSearches?: number; // > 0 turns on web search
}): Promise<AskResult> {
  const tools: Anthropic.Beta.BetaToolUnion[] = opts.webSearches
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: opts.webSearches }]
    : [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
  const sources = new Map<string, string>();
  let text = "";
  // Web search can pause a long turn; continue it a few times at most.
  for (let hop = 0; hop < 4; hop++) {
    const res = await client().beta.messages.create({
      model: SONG_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort },
      ...(tools.length ? { tools } : {}),
      messages,
    });
    for (const b of res.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
      }
    }
    text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (res.stop_reason === "refusal") throw new Error("Claude declined this song. Try Rewrite with a direction.");
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    break;
  }
  return { text, sources: [...sources].map(([url, title]) => ({ url, title })) };
}

// The last {...} object in a reply, without code fences.
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The reply had no JSON in it.");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export const noDash = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");
