import "server-only";
import { ask, parseJson } from "@/lib/jarvis/songs/claude";
import type { SongDetails } from "@/lib/jarvis/songs/ytmusic";
import type { AudioMeasurements } from "@/lib/jarvis/songs/listen";

// Step 1 of a song: look the recording up on the web, so the analysis rests
// on facts (tempo, key, producer, drum pattern, vocal production) instead of
// a guess from the title. Names are fine here: this stays inside Jarvis.
// The writer later describes the sound without naming anyone.

export type SongResearch = {
  found: boolean; // false when the web had nothing reliable on this recording
  genre: string | null;
  subgenres: string[];
  bpm: number | null;
  key: string | null;
  timeSignature: string | null;
  releaseYear: string | null;
  producers: string[];
  instrumentation: string[];
  drums: string | null;
  bass: string | null;
  harmony: string | null;
  vocals: string | null; // delivery, range, effects, harmonies, featured voices
  languages: string | null;
  arrangement: string | null;
  soundsLike: string[]; // comparable records, for orientation only
  notes: string | null; // anything else a producer would want to know
  sources: { title: string; url: string }[];
  facts: { durationSec: number | null; year: string | null; album: string | null; lyricsFound: boolean; lyricsSource: string | null };
  listeningOn?: string | null; // the computer that fetched the audio
  audio?: AudioMeasurements | null; // what the voice service measured in the song
};

const SYSTEM = `You are a music researcher working for a producer who wants to make an original song with the same sound and feel as a song he liked.

Use web search to find hard facts about THIS exact recording: tempo (BPM), key and mode, time signature, producer(s), genre and subgenre lineage, instrumentation, drum pattern and percussion, bassline, chord movement, vocal delivery and vocal production (autotune, stacks, harmonies, ad-libs), languages used, arrangement, release year. Good sources: songbpm, tunebat, musicstax, chosic, Genius song pages and credits, Wikipedia, interviews, reviews, producer breakdowns.

Search at most 3 times, then stop. Prefer facts that two sources agree on. If sources disagree on BPM, give the one most sources agree on. Never invent a fact: use null when unknown.

Reply with ONLY this JSON, no prose:
{"found": boolean, "genre": string|null, "subgenres": string[], "bpm": number|null, "key": string|null, "timeSignature": string|null, "releaseYear": string|null, "producers": string[], "instrumentation": string[], "drums": string|null, "bass": string|null, "harmony": string|null, "vocals": string|null, "languages": string|null, "arrangement": string|null, "soundsLike": string[], "notes": string|null}

Be concrete and technical in every string ("log drum on the offbeat, shaker sixteenths, rimshot on 3" rather than "nice beat"). Plain text inside strings.`;

export async function researchSong(input: {
  title: string;
  artist: string | null;
  album: string | null;
  details: SongDetails | null;
}): Promise<SongResearch> {
  const d = input.details;
  const facts = {
    durationSec: d?.durationSec ?? null,
    year: d?.year ?? null,
    album: d?.album ?? input.album,
    lyricsFound: Boolean(d?.lyrics),
    lyricsSource: d?.lyricsSource ?? null,
  };
  const user = [
    `Song: "${input.title}"${input.artist ? ` by ${input.artist}` : ""}.`,
    facts.album ? `Album: ${facts.album}.` : "",
    facts.year ? `Year: ${facts.year}.` : "",
    facts.durationSec ? `Length: ${Math.floor(facts.durationSec / 60)}:${String(facts.durationSec % 60).padStart(2, "0")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const { text, sources } = await ask({ system: SYSTEM, user, effort: "low", maxTokens: 8000, webSearches: 3 });
  const r = parseJson<Omit<SongResearch, "sources" | "facts">>(text);
  return {
    found: Boolean(r.found),
    genre: r.genre ?? null,
    subgenres: Array.isArray(r.subgenres) ? r.subgenres.slice(0, 6) : [],
    bpm: typeof r.bpm === "number" && r.bpm > 30 && r.bpm < 260 ? Math.round(r.bpm) : null,
    key: r.key ?? null,
    timeSignature: r.timeSignature ?? null,
    releaseYear: r.releaseYear ?? facts.year,
    producers: Array.isArray(r.producers) ? r.producers.slice(0, 6) : [],
    instrumentation: Array.isArray(r.instrumentation) ? r.instrumentation.slice(0, 14) : [],
    drums: r.drums ?? null,
    bass: r.bass ?? null,
    harmony: r.harmony ?? null,
    vocals: r.vocals ?? null,
    languages: r.languages ?? null,
    arrangement: r.arrangement ?? null,
    soundsLike: Array.isArray(r.soundsLike) ? r.soundsLike.slice(0, 6) : [],
    notes: r.notes ?? null,
    sources: sources.slice(0, 8),
    facts,
  };
}
