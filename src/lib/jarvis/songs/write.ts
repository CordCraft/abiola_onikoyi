import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Turns a liked song into a "make my own version" pack:
// - an analysis (genre, tempo, mood, instruments, vocals, structure, themes),
// - a Suno-ready pack: Style of Music, Title, Exclude styles and ORIGINAL lyrics
//   with Suno's [Verse] / [Chorus] tags, to paste into Suno,
// - an ACE-Step prompt for the open-source plan B (fal.ai).
//
// The liked song is inspiration only. The lyrics are always new: never the
// original's lines, hook or title. Suno also refuses artist names in the
// style box, so the style describes the sound instead of naming anyone.

// Fast enough to finish inside one Netlify invocation (see AGENTS.md gotcha 1).
const MODEL = "claude-sonnet-5-5";

export type SongAnalysis = {
  genre: string;
  subgenres: string[];
  era: string | null;
  bpm: number | null;
  key: string | null;
  mood: string[];
  energy: string;
  instruments: string[];
  vocals: string;
  structure: string;
  production: string;
  themes: string;
  whyItWorks: string;
  confidence: "knows the song" | "partly" | "guessing from the title";
};

export type SunoPack = {
  title: string;
  style: string; // Suno "Style of Music", max 1000 characters
  exclude: string; // Suno "Exclude styles"
  lyrics: string; // original lyrics with [Section] tags
  tips: string; // slider and version suggestions
};

export type AcePack = {
  prompt: string; // max 512 characters
  bpm: number | null;
  keyScale: string | null;
  vocalLanguage: string;
  duration: number; // seconds
};

export type SongPack = { analysis: SongAnalysis; suno: SunoPack; ace: AcePack };

const SYSTEM = `You are Jarvis's songwriting partner for Abiola, who releases music as Novale and makes songs in Suno.

He liked a song and wants his OWN song inspired by it: same feel, sound and energy, new everything else.

Return ONLY a JSON object, no prose, no code fence:
{
  "analysis": {
    "genre": string, "subgenres": string[], "era": string|null,
    "bpm": number|null, "key": string|null,
    "mood": string[], "energy": string,
    "instruments": string[], "vocals": string,
    "structure": string, "production": string,
    "themes": string, "whyItWorks": string,
    "confidence": "knows the song" | "partly" | "guessing from the title"
  },
  "suno": {
    "title": string,
    "style": string,
    "exclude": string,
    "lyrics": string,
    "tips": string
  },
  "ace": { "prompt": string, "bpm": number|null, "keyScale": string|null, "vocalLanguage": string, "duration": number }
}

Rules:
- Be honest in "confidence". If you do not know the recording, infer from the artist and title and say so.
- suno.style: comma-separated descriptors Suno understands (genre, subgenre, tempo like "98 bpm", mood, key instruments, vocal type and delivery, production texture, mix character). Max 900 characters. NEVER name an artist, band, producer or song: Suno blocks them. Describe the sound instead.
- suno.exclude: a few comma-separated styles to keep out.
- suno.lyrics: completely ORIGINAL lyrics. Never reuse or paraphrase a line, hook, title or distinctive phrase from the original song. Same emotional territory and rhythm of phrasing is fine. Use Suno section tags on their own lines: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro], plus short bracketed performance cues where useful, e.g. [Soft female vocal], [Beat drops], [Ad-libs]. Keep it singable, 2:30 to 3:30 long, under 3000 characters.
- suno.title: an original title, not the original's.
- suno.tips: one or two short sentences: which Suno model to pick, and suggested Weirdness and Style Influence slider values.
- ace.prompt: one dense sentence describing the sound for ACE-Step, max 480 characters, no names. ace.duration between 120 and 210. ace.vocalLanguage is a code like "en", "yo", "pcm", or "unknown".
- Follow Abiola's style notes and any direction for this rewrite when given.
- Plain text only inside strings: no markdown, no em dashes.`;

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic();
}

function parse(text: string): SongPack {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const data = JSON.parse(cleaned.slice(start, end + 1)) as SongPack;
  if (!data?.suno?.style || !data?.suno?.lyrics) throw new Error("The song pack came back incomplete.");
  const noDash = (s: string) => s.replace(/—/g, ", ");
  data.suno.style = noDash(data.suno.style).slice(0, 1000);
  data.suno.lyrics = noDash(data.suno.lyrics).slice(0, 5000);
  data.suno.title = noDash(data.suno.title).slice(0, 80);
  data.ace.prompt = noDash(data.ace?.prompt ?? data.suno.style).slice(0, 512);
  data.ace.duration = Math.min(Math.max(Number(data.ace.duration) || 180, 60), 300);
  return data;
}

export async function writeSongPack(input: {
  title: string;
  artist: string | null;
  album: string | null;
  styleNotes?: string | null;
  direction?: string | null;
  previousTitle?: string | null;
}): Promise<SongPack> {
  const lines = [
    `Liked song: "${input.title}"${input.artist ? ` by ${input.artist}` : ""}${input.album ? ` (album: ${input.album})` : ""}.`,
    input.styleNotes ? `Abiola's standing style notes for Novale: ${input.styleNotes}` : "",
    input.direction ? `Direction for this version: ${input.direction}` : "",
    input.previousTitle ? `This is a rewrite. Do not reuse the previous title "${input.previousTitle}" or its lyrics; take a fresh angle.` : "",
  ].filter(Boolean);
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: lines.join("\n") }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return parse(text);
}
