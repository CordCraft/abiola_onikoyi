"use server";

import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "@/lib/dal";
import { profile } from "@/content/profile";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Revision = {
  title: string;
  excerpt: string;
  body: string;
  metaDescription: string;
};

export type ChatResponse = {
  reply: string;
  revised?: Revision | null;
  error?: string;
};

// Conversational editor: given the current draft and the conversation so far,
// Claude answers and (when asked) returns a full revised article to apply.
export async function chatAboutPost(input: {
  draft: { title: string; excerpt: string; body: string; metaDescription: string };
  history: ChatMessage[];
  message: string;
}): Promise<ChatResponse> {
  await verifySession();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { reply: "", error: "ANTHROPIC_API_KEY is not set on the server." };
  }

  const client = new Anthropic();
  const system = `You are an expert editor helping ${profile.name} refine a blog post before publishing. Keep the author's first-person voice (a petroleum engineer at Saudi Aramco). Do not use em dashes.

CURRENT DRAFT
Title: ${input.draft.title}
Excerpt: ${input.draft.excerpt}
Meta description: ${input.draft.metaDescription}
Body (markdown):
${input.draft.body}

Respond with ONLY a JSON object (no code fences, no text outside it):
{ "reply": string, "revised": null | { "title": string, "excerpt": string, "body": string, "metaDescription": string } }
- "reply": a short, friendly message describing what you changed or answering the question.
- "revised": when the user asks to change or improve the article, return the FULL updated article (title, excerpt, body markdown, and a meta description under 155 characters). When the user is only asking a question, set it to null.`;

  const messages = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.message },
  ];

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3500,
      system,
      messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const json = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
    const data = JSON.parse(json) as {
      reply?: string;
      revised?: Partial<Revision> | null;
    };

    const revised: Revision | null = data.revised
      ? {
          title: String(data.revised.title ?? input.draft.title),
          excerpt: String(data.revised.excerpt ?? input.draft.excerpt),
          body: String(data.revised.body ?? input.draft.body),
          metaDescription: String(
            data.revised.metaDescription ?? input.draft.metaDescription,
          ).slice(0, 160),
        }
      : null;

    return { reply: String(data.reply ?? "Done."), revised };
  } catch (err) {
    return {
      reply: "",
      error: err instanceof Error ? err.message : "Chat request failed.",
    };
  }
}
