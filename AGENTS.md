<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project brief (read this before touching Jarvis)

Personal site + private second brain for Abiola Onikoyi, live at https://abiolaonikoyi.com. Deploys automatically on `git push` to `main` (GitHub `CordCraft/abiola_onikoyi` -> Netlify). Stack: Next.js 16 App Router, React 19, Tailwind 4 (CSS-first, no config file), Prisma 6 -> Neon Postgres (`prisma db push`, NO migrations), `@anthropic-ai/sdk` with model `claude-opus-4-8`, jose sessions (HS256 cookie `session`, payload `{user, expiresAt}`), Netlify scheduled functions in `netlify/functions/*.mts`.

Site copy must never contain em dashes (owner requirement).

## Areas

- `/` public portfolio (Three.js background, GSAP). `/blog` auto-generated weekly.
- `/dashboard` private admin (projects + blog editor with AI chat via server action).
- `/jarvis` the second brain. Everything below is about it.

## Jarvis architecture

- **Chat**: `src/components/jarvis/JarvisChat.tsx` (client) <-> `src/app/jarvis/api/chat/route.ts` (NDJSON stream: `meta|ping|status|delta|saved|resume|done|error`). Tools in `src/lib/jarvis/tools.ts` write DIRECTLY (no confirm step) and emit receipt chips with Undo (`undoRecord` action). Context snapshot: `src/lib/jarvis/context.ts`.
- **Turn continuation**: long turns (web research) outlive one Netlify invocation. The route checkpoints `TurnState` into `JarvisTurnState` when `INVOCATION_BUDGET_MS` is spent and emits `{type:"resume", stateId}`; the client immediately re-POSTs `{threadId, resumeStateId}` and the turn continues in a fresh invocation. Preserve this invariant when editing the loop.
- **Files**: parsed in the BROWSER (`processFile` in JarvisChat: pdfjs / xlsx / mammoth / jszip; scanned PDFs render pages to images, attachment kind `pdf-scan`). Extracted text is stored as `JarvisDocument` BEFORE the model runs (never lose data). `pdfjs-dist` is pinned EXACTLY to match `public/pdf.worker.min.mjs`; bump both together.
- **Voice**: Web Speech in JarvisChat; wake word "hey Jarvis" matched on transcripts; TTS chunked with a generation counter. Recognition callbacks are frozen closures: they must call `sendRef.current(...)`, never `send` directly. SpeechRecognition does not exist inside the installed iOS PWA (Apple gap): degrade honestly.
- **Semantic memory**: Voyage `voyage-3.5` + pgvector table `jarvis_embedding` (raw SQL, created out-of-band; HNSW index). `src/lib/jarvis/embeddings.ts` no-ops without `VOYAGE_API_KEY`. Indexed on every doc/note create; nightly `embed-backlog` backfills.
- **Proactive**: scheduled fns -> cron routes guarded by `x-cron-secret: CRON_SECRET`. Schedule (UTC): embed-backlog 03:00, auto-file inbox 04:00, briefing 04:30, nudges 09:30, weekly review Sun 14:00, backup to Netlify Blobs Sun 02:00. Push via `src/lib/jarvis/push.ts` (VAPID env vars; graceful no-op without them).
- **PWA**: manifest served at `/jarvis/manifest.webmanifest` (route handler, exempted from auth in `src/proxy.ts`, linked only from the jarvis layout). `public/sw.js` handles push + notification action buttons (Mark done / Snooze -> `/jarvis/api/task-action`) and must have NO fetch interception (it would break the chat stream).

## Hard-won gotchas (each of these has bitten before)

1. **Netlify limits**: ~6MB request bodies (images capped at 3.5MB raw client-side, text 2M chars), streamed responses still have a wall-clock cap (hence turn continuation), `maxDuration` export is ignored, first byte must go out immediately, and silent streams get killed (hence keep-alive pings every 6s).
2. **`src/proxy.ts` returns 401 JSON for `/jarvis/api/*` without a session.** Machine-to-machine routes (cron, backup) must live under `/api/*` (outside the matcher) with secret-header auth.
3. **netlify.toml is parsed strictly**: an em dash in a comment once broke every deploy with "Failed to parse configuration".
4. **`loading.tsx` makes server-component `redirect()` return HTTP 200** (the redirect travels in the RSC stream). Tests must assert DB effects, not 3xx codes.
5. **Anthropic loop rules**: pass full `response.content` back (thinking blocks included); handle `pause_turn` (server web tools), `refusal`, `max_tokens`; forced `tool_choice` conflicts with thinking + server tools, so use a plain nudge message instead. History must never start with an assistant message (window repair in the chat route).
6. **Local `.env` has an EMPTY `ANTHROPIC_API_KEY`** (the real key lives only in Netlify). Local E2E runs `next start -p 3100` with a fake key and asserts the pipeline up to the model call.

## Testing recipe

Mint a session cookie with jose from `SESSION_SECRET` in `.env`, then hit routes with fetch: `new SignJWT({user: ADMIN_USERNAME, expiresAt: iso}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("7d").sign(TextEncoder.encode(SESSION_SECRET))` sent as `cookie: session=<jwt>`. Always run `npx tsc --noEmit`, `npx eslint src netlify`, and `npx next build` before pushing. Create test rows with an `E2E-TEST` prefix and delete them afterwards. On Windows the Prisma client DLL can be file-locked by a running dev server; kill node processes on the port first.

## Environment variables

Netlify (production): `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (inlined at build time), `VAPID_PRIVATE_KEY`, `VOYAGE_API_KEY`. Local `.env` mirrors these (the bcrypt hash needs each `$` escaped as `\$` locally; the Anthropic key is intentionally empty). `.env` is gitignored: moving to a new machine means copying it through a secure channel, never through git.
