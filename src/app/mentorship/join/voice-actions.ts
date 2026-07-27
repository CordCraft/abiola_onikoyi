"use server";

import Anthropic from "@anthropic-ai/sdk";

// Cleans up dictated text from the signup wizard's voice input: grammar,
// punctuation, filler words. Public (signup is unauthenticated), so inputs
// are capped and throttled per instance. Always returns usable text; on any
// failure the original comes back unchanged.

const MODEL = "claude-opus-4-8";
const MAX_CHARS = 4000;

// Per-instance throttle: generous for real mentees, a wall for abuse.
let windowStart = Date.now();
let count = 0;
function limited(): boolean {
  const now = Date.now();
  if (now - windowStart > 10 * 60 * 1000) {
    windowStart = now;
    count = 0;
  }
  count += 1;
  return count > 60;
}

export async function polishText(raw: string): Promise<{ text: string }> {
  const text = String(raw ?? "").slice(0, MAX_CHARS).trim();
  if (!text || text.length < 15 || !process.env.ANTHROPIC_API_KEY || limited()) {
    return { text: String(raw ?? "") };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 1400,
        system:
          "You clean up text dictated by a Nigerian engineering student. Fix grammar, punctuation, capitalization, and sentence boundaries. Remove filler words, false starts, and repeated words. Keep the speaker's meaning, first-person voice, and natural tone; keep every fact and detail. Do not add new content, do not summarize, do not shorten meaningfully. Do not use em dashes. Respond with ONLY the cleaned text, nothing else.",
        messages: [{ role: "user", content: text }],
      },
      { timeout: 18_000 },
    );
    const cleaned = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { text: cleaned || String(raw ?? "") };
  } catch {
    return { text: String(raw ?? "") };
  }
}
