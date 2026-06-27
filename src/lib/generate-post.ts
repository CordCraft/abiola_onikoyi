import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";
import { uniquePostSlug } from "@/lib/blog";
import {
  POST_CATEGORIES,
  type PostCategory,
  type PostKind,
} from "@/lib/blog-constants";
import { profile } from "@/content/profile";

// Reputable energy / oil-and-gas news feeds for the "news" posts.
const FEEDS = [
  { name: "Rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx" },
  { name: "OilPrice", url: "https://oilprice.com/rss/main" },
  { name: "Offshore Technology", url: "https://www.offshore-technology.com/feed/" },
];

const MODEL = "claude-opus-4-8";

type GeneratedFields = { title: string; excerpt: string; body: string };

function pickWeeklyPlan(): { kind: PostKind; category: PostCategory } {
  // Alternate news/insight week over week; rotate the theme.
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const kind: PostKind = week % 2 === 0 ? "news" : "insight";
  const category = POST_CATEGORIES[week % POST_CATEGORIES.length];
  return { kind, category };
}

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment to generate posts.",
    );
  }
  return new Anthropic();
}

// Ask Claude for a post and parse the JSON it returns (no SDK-version-specific
// structured-output params, so this is robust across SDK releases).
async function generateFields(
  system: string,
  prompt: string,
): Promise<GeneratedFields> {
  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: prompt }],
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
  const data = JSON.parse(json) as Partial<GeneratedFields>;

  if (!data.title || !data.body) {
    throw new Error("Generated post was missing a title or body.");
  }
  return {
    title: String(data.title).trim(),
    excerpt: String(data.excerpt ?? "").trim(),
    body: String(data.body).trim(),
  };
}

const VOICE = `You are writing in the first person as ${profile.name}, a petroleum engineer at Saudi Aramco (ex-Shell) and inventor on five US patents. Voice: knowledgeable, measured, practical, forward-looking on sustainable energy. Avoid hype and buzzwords. Do not use em dashes. Return ONLY a JSON object with keys "title" (string), "excerpt" (one-sentence summary, string) and "body" (markdown string, ~500-650 words with a few short paragraphs and at most one short list). No code fences, no commentary outside the JSON.`;

async function findFreshNewsItem(): Promise<
  { title: string; link: string; snippet: string; source: string } | null
> {
  const parser = new Parser({ timeout: 10000 });
  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items ?? []) {
        const link = item.link?.trim();
        const title = item.title?.trim();
        if (!link || !title) continue;
        const exists = await prisma.post.findFirst({
          where: { sourceUrl: link },
        });
        if (exists) continue;
        const snippet = (item.contentSnippet ?? item.content ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 600);
        return { title, link, snippet, source: feed.name };
      }
    } catch {
      // Try the next feed.
    }
  }
  return null;
}

// Generates ONE post (as a draft) and stores it. Returns the created post.
export async function generateWeeklyPost() {
  const plan = pickWeeklyPlan();

  const category: PostCategory = plan.category;
  let kind: PostKind = plan.kind;
  let sourceUrl: string | null = null;
  let sourceName: string | null = null;
  let fields: GeneratedFields;

  if (kind === "news") {
    const item = await findFreshNewsItem();
    if (item) {
      sourceUrl = item.link;
      sourceName = item.source;
      fields = await generateFields(
        VOICE,
        `Here is a current oil & gas / energy news item:\n\nHeadline: ${item.title}\nSource: ${item.source}\nSummary: ${item.snippet}\nLink: ${item.link}\n\nWrite a short blog post that summarises this development for a professional audience and adds my own perspective on what it means for ${category.toLowerCase()} and the wider energy transition. Open the body by briefly stating the news, then give my take. Do not fabricate facts beyond the summary; keep claims general where the summary is thin. End the body with a markdown link to the source titled "Read the original".`,
      );
    } else {
      // No fresh news available, so fall back to an insight post this week.
      kind = "insight";
      fields = await generateFields(
        VOICE,
        `Write a thoughtful insight post on a current topic in ${category} within petroleum engineering and the energy transition. Share a practical perspective grounded in real industry experience.`,
      );
    }
  } else {
    fields = await generateFields(
      VOICE,
      `Write a thoughtful insight post on a topic in ${category} within petroleum engineering and the energy transition. Share a practical, experience-grounded perspective with a clear point of view.`,
    );
  }

  const slug = await uniquePostSlug(fields.title);

  return prisma.post.create({
    data: {
      slug,
      title: fields.title,
      excerpt: fields.excerpt,
      body: fields.body,
      category,
      kind,
      sourceUrl,
      sourceName,
      published: false, // drafts await review
    },
  });
}
