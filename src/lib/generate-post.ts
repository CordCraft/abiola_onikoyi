import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";
import { uniquePostSlug } from "@/lib/blog";
import { fetchStockImage } from "@/lib/openverse";
import {
  POST_CATEGORIES,
  type PostCategory,
  type PostKind,
} from "@/lib/blog-constants";
import { profile } from "@/content/profile";

// Maps each patent to the post category it's most relevant to, so a post can
// be anchored in a specific, real piece of the author's work instead of a
// generic appeal to "17 years of experience." Keyed by patent number so
// profile.ts stays the single source of truth for the patent list itself.
const PATENT_CATEGORY: Record<string, PostCategory> = {
  US12163416B2: "Reservoir & Production", // flow rate validation in a well system
  US12000276B2: "Reservoir & Production", // automated real-time water injection well testing
  US20250237340A1: "Operations", // temporary sealing of flange leaks on pipelines
  US20250231056A1: "Innovation", // drone-conveyed ultrasonic flowmeter
  US20240183255A1: "Innovation", // ML temperature profile prediction
};

type GroundingFact = { text: string; url?: string };

// Every skill and patent tagged to a category, so the weekly rotation can
// pick a different concrete anchor each time instead of the same generic
// category theme.
function groundingFacts(category: PostCategory): GroundingFact[] {
  const skills = profile.skills.find((s) => s.category === category)?.items ?? [];
  const patents = profile.patents.filter(
    (p) => PATENT_CATEGORY[p.number] === category,
  );
  return [
    ...skills.map((text) => ({ text })),
    ...patents.map((p) => ({ text: p.title, url: p.url })),
  ];
}

// Reputable energy / oil-and-gas news feeds for the "news" posts.
const FEEDS = [
  { name: "Rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx" },
  { name: "OilPrice", url: "https://oilprice.com/rss/main" },
  { name: "Offshore Technology", url: "https://www.offshore-technology.com/feed/" },
];

const MODEL = "claude-opus-4-8";

type GeneratedFields = {
  title: string;
  excerpt: string;
  body: string;
  metaDescription: string;
  keywords: string;
  imageQuery: string;
  imageAlt: string;
};

function pickWeeklyPlan(): {
  kind: PostKind;
  category: PostCategory;
  fact: GroundingFact;
} {
  // Alternate news/insight week over week; rotate the theme.
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const kind: PostKind = week % 2 === 0 ? "news" : "insight";
  const category = POST_CATEGORIES[week % POST_CATEGORIES.length];
  const facts = groundingFacts(category);
  const fact = facts[week % facts.length];
  return { kind, category, fact };
}

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment to generate posts.",
    );
  }
  return new Anthropic();
}

// Claude sometimes returns a literal newline/tab inside a JSON string value
// (e.g. within the markdown "body") instead of escaping it, which is invalid
// JSON. Walk the text tracking string/escape state and escape raw control
// characters found only inside string literals, leaving structural
// whitespace between tokens untouched.
function escapeRawControlCharsInStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === "\n") {
        out += "\\n";
      } else if (ch === "\r") {
        out += "\\r";
      } else if (ch === "\t") {
        out += "\\t";
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
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
  const data = JSON.parse(escapeRawControlCharsInStrings(json)) as Partial<GeneratedFields>;

  if (!data.title || !data.body) {
    throw new Error("Generated post was missing a title or body.");
  }
  return {
    title: String(data.title).trim(),
    excerpt: String(data.excerpt ?? "").trim(),
    body: String(data.body).trim(),
    metaDescription: String(data.metaDescription ?? data.excerpt ?? "")
      .trim()
      .slice(0, 160),
    keywords: String(data.keywords ?? "").trim(),
    imageQuery: String(data.imageQuery ?? "").trim(),
    imageAlt: String(data.imageAlt ?? "").trim(),
  };
}

const VOICE = `You are writing in the first person as ${profile.name}, a petroleum engineer at Saudi Aramco (ex-Shell) and inventor on five US patents. Voice: knowledgeable, measured, practical, forward-looking on sustainable energy. Avoid hype and buzzwords, and avoid generic industry-report throat-clearing ("in today's rapidly evolving landscape", "it is crucial to note", "as we look to the future"). Do not use em dashes.

Ground the post in one real, specific, concrete detail from my work, not a vague appeal to "17 years of experience." Explain a mechanism, a number, a failure mode, a decision, or a technique the way you would to a colleague who already knows the basics. A reader who works in the field should learn something they didn't already know, or see a familiar problem from a sharper angle.

Optimise for SEO and readability, but never at the cost of specificity. The title should be a real, specific claim or question (about 60 characters), not a vague theme. Return ONLY a JSON object (no code fences, no text outside it) with these keys:
- "title": string
- "excerpt": one-sentence summary (string)
- "body": markdown, ~500-650 words. Open with the concrete detail, not scene-setting. A few short paragraphs and at most one short list, with one or two "## " subheadings that include relevant keywords. End with a line starting "**Takeaway:**" stating one specific, actionable point a reader in the field could apply, not a platitude.
- "metaDescription": a search-result meta description, max 155 characters
- "keywords": 5-7 comma-separated SEO keywords/phrases
- "imageQuery": a 2-4 word search phrase for a relevant stock photo (concrete and visual, e.g. "oil refinery pipeline")
- "imageAlt": a short descriptive alt text for that image`;

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

function factClause(fact: GroundingFact): string {
  return `"${fact.text}"${fact.url ? ` (patent: ${fact.url})` : ""}`;
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
        `Here is a current oil & gas / energy news item:\n\nHeadline: ${item.title}\nSource: ${item.source}\nSummary: ${item.snippet}\nLink: ${item.link}\n\nWrite a short blog post that summarises this development for a professional audience and adds my own perspective on what it means for ${category.toLowerCase()} and the wider energy transition. Open the body by briefly stating the news, then give my take. Where it genuinely connects, ground that take in this specific piece of my own work: ${factClause(plan.fact)} — but only draw the connection if it's real, don't force it. Do not fabricate facts beyond the summary; keep claims general where the summary is thin. End the body with a markdown link to the source titled "Read the original".`,
      );
    } else {
      // No fresh news available, so fall back to an insight post this week.
      kind = "insight";
      fields = await generateFields(
        VOICE,
        `Write a post in ${category} within petroleum engineering and the energy transition, anchored specifically in this real detail from my own work: ${factClause(plan.fact)}. Use it to drive the whole piece: explain the real problem it solves or the skill it represents, then connect that to a broader point about where the field is heading. Don't just namedrop it in one sentence and go generic from there.`,
      );
    }
  } else {
    fields = await generateFields(
      VOICE,
      `Write a post in ${category} within petroleum engineering and the energy transition, anchored specifically in this real detail from my own work: ${factClause(plan.fact)}. Use it to drive the whole piece: explain the real problem it solves or the skill it represents, then connect that to a broader point about where the field is heading. Don't just namedrop it in one sentence and go generic from there.`,
    );
  }

  const slug = await uniquePostSlug(fields.title);

  // Find a relevant openly-licensed photo (best-effort; null is fine).
  const image = fields.imageQuery
    ? await fetchStockImage(fields.imageQuery)
    : null;

  return prisma.post.create({
    data: {
      slug,
      title: fields.title,
      excerpt: fields.excerpt,
      body: fields.body,
      category,
      kind,
      metaDescription: fields.metaDescription || fields.excerpt || null,
      keywords: fields.keywords || null,
      imageUrl: image?.url ?? null,
      imageAlt: fields.imageAlt || fields.title,
      imageCredit: image?.credit ?? null,
      imageCreditUrl: image?.creditUrl ?? null,
      sourceUrl,
      sourceName,
      published: false, // drafts await review
    },
  });
}
