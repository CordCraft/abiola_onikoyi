# Jarvis v3: a second brain that closes its own loops

Branch `feature/jarvis-second-brain`. Owner brief (13 Nov 2026): "I don't want to be writing tasks or closing them. Read everything, close what I've done, only bring up what is still pending, nudge me on what I forgot, learn how I work and advise me. Stay on 24/7."

Read `AGENTS.md` (Jarvis architecture) first. No em dashes anywhere (code comments, copy, commits). Keep the three schema copies in sync: `prisma/schema.prisma`, `services/listener/src/ddl.sql`, `src/lib/jarvis/v2/setup.ts` (raw inserts always set `updatedAt`).

## Problems found (audit of main @ 3499926)

1. Outgoing messages are ingested (WhatsApp fromMe, Gmail SENT, Outlook Sent Items) but never used to resolve anything. No reconcile loop exists. Example: draft agreement sent to the Upstream group 11 Nov 21:46, the 13 Nov briefing still said "send it".
2. Signals never expire (housekeeping only dismisses fyi/plan after 3 days). Tasks have no link to the signal or thread they came from (`executor.js` createTask).
3. Dedupe is only the model's `same_as_signal_id` against `openSignals()` (7 days, 60 rows, excludes applied/dismissed), so a thread creates a new signal and task each time. 60 open tasks on 13 Nov, with 3x "Saudi Eagles water", 5x "Deepcrest HoT".
4. Push gate (`push.js` mayInterrupt): family 18:30-21:30 blocks score < 85, quiet 22:30-06:30 blocks < 95, caps 15/day 4/hour, learned quietStart can start silence earlier, "stop work" push at 18:00.
5. No re-surfacing of unanswered inbound messages after time passes. Only nudge is the 12:30 Kuwait cron.
6. Learning is only active hours.
7. Airbnb guest threads are seen only as Airbnb notification emails; host and co-host replies inside Airbnb are invisible, so guest reply signals never close.
8. Voice: non-streaming Whisper small on CPU behind a Netlify proxy hop, 800 ms end-of-speech, Opus at effort high for every voice turn, sentence-wise TTS.

## Design

### A. Loop closing (listener)
- Schema: `JarvisSignal` gains `threadKey`, `personKey`, `expiresAt`, `resolvedAt`, `resolvedBy` (`reply|reconcile|expired|manual|other_party`), `resolution` (one line of evidence). New statuses `resolved` and `expired`. `JarvisTask` gains `sourceSignalId`, `threadKey`, `closedBy`, `closeNote`. `JarvisPerson.lastOutboundAt` is finally written and `openLoops` decremented on resolve.
- New table `JarvisLedger` (id, kind, title, summary, personKey, threadKey, signalId, taskId, closedBy, evidence, closedAt, createdAt, updatedAt): the permanent memory of what got done. Embedded like notes when `VOYAGE_API_KEY` is set (site side), fed back into triage and advice context.
- Deterministic close: an outgoing message on the same `threadKey` after a `reply`/`followup` signal's createdAt resolves that signal (and its task) with evidence = the outgoing text.
- Model close (`reconcile.js`): after each triage batch that contains outgoing messages, and nightly over the last 24 h of outgoing messages plus inbound messages where someone else (for example the co-host) answered, ask claude-sonnet-5-5 which open signals and tasks are now done, with evidence. Only ids from the supplied list, confidence >= 0.75, else ignored. Every close writes a ledger row and is undoable.
- Expiry: triage output gains `expires_at` (when the item stops mattering: the guest's checkout, the meeting time, the deadline). Housekeeping expires past ones; reply signals untouched for 5 days are expired with a ledger note; overdue tasks with no activity for 7 days get one "still relevant?" card (never silently deleted).
- Dedupe: `saveSignal` merges into an existing signal on the same threadKey + kind (open, or applied within 7 days) instead of inserting. `createTask` skips when an open task has the same `threadKey` or a title similarity >= 0.55 (pg_trgm `extensions.similarity`, fallback normalized token overlap) and links instead. `openSignals()` also shows recently applied/resolved items to the model.
- One-time clean-up: on first run after deploy, reconcile runs in proposal mode over all open tasks and signals and creates one card "Clean-up: I can close N items you've already done and merge M duplicates", listing them. Approve applies; nothing is closed before that tap. A script `scripts/jarvis-cleanup-report.mjs` (read-only) prints the same proposal locally.

### B. Always on (listener + site settings)
- Rhythm gains `alwaysOn` (default true), `familyThreshold` (default 70), `quietThreshold` (default 80), `stopWorkPush` (default false), caps 40/day and 8/hour. With alwaysOn the learned quietStart override is ignored.
- Anything held or over the cap is never dropped: `digest.js` sends one bundled push "While you were busy: 4 replies owed, 2 done by Jarvis" at family end, quiet end and every 2 h while items wait.
- Evening close-out push lists what Jarvis closed today (with Undo on the site) and what is still open.

### C. Watching your back (listener)
- `nudger.js`, every 20 min: threads whose last message is inbound, from a real person (not newsletters, no-reply, automated, groups unless he was mentioned or asked directly), older than 2 h for people he answers fast or tagged client/family/partner, 6 h otherwise, with no outgoing message after and no open signal: batch-check with the model "does this still need him?" and create a `reply` signal titled "Still waiting on you: ...". At most one nudge per thread per 24 h, two in total, then it rides in the digest.
- Stalled tasks: open tasks with no activity for 3 days get "Pick this up?" (once per 3 days per task).
- `learn.js`, nightly: per-person reply latency median and answer rate, per-kind and per-person dismiss/snooze rates, preferred hours. Stored on `JarvisPerson` and JarvisSetting `behaviour`; summarized into the triage prompt and the gate (fast-answer people get earlier nudges, often-dismissed kinds score lower).
- Advice (`advisor.js`, claude-opus-5-5): daily in the morning plan and a Sunday review: 3 to 5 concrete "do it this way, you'll be faster" suggestions drawn from the ledger, open loops, latencies and calendar (for example "you answer guest check-in questions by hand 9 times a day, let Hostfully send the check-in template at booking").

### D. Hostfully (listener)
- `hostfully.js`: client modelled on `~/reply-guard/src/hostfully.js` (base `https://api.hostfully.com/api/v3.3`, header `X-HOSTFULLY-APIKEY`, agency UID from `HOSTFULLY_AGENCY_UID`). Poll guest message threads every 2 min with a cursor; store guest messages as `in`, host/co-host/automated as `out` (automated flagged in the body prefix so they do not count as the owner's reply for nudges, but do resolve "send check-in details" items), `source='hostfully'`, `threadKey='hostfully:<threadUid>'`, sender = guest name, with property name and stay dates.
- When Hostfully is active, Airbnb notification emails about guest messages are stored but not triaged (the Hostfully copy is the source of truth).
- `send_reply` on a hostfully signal posts through `POST /messages` (still asks first).
- Env on Railway `jarvis-listener`: `HOSTFULLY_API_KEY`, `HOSTFULLY_AGENCY_UID`. Missing key = loop skipped silently.

### E. Voice (site + voice service)
- Voice turns use claude-sonnet-5-5 at low effort with a short spoken-style system addendum and a trimmed tool set; text chat keeps Opus.
- Browser talks to the Railway voice service directly with a short-lived HMAC token from `/jarvis/api/voice/token` (no Netlify hop); CORS for abiolaonikoyi.com. Falls back to the proxy.
- End-of-speech 550 ms, Whisper beam 1 with `WHISPER_MODEL` still configurable, TTS starts on the first clause (comma or 60 chars), not the first sentence.

### F. Site
- Signals: resolved and expired hidden from Today, visible under "Closed by Jarvis" with evidence and Undo. Tasks show where they came from and why they were closed. Memory gets a "Done" ledger view. Settings rhythm form gets the new fields. Chat `create_task` dedupes the same way; chat context includes the last 7 days of ledger and current advice.

## Rollout
Nothing ships until the owner says "ship". PR from this branch; merge deploys Netlify and the Railway listener and voice services (root dirs on main). After deploy: owner adds the Hostfully key in Railway, approves the clean-up card.
