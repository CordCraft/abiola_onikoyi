# Jarvis listener

The always-on half of Jarvis, deployed to Railway (root directory `services/listener`, volume at `/data`). The site at abiolaonikoyi.com/jarvis is the face; this service is the ears and hands.

- `whatsapp.js`: the owner's number as a linked device (Baileys). Quiet by design: never online, no read receipts, no history sync, slow cached group lookups, approved sends only with a typing pause and a daily cap. Voice notes go to the voice service (Whisper).
- `gmail.js`, `outlook.js`: History API / Graph delta polling with jitter, all connected accounts in turn, inbox and sent. Promotions, social and Focused "Other" mail are skipped.
- `brain.js`: triage in batches with `claude-sonnet-5-5` structured output into `JarvisSignal` rows. Code decides autonomy: calendar holds for agreed meetings and private tasks run automatically; anything that sends a message waits for approval.
- `executor.js` + `jobs.js`: the `JarvisJob` queue shared with the site (push buttons, signal cards, chat tools insert jobs).
- `calendar.js`: Outlook for work, Google for personal (`calendar_routing` setting overrides).
- `push.js`: Web Push with quiet hours, family time, hourly and daily caps; held items retry later.
- `planner.js`: morning plan (`claude-opus-5-5`), stop-work push, nightly rhythm learning, housekeeping (inbound kept 120 days).

Tables are the site's Prisma models (`JarvisConnection`, `JarvisInbound`, `JarvisSignal`, `JarvisJob`, `JarvisPerson`, ...); `src/ddl.sql` creates them if missing. Inserts always set `updatedAt` explicitly so a later `prisma db push` (which drops the DB default) cannot break them.

Env vars: see `docs/JARVIS-V2-SETUP.md`. Health: `GET /health`. Admin page with the WhatsApp QR: `GET /admin?key=LISTENER_ADMIN_KEY` (the site's Connect page shows the same QR).

Tests: `npm test` (unit). Integration against a throwaway Postgres (never production):
`DATABASE_URL=postgres://... DB_POOL_MAX=1 node test/integration.mjs`.
