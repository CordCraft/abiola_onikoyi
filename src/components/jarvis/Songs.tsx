"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SongView } from "@/lib/jarvis/songs/service";

// /jarvis/songs: liked songs with their Suno packs, plus setup.
// /jarvis/songs/<id>: one song, copy buttons for Suno, ACE-Step takes.

const card = "rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-5";
const btn = "rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-40";
const ghost = "rounded-full border border-zinc-300 px-3.5 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-40";

type Status = {
  ytMusic: { connected: boolean; savedAt?: string | null; authUser?: string; brand?: boolean };
  youtube: { connected: boolean; channel?: string; playlist?: boolean };
  styleNotes: string;
  aceStep: boolean;
  googleOAuth: boolean;
};

type Track = { videoId: string; title: string; artist: string | null };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
  return j;
}

const STAGE: Record<string, string> = {
  research: "Researching the song (1 of 4)...",
  listening: "Listening to the whole song on one of your computers (2 of 4)...",
  analysis: "Breaking down the song (3 of 4)...",
  writing: "Writing your version (4 of 4)...",
};

function statusLabel(s: SongView) {
  if (s.status === "writing") return STAGE[s.stage ?? ""] ?? "Writing your version...";
  if (s.status === "error") return "Needs a rewrite";
  return s.suno ? `"${s.suno.title}"` : "Saved";
}

export function SongsPage({ notice }: { notice: string | null }) {
  const [songs, setSongs] = useState<SongView[] | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [cookie, setCookie] = useState("");
  const [authUser, setAuthUser] = useState("0");
  const [pageId, setPageId] = useState("");
  const [notes, setNotes] = useState("");
  const [plays, setPlays] = useState<Track[] | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/jarvis/api/songs").then((r) => r.json()), fetch("/jarvis/api/songs/settings").then((r) => r.json())]);
    setSongs(a.songs ?? []);
    setSt(b);
    setNotes((n) => n || b.styleNotes || "");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Keep polling while something is being written
  useEffect(() => {
    if (!songs?.some((s) => s.status === "writing")) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  }, [songs, load]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Songs</h1>
        <p className="text-sm text-zinc-500">Liked on the iPhone, turned into your own version for Suno.</p>
      </div>
      {msg && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{msg}</p>}

      <section className={card}>
        <p className="text-sm font-medium text-zinc-900">Like a song</p>
        <p className="mt-1 text-xs text-zinc-500">Leave the box empty to save whatever YouTube Music is playing now, or paste a YouTube Music link.</p>
        <div className="mt-3 flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://music.youtube.com/watch?v=..." className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm" />
          <button
            className={btn}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await post<{ speech: string }>("/jarvis/api/songs", link.trim() ? { url: link.trim(), source: "link" } : {});
                setMsg(r.speech);
                setLink("");
                await load();
              })
            }
          >
            Like
          </button>
        </div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-teal-700">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                // Same as the iPhone share sheet: long side 1600 px, JPEG.
                const bitmap = await createImageBitmap(file);
                const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(bitmap.width * scale);
                canvas.height = Math.round(bitmap.height * scale);
                canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                const image = canvas.toDataURL("image/jpeg", 0.72).split(",")[1] ?? "";
                setMsg("Reading the screenshot…");
                const r = await post<{ speech: string }>("/jarvis/api/songs", { image, imageType: "image/jpeg", source: "screenshot" });
                setMsg(r.speech);
                await load();
              });
            }}
          />
          Or upload a screenshot of the song
        </label>
      </section>

      <section className="space-y-2">
        {songs === null && <p className="text-sm text-zinc-500">Loading...</p>}
        {songs?.length === 0 && <p className="text-sm text-zinc-500">No liked songs yet. Use the heart in Control Center while YouTube Music is playing.</p>}
        {songs?.map((s) => (
          <Link key={s.id} href={`/jarvis/songs/${s.id}`} className={`${card} flex items-center gap-3 hover:bg-white`}>
            {s.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumbnail} alt="" className="h-12 w-12 rounded-lg object-cover" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-zinc-100 text-lg">♪</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-zinc-900">{s.title}</span>
              <span className="block truncate text-xs text-zinc-500">
                {s.artist ?? "Unknown artist"} · {statusLabel(s)}
              </span>
            </span>
            <span className="text-xs text-zinc-400">{new Date(s.createdAt).toLocaleDateString()}</span>
          </Link>
        ))}
      </section>

      <section className={`${card} space-y-4`}>
        <p className="text-sm font-medium text-zinc-900">Setup</p>

        <div className="space-y-2">
          <p className="text-sm text-zinc-800">
            1. YouTube Music {st?.ytMusic.connected ? <span className="text-emerald-600">connected</span> : <span className="text-rose-600">not connected</span>}
          </p>
          <p className="text-xs leading-relaxed text-zinc-500">
            This lets Jarvis see what you are playing. On the PC in Chrome: open music.youtube.com signed in as the account you listen with, press F12, open Network, play or click anything, pick a request named <b>browse</b>, and under Request Headers copy the whole <b>cookie</b> value. Paste it here. It stays valid until you sign out of YouTube Music in that browser, and it is stored encrypted.
          </p>
          <textarea value={cookie} onChange={(e) => setCookie(e.target.value)} rows={3} placeholder="Paste the cookie value" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <label>
              Account number in that browser <input value={authUser} onChange={(e) => setAuthUser(e.target.value)} className="ml-1 w-10 rounded border border-zinc-200 px-1 py-0.5" />
            </label>
            <label>
              Brand account id (only if you listen as a brand channel) <input value={pageId} onChange={(e) => setPageId(e.target.value)} className="ml-1 w-40 rounded border border-zinc-200 px-1 py-0.5" />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              className={btn}
              disabled={busy || !cookie.trim()}
              onClick={() =>
                run(async () => {
                  const r = await post<{ plays: Track[] }>("/jarvis/api/songs/settings", { cookie, authUser, pageId });
                  setPlays(r.plays);
                  setCookie("");
                  setMsg("YouTube Music connected.");
                  await load();
                })
              }
            >
              Save and test
            </button>
            {st?.ytMusic.connected && (
              <button
                className={ghost}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await post<{ plays: Track[] }>("/jarvis/api/songs/settings", { test: true });
                    setPlays(r.plays);
                  })
                }
              >
                What is playing?
              </button>
            )}
          </div>
          {plays && (
            <ul className="text-xs text-zinc-600">
              {plays.map((p, i) => (
                <li key={p.videoId}>
                  {i === 0 ? "Now: " : "Before: "}
                  {p.title} {p.artist ? `by ${p.artist}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm text-zinc-800">
            2. Novale playlist{" "}
            {st?.youtube.connected ? <span className="text-emerald-600">saving to {st.youtube.channel}, playlist &quot;Novale Likes&quot;</span> : <span className="text-zinc-500">optional</span>}
          </p>
          <p className="text-xs text-zinc-500">Every like is also added to a private &quot;Novale Likes&quot; playlist on the channel you pick.</p>
          <div className="flex gap-2">
            {/* A route handler that redirects to Google, so a plain link (no prefetch). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className={btn} href="/jarvis/api/songs/youtube/start">
              {st?.youtube.connected ? "Reconnect channel" : "Connect YouTube channel"}
            </a>
            {st?.youtube.connected && (
              <button className={ghost} disabled={busy} onClick={() => run(async () => void (await post("/jarvis/api/songs/settings", { disconnect: "youtube" }), await load()))}>
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-zinc-800">3. Your sound (optional)</p>
          <p className="text-xs text-zinc-500">Standing notes Jarvis follows for every version, for example voice type, languages, Afro or Amapiano leanings, themes to avoid.</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm" />
          <button className={btn} disabled={busy} onClick={() => run(async () => void (await post("/jarvis/api/songs/settings", { styleNotes: notes }), setMsg("Saved your notes.")))}>
            Save notes
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          Plan B generator (ACE-Step on fal.ai): {st?.aceStep ? <span className="text-emerald-600">ready</span> : "needs FAL_KEY on Netlify"}.
        </p>
      </section>
    </div>
  );
}

function CopyBox({ label, text, hint }: { label: string; text: string; hint?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <button
          className={ghost}
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 font-sans text-sm text-zinc-800">{text}</pre>
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export function SongDetail({ id }: { id: string }) {
  const [s, setS] = useState<SongView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/jarvis/api/songs/${id}`);
    const j = await r.json();
    if (r.ok) setS(j.song);
    else setMsg(j.error ?? "Not found");
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const pending = s && (s.status === "writing" || s.generations.some((g) => g.status === "queued" || g.status === "running"));
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => void load(), 5000);
    return () => clearTimeout(t);
  }, [pending, s, load]);

  const act = async (body: unknown) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ song: SongView }>(`/jarvis/api/songs/${id}`, body);
      setS(r.song);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
    setBusy(false);
  };

  if (!s) return <p className="text-sm text-zinc-500">{msg ?? "Loading..."}</p>;
  const a = s.analysis;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/jarvis/songs" className="text-xs text-zinc-500">
        ← Songs
      </Link>
      <div className="flex items-center gap-4">
        {s.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.thumbnail} alt="" className="h-20 w-20 rounded-xl object-cover" />
        )}
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">You liked</p>
          <h1 className="text-xl font-semibold text-zinc-900">{s.title}</h1>
          <p className="text-sm text-zinc-500">
            {s.artist}
            {s.link && (
              <>
                {" · "}
                <a href={s.link} target="_blank" rel="noreferrer" className="underline">
                  Open in YouTube Music
                </a>
              </>
            )}
          </p>
          {s.playlistStatus && <p className="text-xs text-zinc-400">Novale playlist: {s.playlistStatus}</p>}
        </div>
      </div>
      {msg && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{msg}</p>}

      {s.alternatives.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-sm text-zinc-700">Not this song? Pick the right one</summary>
          <div className="mt-2 space-y-1">
            {s.alternatives.map((t) => (
              <button key={t.videoId} disabled={busy} onClick={() => act({ action: "swap", videoId: t.videoId })} className="block text-left text-sm text-zinc-800 underline">
                {t.title} {t.artist ? `by ${t.artist}` : ""}
              </button>
            ))}
          </div>
        </details>
      )}

      {s.status === "writing" && <p className={card}>{STAGE[s.stage ?? ""] ?? "Writing your version..."} The whole thing takes one to four minutes.</p>}
      {s.status === "error" && <p className={`${card} text-sm text-rose-700`}>{s.error ?? "Something failed."}</p>}

      {a && (
        <section className={`${card} space-y-1 text-sm text-zinc-700`}>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">The song ({a.confidence})</p>
          <p>
            <b>{a.genre}</b>
            {a.subgenres?.length ? `, ${a.subgenres.join(", ")}` : ""}
            {a.bpm ? ` · ${a.bpm} bpm` : ""}
            {a.key ? ` · ${a.key}` : ""}
            {a.timeSignature ? ` · ${a.timeSignature}` : ""}
            {a.era ? ` · ${a.era}` : ""}
          </p>
          <p>Mood: {a.mood?.join(", ")}. Energy: {a.energy}.</p>
          {a.groove && <p>Groove: {a.groove}</p>}
          {a.bass && <p>Bass: {a.bass}</p>}
          {a.harmony && <p>Harmony: {a.harmony}</p>}
          <p>Instruments: {a.instruments?.join(", ")}</p>
          <p>Vocals: {a.vocals}</p>
          {a.vocalProduction && <p>Vocal production: {a.vocalProduction}</p>}
          {a.melody && <p>Melody: {a.melody}</p>}
          {a.language && <p>Language: {a.language}</p>}
          {a.hook && <p>Hook: {a.hook}</p>}
          {a.lyricCraft && <p>Lyric craft: {a.lyricCraft}</p>}
          <p>Structure: {a.structure}</p>
          {a.sections?.length ? (
            <details>
              <summary className="cursor-pointer text-zinc-500">Section map ({a.sections.length} sections)</summary>
              <ul className="mt-1 space-y-1">
                {a.sections.map((x, i) => (
                  <li key={i}>
                    <b>{x.name}</b>: {x.lines} lines, {x.syllables} syllables, rhyme {x.rhyme}, {x.delivery}, energy {x.energy}/10. {x.notes}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p>Production: {a.production}</p>
          {a.mix && <p>Mix: {a.mix}</p>}
          <p>Themes: {a.themes}</p>
          <p className="text-zinc-500">Why it works: {a.whyItWorks}</p>
          {s.research?.listenedOn && s.research.heard ? (
            <p className="text-zinc-500">
              {s.research.listenedOn === "the 30-second preview" ? "Heard the 30-second preview" : `Heard in full on ${s.research.listenedOn}`}: {s.research.heard.tempo ? `${Math.round(s.research.heard.tempo)} bpm` : ""}
              {s.research.heard.key ? `, ${s.research.heard.key}` : ""}
              {s.research.heard.sectionPattern ? `, sections ${s.research.heard.sectionPattern}` : ""}.
            </p>
          ) : s.research?.listenError ? (
            <p className="text-zinc-500">Not listened to: {s.research.listenError}</p>
          ) : null}
          {s.research?.sources?.length ? (
            <details>
              <summary className="cursor-pointer text-zinc-500">
                Sources{s.research.lyricsFound ? " (lyrics measured, not copied)" : ""}
              </summary>
              <ul className="mt-1 space-y-1">
                {s.research.sources.map((x) => (
                  <li key={x.url}>
                    <a href={x.url} target="_blank" rel="noreferrer" className="underline">
                      {x.title || x.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      )}

      {s.suno && (
        <section className={`${card} space-y-4`}>
          <p className="text-sm font-medium text-zinc-900">For Suno (Custom mode)</p>
          <CopyBox label="Lyrics" text={s.suno.lyrics} />
          <CopyBox label="Style of Music" text={s.suno.style} />
          <CopyBox label="Title" text={s.suno.title} />
          <CopyBox label="Exclude styles" text={s.suno.exclude} hint={s.suno.tips} />
        </section>
      )}

      {(s.suno || s.status === "error") && (
        <section className={`${card} space-y-2`}>
          <p className="text-sm font-medium text-zinc-900">Rewrite</p>
          <textarea value={direction} onChange={(e) => setDirection(e.target.value)} rows={2} placeholder="Optional: e.g. make it Afrobeats, female vocal, about leaving Lagos" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm" />
          <button className={btn} disabled={busy || s.status === "writing"} onClick={() => act({ action: "rewrite", direction })}>
            Rewrite
          </button>
          <button className={`${btn} ml-2`} disabled={busy || s.status === "writing"} onClick={() => act({ action: "reanalyze", direction })}>
            Re-analyse the song
          </button>
          <p className="text-xs text-zinc-500">Rewrite keeps the breakdown and writes new lyrics. Re-analyse researches the song again first (about a minute).</p>
        </section>
      )}

      {s.suno && (
        <section className={`${card} space-y-3`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-900">Plan B: make it with ACE-Step</p>
            <button className={btn} disabled={busy || Boolean(pending)} onClick={() => act({ action: "generate" })}>
              Make 2 takes
            </button>
          </div>
          <p className="text-xs text-zinc-500">Open-source model on fal.ai, about 11 US cents per take pair. Takes 1 to 3 minutes.</p>
          {s.generations.map((g) => (
            <div key={g.requestId} className="space-y-1">
              <p className="text-xs text-zinc-500">
                {new Date(g.createdAt).toLocaleString()} · {g.status}
                {g.error ? `: ${g.error}` : ""}
              </p>
              {g.audioUrls.map((u) => (
                <audio key={u} controls src={u} className="w-full" />
              ))}
            </div>
          ))}
        </section>
      )}

      <button
        className="text-xs text-rose-600"
        onClick={async () => {
          if (!confirm("Delete this song from Jarvis?")) return;
          await fetch(`/jarvis/api/songs/${id}`, { method: "DELETE" });
          location.href = "/jarvis/songs";
        }}
      >
        Delete
      </button>
    </div>
  );
}
