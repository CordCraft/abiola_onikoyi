import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Reads which song a screenshot shows: YouTube Music, Spotify, Apple Music,
// Shazam, a TikTok or Reel with a sound label, a lock screen player, a
// concert poster. Returns what is visibly written, not a guess from the art.

const MODEL = "claude-sonnet-5-5";

export type SeenSong = {
  found: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  app: string | null; // where the screenshot was taken, e.g. "YouTube Music"
  note: string | null; // why nothing was found, in a short sentence
};

const SYSTEM = `You read phone screenshots to find the song on screen.

Look for a now-playing title and artist (music players, lock screen, Control Center, Shazam, a TikTok / Reels / Shorts sound label, a song card in a chat). Ignore playlist names, ads and up-next rows when a now-playing song is visible.

Return ONLY JSON, no prose, no code fence:
{"found": boolean, "title": string|null, "artist": string|null, "album": string|null, "app": string|null, "note": string|null}

Copy title and artist exactly as written (fix only obvious truncation like "Song Na..." when the rest is visible elsewhere). Drop "Official Video", "Lyrics", "Audio" and similar tags from the title. If several artists, join them with ", ". If no song is readable, found=false and note says what the screenshot shows in under 15 words.`;

export async function readSongFromImage(base64: string, mediaType: string): Promise<SeenSong> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const type = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType) ? mediaType : "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif";
  const res = await new Anthropic().messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: type, data: base64 } },
          { type: "text", text: "Which song is this?" },
        ],
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  try {
    const j = JSON.parse(text.slice(s, e + 1)) as Partial<SeenSong>;
    const title = j.title?.trim() || null;
    return {
      found: Boolean(j.found && title),
      title,
      artist: j.artist?.trim() || null,
      album: j.album?.trim() || null,
      app: j.app?.trim() || null,
      note: j.note?.trim() || null,
    };
  } catch {
    return { found: false, title: null, artist: null, album: null, app: null, note: "Could not read the screenshot." };
  }
}
