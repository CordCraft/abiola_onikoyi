import "server-only";
import { ask, noDash, parseJson } from "@/lib/jarvis/songs/claude";
import type { SongResearch } from "@/lib/jarvis/songs/research";

// Steps 2 and 3 of a song.
//
// analyzeSong(): turns the web research plus the original lyrics into a
// blueprint a producer could rebuild the track from: groove, harmony, vocal
// production, and a section-by-section map (line counts, syllables per line,
// rhyme scheme, hook mechanics, language mix). The original lyrics are read
// here only to measure their shape; they are never quoted or stored.
//
// writeSongPack(): writes Abiola's own song to that blueprint for Suno: the
// style prompt describes the sound precisely (no names: Suno blocks them),
// and the lyrics mirror the structure and flow with completely new words.
// The writer never sees the original lyrics, so it cannot echo them.

export type SongSection = {
  name: string; // "Intro", "Verse 1", "Pre-Chorus", "Chorus", "Post-Chorus", ...
  lines: number;
  syllables: string; // per line, e.g. "7-9"
  rhyme: string; // e.g. "AABB", "AAAA (same end vowel 'oh')", "free"
  delivery: string; // sung, rapped, chanted, call and response, spoken...
  energy: number; // 1-10
  notes: string; // what happens: drop, ad-libs, beat filter, harmony stack...
};

export type SongAnalysis = {
  // Kept from the first version (the app reads these)
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
  confidence: "listened" | "researched" | "knows the song" | "partly" | "guessing from the title";
  // The blueprint
  timeSignature?: string | null;
  groove?: string; // drum pattern, swing, percussion layers
  bass?: string;
  harmony?: string; // progression shape, mode, chord colour
  melody?: string; // contour, range, hook melody, melisma
  vocalProduction?: string; // autotune, doubles, stacks, reverb, ad-lib placement
  language?: string; // e.g. "English 60%, Nigerian Pidgin 30%, Yoruba 10%"
  sections?: SongSection[];
  hook?: string; // what the hook is built from and how often it repeats
  lyricCraft?: string; // point of view, imagery, rhyme style, slang, wordplay
  mix?: string; // space, low end, brightness, loudness, lo-fi or polished
  sunoTags?: string[]; // the 8-14 most defining descriptors, most important first
  lengthSec?: number | null;
};

export type SunoPack = {
  title: string;
  style: string; // Suno "Style of Music", max 1000 characters
  exclude: string; // Suno "Exclude styles"
  lyrics: string; // original lyrics with [Section] tags
  tips: string; // model and slider suggestions
};

export type AcePack = {
  prompt: string; // max 512 characters
  bpm: number | null;
  keyScale: string | null;
  vocalLanguage: string;
  duration: number; // seconds
};

export type SongPack = { suno: SunoPack; ace: AcePack };

// ── Step 2: the blueprint ────────────────────────────────────────────────────

const ANALYZE = `You are a record producer and topline writer. Break down a song so precisely that another producer could build a new track with the same sound, groove, flow and feel, without copying a single lyric.

You get: measurements from listening to the full recording when available (tempo, key, section boundaries with bar counts, energy per section, energy curve, brightness, low-end weight, percussive share, words per second and vocal coverage per section, vocal language), web research about the recording, the track length, and the original lyrics when available.

How to weigh them: the measurements are what the song actually does, so they win on tempo (check the half/double-time alternative against the genre), section timing, energy shape and vocal density. Use the web for producer credits, instrument names and anything the numbers cannot tell, and to settle the key when the measured key confidence is low. Map the measured sections (A/B/C labels, bars, words per second) onto named sections using the lyrics. Translate numbers into producer language: high percussive share and onset density means busy drums; high low-end share means heavy bass or 808; low brightness means warm and dark; low words per second with high repetition means a chant hook. Use the lyrics ONLY to measure shape: section order, line counts, syllables per line, rhyme scheme, where the hook lands and how often it repeats, call and response, chant syllables, language mix and slang register. Never quote or paraphrase a lyric line in your output (a single chant syllable such as "na-na" or "oh" may be named as a technique).

Reply with ONLY this JSON:
{
 "genre": string, "subgenres": string[], "era": string|null, "bpm": number|null, "key": string|null, "timeSignature": string|null,
 "mood": string[], "energy": string,
 "instruments": string[], "groove": string, "bass": string, "harmony": string, "melody": string,
 "vocals": string, "vocalProduction": string, "language": string,
 "sections": [{"name": string, "lines": number, "syllables": string, "rhyme": string, "delivery": string, "energy": number, "notes": string}],
 "hook": string, "lyricCraft": string, "themes": string,
 "structure": string, "production": string, "mix": string,
 "sunoTags": string[], "whyItWorks": string,
 "confidence": "researched" | "knows the song" | "partly" | "guessing from the title"
}

Rules:
- Be specific and technical everywhere. Bad: "upbeat Afrobeats with nice drums". Good: "mid-tempo Afrobeats at 103 bpm, log drum on beats 2 and 4, open shaker sixteenths, sparse rimshot, syncopated conga fills into every chorus, minor-key Rhodes chords on a i-VI-VII loop".
- sections: every section in order, as performed, including intro, instrumental breaks, post-choruses and repeats. "lines" counts lyric lines (0 for instrumental). "syllables" is the typical range per line.
- "structure": the section order in one line, e.g. "Intro (chant) - Chorus - Verse 1 - Pre-Chorus - Chorus - Verse 2 - Chorus - Outro".
- "language": the real mix with rough shares, plus register (street slang, romantic, preachy).
- "sunoTags": 8 to 14 short descriptors Suno understands, most defining first: primary genre, subgenre, tempo like "103 bpm", key or mode, vocal type and delivery, 2 to 4 signature instruments, groove, mood, production texture. No artist, producer or song names.
- "confidence": "listened" when you had audio measurements; "researched" when the research found the recording and you had the lyrics; "knows the song" if you know it well; lower otherwise.
- In "sections", put each section's bar count and measured energy in "notes" when known (e.g. "8 bars, energy 9/10, drums drop out for the first 2 bars").
- Plain text inside strings, no markdown, no em dashes.`;

export async function analyzeSong(input: {
  title: string;
  artist: string | null;
  research: SongResearch | null;
  lyrics: string | null;
}): Promise<SongAnalysis> {
  const r = input.research;
  const parts = [
    `Song: "${input.title}"${input.artist ? ` by ${input.artist}` : ""}.`,
    r?.facts.durationSec ? `Track length: ${r.facts.durationSec} seconds.` : "",
    r?.audio?.ok
      ? `Measured by listening to the full recording (JSON):\n${JSON.stringify(r.audio)}`
      : `No audio measurements${r?.audio?.error ? ` (${r.audio.error})` : ""}.`,
    r ? `Web research (JSON):\n${JSON.stringify({ ...r, sources: undefined, facts: undefined, audio: undefined, listeningOn: undefined })}` : "No web research available.",
    input.lyrics
      ? `Original lyrics, for measuring shape only (never quote them):\n<lyrics>\n${input.lyrics}\n</lyrics>`
      : "No lyrics available: infer the structure from the genre and what you know, and lower the confidence.",
  ].filter(Boolean);
  const { text } = await ask({ system: ANALYZE, user: parts.join("\n\n"), effort: "medium", maxTokens: 12000 });
  const a = parseJson<SongAnalysis>(text);
  if (!a.genre) throw new Error("The analysis came back incomplete.");
  a.subgenres ??= [];
  a.mood ??= [];
  a.instruments ??= [];
  a.sections = (a.sections ?? []).slice(0, 24);
  a.sunoTags = (a.sunoTags ?? []).slice(0, 16);
  a.bpm = a.bpm ?? (r?.audio?.tempo ? Math.round(r.audio.tempo) : null) ?? r?.bpm ?? null;
  a.key = a.key ?? r?.key ?? null;
  a.lengthSec = r?.facts.durationSec ?? null;
  return a;
}

// ── Step 3: Abiola's own version for Suno ────────────────────────────────────

const WRITE = `You are Jarvis's songwriting partner for Abiola, who releases music as Novale and makes songs in Suno (v5 / v5.5, Custom mode).

He liked a song. You get a producer's blueprint of it. Write HIS OWN song that a listener would put on the same playlist: same genre, tempo, groove, vocal style, flow, structure, energy curve and emotional territory, with completely new words, title and story.

Reply with ONLY this JSON:
{"suno": {"title": string, "style": string, "exclude": string, "lyrics": string, "tips": string},
 "ace": {"prompt": string, "bpm": number|null, "keyScale": string|null, "vocalLanguage": string, "duration": number}}

STYLE (suno.style), 450 to 950 characters, comma-separated phrases:
- Start with the core in this order: primary genre, subgenre, exact tempo ("103 bpm"), key or mode, lead vocal (gender, tone, delivery, e.g. "smooth male tenor, laid-back melodic delivery, light autotune").
- Then the signature instruments and HOW they play (pattern words: "log drum on the offbeat", "plucked highlife guitar riff", "sidechained synth pad"), the groove and percussion layers, the bass.
- Then harmony colour, mood words, vocal production (doubles, harmonies, ad-libs, call and response), mix character.
- Use the blueprint's sunoTags. Never name an artist, band, producer, song or album: Suno rejects them. Describe the sound instead.

EXCLUDE (suno.exclude): 4 to 8 comma-separated styles Suno tends to drift toward that would ruin this sound (e.g. for Afrobeats: "trap hi-hat rolls, EDM drop, rock guitar, reggaeton dembow, orchestral").

LYRICS (suno.lyrics):
- Follow the blueprint's sections in the same order. Each section gets a tag on its own line with short performance cues, e.g. "[Chorus: group vocals, call and response]", "[Verse 1: half-rapped, laid back]", "[Intro: chant, sparse percussion]", "[Instrumental Break]", "[Outro: fade out]". Add "[End]" as the last line.
- Match each section's line count, syllables per line and rhyme scheme from the blueprint, so the flow sits on the same rhythm. Match the hook mechanics: where it lands, how many times it repeats, chant syllables or vowel runs, ad-lib placement (ad-libs in parentheses).
- Match the language mix and register from the blueprint (for example English with Nigerian Pidgin and Yoruba in the same proportion). Write natural, idiomatic lines a native speaker would sing.
- The hook must be short, singable and memorable, built the way the blueprint says the original's is built, but with its own words and its own title phrase.
- Concrete images, a clear situation, a point of view. No cliches like "fire in my soul", "dancing in the moonlight", "we rise".
- Everything is ORIGINAL. You have not seen the original lyrics; do not try to recreate them or its title.
- Fit the original's length (blueprint lengthSec) within about 20 seconds; under 3000 characters.

TITLE: original, ideally the hook phrase.
TIPS (suno.tips): one or two short sentences: which Suno model, and Weirdness / Style Influence values (Style Influence 70 to 85 keeps it close to the style prompt; Weirdness 25 to 45 for a faithful vibe).
ACE: ace.prompt is one dense sentence describing the same sound for ACE-Step (max 480 characters, no names); duration 120 to 240; vocalLanguage like "en", "yo", "pcm" or "unknown".

Follow Abiola's standing style notes and any direction for this version; a direction overrides the blueprint where they conflict.
Plain text inside strings, no markdown, no em dashes.`;

export async function writeSongPack(input: {
  title: string;
  artist: string | null;
  analysis: SongAnalysis;
  styleNotes?: string | null;
  direction?: string | null;
  previousTitle?: string | null;
}): Promise<SongPack> {
  const lines = [
    `Blueprint of the liked song (${input.title}${input.artist ? ` by ${input.artist}` : ""}):\n${JSON.stringify(input.analysis)}`,
    input.styleNotes ? `Abiola's standing style notes for Novale: ${input.styleNotes}` : "",
    input.direction ? `Direction for this version: ${input.direction}` : "",
    input.previousTitle ? `This is a rewrite. Do not reuse the previous title "${input.previousTitle}" or its lyrics; take a fresh angle and story.` : "",
  ].filter(Boolean);
  const { text } = await ask({ system: WRITE, user: lines.join("\n\n"), effort: "medium", maxTokens: 16000 });
  const data = parseJson<SongPack>(text);
  if (!data?.suno?.style || !data?.suno?.lyrics) throw new Error("The song pack came back incomplete.");
  data.suno.style = noDash(data.suno.style).slice(0, 1000);
  data.suno.lyrics = noDash(data.suno.lyrics).slice(0, 5000);
  data.suno.title = noDash(data.suno.title).slice(0, 80);
  data.suno.exclude = noDash(data.suno.exclude ?? "");
  data.suno.tips = noDash(data.suno.tips ?? "");
  data.ace ??= { prompt: "", bpm: null, keyScale: null, vocalLanguage: "unknown", duration: 180 };
  data.ace.prompt = noDash(data.ace.prompt || data.suno.style).slice(0, 512);
  data.ace.bpm = data.ace.bpm ?? input.analysis.bpm;
  data.ace.duration = Math.min(Math.max(Number(data.ace.duration) || 180, 60), 300);
  return data;
}
