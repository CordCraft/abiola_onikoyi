# Jarvis Songs: like a song, make your own version

Swipe down from the top right of the iPhone while YouTube Music is playing, tap the heart, and Jarvis:

1. saves the song that is playing (works with AirPods, speaker, anything, because it reads your YouTube Music history, not the microphone),
2. adds it to a private **Novale Likes** playlist on the Novale YouTube channel (optional),
3. **researches the song**: tempo, key, producer, drum pattern and vocal production from the web (songbpm, tunebat, Genius credits, reviews), plus its length and lyrics from YouTube Music,
4. **breaks it down like a producer**: groove, bass, harmony, melody, vocal production, language mix, hook mechanics, and a section map (line counts, syllables per line, rhyme scheme, delivery, energy). The original lyrics are only measured for shape; they are never shown, stored or reused,
5. writes **your own version** for Suno to that blueprint: a detailed Style of Music (genre, exact bpm, key, vocal, instruments and how they play, mix), Exclude styles, Title and **original** lyrics that follow the same sections, line lengths, rhyme scheme, hook pattern and language mix, with Suno performance cues like `[Chorus: group vocals, call and response]`,
6. sends a notification about a minute later. Tap it, tap **Copy** on each part, tap **Open Suno**, paste into Create, Custom.

Plan B: **Make 2 takes** generates the song inside Jarvis with ACE-Step 1.5, an open-source model, on fal.ai (about 11 US cents for two 3-minute takes), so you can compare it with Suno.

## Ways to like a song

| Where | How |
| --- | --- |
| Control Center | Swipe down from the top right, tap the Jarvis heart. Music keeps playing, nothing opens. |
| Screenshot (any app) | Take a screenshot of the song (YouTube Music, Spotify, Shazam, a TikTok or Reel sound label, a lock screen player), tap the thumbnail, Share, **Jarvis**. Jarvis reads the title and artist, finds the song on YouTube Music and carries on as below. Works from Photos too. |
| Share a link | In YouTube Music (or any app), Share, **Jarvis**. Links and shared text both work. |
| Siri | "Hey Siri, like this song in Jarvis" (also "save this song to Jarvis"). Siri says what it saved. |
| Action Button / Lock Screen | Same control: Settings, Action Button, Controls, Jarvis, Like this song. |
| Jarvis app | Songs, "Like what's playing", or copy a link in YouTube Music (Share, Copy link) and tap "Paste link". |
| Web | abiolaonikoyi.com/jarvis/songs, paste a link or leave the box empty and press Like, or upload a screenshot. |

If Jarvis is not in the share sheet the first time, scroll the app row to the end, tap **More**, and switch Jarvis on (drag it up to keep it near the front).

If Jarvis picked the wrong song (for example you skipped quickly), open it and use **Not this song? Tap the right one**: it lists your last few plays.

**Rewrite** writes a fresh version from the saved breakdown (quick). **Re-analyse** researches and breaks the song down again first; use it when the breakdown looks wrong, and on songs liked before 25 Nov 2026 (Rewrite does it for them automatically). The box takes a direction like "Afrobeats, female vocal, about leaving Lagos". Standing notes about the Novale sound live on /jarvis/songs and apply to every version.

## One-time setup

### 1. Add the button to Control Center (iPhone, iOS 18 or later)

Swipe down from the top right, tap **+** at the top left, **Add a Control**, search **Jarvis**, pick **Like this song**. Drag it where you want it. The build with this control must be installed from TestFlight first.

### 2. Connect YouTube Music (on the PC, about 2 minutes)

Jarvis needs to read your listening history. YouTube Music has no official API for this, so it uses your own signed-in browser cookie, the same way the open-source ytmusicapi library does.

1. In Chrome on the PC, open music.youtube.com, signed in as the account you listen with on the iPhone.
2. Press F12, open the **Network** tab, then click anything on the page (Home, Library).
3. In the filter box type `browse`, click one of the `browse` requests.
4. Under **Headers**, **Request Headers**, find `cookie:` and copy its whole value.
5. On abiolaonikoyi.com/jarvis/songs, paste it in step 1 and press **Save and test**. You should see what you last played.

Notes:
- If several Google accounts are signed in to that Chrome, set "Account number" to the position of the listening account (0 for the first, 1 for the second).
- If you listen as a brand channel, put its brand account id in that box (the number in the URL of myaccount.google.com when that brand account is selected).
- YouTube's **watch history must be on** (YouTube Music, Settings, Privacy, Pause watch history off). Without history Jarvis cannot see plays.
- The cookie lasts until you sign out of YouTube Music in that Chrome. If Jarvis says the cookie was turned down, repeat these steps. Do not sign out of that browser profile.

### 3. Novale Likes playlist (optional)

On /jarvis/songs press **Connect YouTube channel** and pick the Novale channel in Google's chooser. Before the first time, in Google Cloud Console for the OAuth client the site already uses (`GOOGLE_CLIENT_ID`):

1. APIs and Services, Library: enable **YouTube Data API v3**.
2. Credentials, the OAuth client: add the redirect URI `https://abiolaonikoyi.com/jarvis/api/songs/youtube/callback`.
3. OAuth consent screen: add the scope `https://www.googleapis.com/auth/youtube`. If the app is still in **Testing**, Google expires the connection after 7 days; set it to **In production** (an "unverified app" warning on your own login is fine).

Each like costs 50 of YouTube's 10,000 free daily quota units, so about 190 likes a day.

### 4. ACE-Step plan B (optional)

Needs `FAL_KEY` (or `FALAI_API_KEY`) on Netlify. /jarvis/songs shows "Plan B generator: ready" when it is set. Audio links from fal last for a while but not forever: tap **Save** on a take you want to keep.

## How it works (for future changes)

| Piece | Where |
| --- | --- |
| Control Center button, Siri phrase | `mobile/targets/widget/Widgets.swift` (`LikeSongControl`), `mobile/targets/_shared/JarvisCore.swift` (`LikeSongIntent`, runs in the background), `mobile/targets/intents/JarvisShortcuts.swift` |
| App screens | `mobile/src/app/songs/index.tsx`, `mobile/src/app/songs/[id].tsx`; notifications carry `route` and open them |
| API | `POST/GET /jarvis/api/songs`, `GET/POST/DELETE /jarvis/api/songs/[id]` (rewrite, swap, generate), `/jarvis/api/songs/settings`, `/jarvis/api/songs/youtube/{start,callback}` |
| Share sheet | `mobile/targets/share/` (`ShareViewController.swift`, a share extension): shrinks the image to 1600 px JPEG and POSTs `{ image }`, `{ url }` or `{ text }` to `/jarvis/api/songs` |
| Screenshots | `src/lib/jarvis/songs/vision.ts` reads title and artist with `claude-sonnet-5-5`; `searchSongs()` in `ytmusic.ts` (YouTube Music search, songs filter, works signed out) finds the video; other hits become "Not this song?" choices |
| Now playing | `src/lib/jarvis/songs/ytmusic.ts`: YouTube Music `FEmusic_history` with SAPISIDHASH auth; first row is the current song. Links resolve through YouTube oEmbed. |
| Pipeline | `runStep()` in `src/lib/jarvis/songs/service.ts`: research, analysis, writing, each in its own invocation (`kick()` POSTs `/api/jarvis-songs/step` with `x-cron-secret`, which runs the step in `after()`); `JarvisSong.stage` shows progress |
| Research | `src/lib/jarvis/songs/research.ts`, `claude-opus-5-5` with web search (3 searches max); `songDetails()` in `ytmusic.ts` reads length, year and lyrics (Musixmatch / LyricFind via the YouTube Music lyrics tab, signed out). Stored in `JarvisSong.research` without lyrics |
| Blueprint and Suno pack | `src/lib/jarvis/songs/write.ts`: `analyzeSong()` (lyrics measured for shape only) and `writeSongPack()` (never sees the original lyrics), both `claude-opus-5-5` via `claude.ts` (server-side refusal fallbacks). Style never names artists (Suno blocks names) |
| Playlist | `src/lib/jarvis/songs/youtube.ts`, tokens encrypted in JarvisSetting `songs_youtube` (not JarvisConnection, which the listener treats as mailboxes) |
| ACE-Step | `src/lib/jarvis/songs/fal.ts`, fal queue API, polled whenever the song is opened |
| Table | `JarvisSong`, created by `ensureSongTables()` in `src/lib/jarvis/songs/setup.ts` |

Settings keys: `songs_ytmusic_auth` (encrypted cookie), `songs_youtube` (encrypted refresh token), `songs_style_notes`.

Why not the microphone (ShazamKit)? Apps cannot hear audio going to AirPods, and you mostly listen on AirPods. The history approach works for every output.
