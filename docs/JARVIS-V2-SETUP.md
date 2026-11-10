# Jarvis v2 setup: the always-on companion

Jarvis v2 is three parts:

| Part | Where | What it does |
| --- | --- | --- |
| Site (`/jarvis`) | Netlify (this repo, push to `main`) | Today screen, signal cards, chat, Face ID, connections, computers, Claude app connector |
| Listener (`services/listener`) | Railway, always on | WhatsApp (linked device on your number), Gmail and Outlook watchers, triage brain, calendar writes, push, daily planner |
| Voice (`services/voice`) | Railway | Whisper (listening) and Kokoro (speaking) |

Secrets were generated into `C:\Users\abiol\jarvis-v2-secrets.env` on the laptop where this was built (never commit them). Generate new ones anywhere with:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## 1. Railway: two new services

In the Railway project you already use, add two services from the GitHub repo `CordCraft/abiola_onikoyi`, branch `main`:

**jarvis-listener**
- Settings, Source, Root Directory: `services/listener`
- Add a Volume mounted at `/data` (keeps the WhatsApp link across deploys)
- Generate a public domain (for the health page)
- Variables:
  - `DATABASE_URL`: the Supabase **session pooler** string (port 5432, same as Netlify's `DIRECT_DATABASE_URL`)
  - `JARVIS_ENCRYPTION_KEY`, `LISTENER_ADMIN_KEY`: from the secrets file
  - `ANTHROPIC_API_KEY`: same key as Netlify
  - Push needs no keys here: the listener sends through the site (`/api/jarvis-push`, header `x-listener-key`)
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`: from steps 3 and 4
  - `VOICE_SERVICE_URL`, `VOICE_SECRET`: the voice service URL and secret (voice notes get transcribed)
  - Optional: `OWNER_TZ` (default `Asia/Kuwait`), `WHATSAPP_NUMBER` (digits only, to get a pairing code instead of a QR), `WHATSAPP_MAX_SENDS_PER_DAY` (default 25)

**jarvis-voice**
- Root Directory: `services/voice` (builds from its Dockerfile)
- 2 GB RAM, 2 vCPU is enough for the `small` Whisper model
- Generate a public domain
- Variables: `VOICE_SECRET` (from the secrets file). Optional `WHISPER_MODEL` (default `small`), `DEFAULT_VOICE` (default `bm_george`). See `services/voice/README.md`.

## 2. Netlify environment variables

Add to the site, then redeploy:
- `JARVIS_ENCRYPTION_KEY` (same as Railway)
- `LISTENER_URL` (the listener's Railway URL, no trailing slash), `LISTENER_ADMIN_KEY`
- `VOICE_SERVICE_URL` (the voice service's Railway URL), `VOICE_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`
- `JARVIS_MCP_TOKEN` (Claude app connector, see `docs/JARVIS-MCP.md`)
- `PASSKEY_RP_ID=abiolaonikoyi.com` (Face ID)

## 3. Google (all Gmail accounts + Google Calendar)

One Google Cloud project serves every Gmail address.
1. console.cloud.google.com, new project "Jarvis".
2. APIs and Services, Library: enable **Gmail API** and **Google Calendar API**.
3. OAuth consent screen: External, app name Jarvis, your email as support and developer contact. Scopes: `gmail.readonly`, `gmail.compose`, `calendar.events`, `openid`, `email`.
4. **Publish the app** (Publishing status: In production). In "Testing" mode Google expires the connection every 7 days. Unverified is fine for personal use: when you connect, Google warns "Google hasn't verified this app"; choose Advanced, then Go to Jarvis.
5. Credentials, Create credentials, OAuth client ID, Web application. Authorised redirect URI: `https://abiolaonikoyi.com/jarvis/api/connect/google/callback`.
6. Copy the client ID and secret into Netlify and Railway.

## 4. Microsoft 365 / Outlook

1. entra.microsoft.com (signed in to the Nikstalis tenant), App registrations, New registration: name Jarvis, account types "Accounts in any organizational directory and personal Microsoft accounts", redirect URI (Web) `https://abiolaonikoyi.com/jarvis/api/connect/microsoft/callback`.
2. Certificates and secrets, New client secret, 24 months. Put a reminder in the calendar for the expiry date.
3. API permissions, Microsoft Graph, Delegated: `Mail.Read`, `Mail.Send`, `Mail.Read.Shared`, `Mail.Send.Shared`, `Calendars.ReadWrite`, `User.Read`, `offline_access`. Grant admin consent for the tenant.
4. Copy the Application (client) ID and the secret value into Netlify and Railway.

## 5. Connect everything (on the laptop, about 10 minutes)

Open `https://abiolaonikoyi.com/jarvis/connect`:
1. **WhatsApp**: when the listener is running a QR code appears. iPhone, WhatsApp, Settings, Linked devices, Link a device, scan. WhatsApp allows four linked devices: unlink an old one if full.
2. **Email**: press "Connect a Google account" once per Gmail address (the Airbnb/EraView one, abiolaonikoyi@gmail.com, HopperTax, and the rest). Press "Connect Microsoft 365" for the Nikstalis mailbox (and any other Outlook).
3. Set each account to Work or Personal. Work events land on Outlook, personal and family on Google. Change the routing at the bottom of the page if needed.

## 6. iPhone

1. Open abiolaonikoyi.com/jarvis in Safari, Share, Add to Home Screen (if not already).
2. Inside the installed app: sign in once with the password, go to Settings, "Set up Face ID on this device". From then on Face ID signs you in.
3. On Today tap the bell button to allow notifications.
4. Settings, My rhythm: check work hours, family time and quiet hours.

## 7. Your four computers

See `docs/JARVIS-BRIDGE.md`. On each PC (Dhahran, Kuwait room, Kuwait office, travel laptop): pair with a code from `/jarvis/machines`, run the installer, and turn on Remote Control in the Claude desktop app.

## 8. Claude app

See `docs/JARVIS-MCP.md`: add Jarvis as a custom connector so the Claude app on your phone can read and act on Jarvis.

## How it behaves

- **Reads quietly**: never shows as online, never sends read receipts, no full history pull; mail polled every 1.5 minutes with jitter; group names looked up slowly and cached.
- **Acts on its own** only for: tentative calendar holds for meetings with an agreed time (push tells you, tap to undo) and private tasks.
- **Asks first** for every message it would send (WhatsApp or email): one tap on the push or the card, with the draft editable.
- **Never interrupts** during quiet hours or family time unless it is urgent (score 85+), and caps pushes per hour and per day.
- **Morning plan** 20 minutes after your quiet hours end: timed blocks, three moves toward the USD 1M goal, family time protected. One tap blocks it on your calendars.
- **Stop-work push** at your work end time on workdays.
- **Learns** your real hours nightly from when you actually send messages.
- Messages are kept 120 days, then deleted.

## Setup state and hand-over (10 Nov 2026)

Live and verified on 10 Nov 2026:
- **Listener** (Railway project "easygoing-optimism", service jarvis-listener, https://jarvis-listener-production.up.railway.app, volume /data): health ok, no missing env, triage, Gmail, Outlook and job loops running. First real signal produced from Outlook (the IDDA Azerbaijan call).
- **Voice** (service jarvis-voice, https://jarvis-voice-production-6416.up.railway.app): Whisper small and 54 Kokoro voices.
- **WhatsApp**: linked on the owner number +966 55 722 4308.
- **Mailboxes connected**: abiolaonikoyi@gmail.com (personal, Google Calendar) and ceo@nikstalis.com (work, Outlook).
- **Google Cloud** project "Jarvis" (id crested-photon-514218-k2, owner abiolaonikoyi@gmail.com): Gmail API and Calendar API enabled, OAuth app published to production, web client "Jarvis web".
- **Entra** app "Jarvis" (Nikstalis tenant, app id be576ddc-c1ce-4d3f-b3a7-2d9dc46bf6e4): Mail.Read, Mail.Send, Calendars.ReadWrite, admin consent granted, client secret expires Nov 2028.
- **Supabase**: dedicated login `jarvis_listener` with grants and row level security policies on the Jarvis* tables only. The listener uses it; the site still connects as postgres.
- **Anthropic**: console key "jarvis-listener" (never expires), used only by the listener.
- **Netlify**: all v2 variables set. Real secrets are marked secret; PASSKEY_RP_ID, LISTENER_URL, VOICE_SERVICE_URL, GOOGLE_CLIENT_ID and MS_CLIENT_ID are plain on purpose.

Secrets: the generated values live only on the laptop used on 9 and 10 Nov 2026 (`C:\Users\abiol\jarvis-v2-secrets.env` and the folder `C:\Users\abiol\jarvis-setup`). None of the next steps need them. If a value is ever needed on another computer, read it from Railway (service, Variables) instead of copying files around.

Progress on 10 Nov 2026 (afternoon, from the HP Omnibook laptop):
- iPhone Face ID works (passkey saved to iCloud Passwords; a passkey saved into Bitwarden is not offered by the plain Face ID sheet).
- Shared mailbox support shipped (commit 5713a18) and is deployed to Netlify and the Railway listener. HopperTax is not reading yet: it waits on the four owner steps in item 2.
- The HP Omnibook laptop (hostname Billionaire-HP-Omnibook) is paired as "HP Omnibook" and its "Jarvis Bridge" logon task is installed and running. It uses the Claude CLI bundled with the Microsoft Store desktop app (commit 72394cf taught the bridge that folder).

Next steps (pick up from any computer):
1. **Other Gmail accounts.** The owner keeps each Gmail in its own Chrome profile (about eight). Fastest, with no passwords: in each Chrome profile open https://abiolaonikoyi.com/jarvis/connect, sign in to Jarvis, press "Connect a Google account", pick that profile's Gmail, then Advanced, "Go to abiolaonikoyi.com", Select all, Continue. Then set Work or Personal for it on the Connect page. Include the Airbnb / EraView Gmail.
2. **HopperTax mail** (ceo@hoppertax.com) is a shared mailbox in the Nikstalis tenant. Code is built (Nov 2026): the listener reads shared mailboxes at `/users/{mailbox}` through a signed-in Outlook account and answers from them. To turn it on: (a) Entra, app "Jarvis", API permissions, add Microsoft Graph delegated `Mail.Read.Shared` and `Mail.Send.Shared`, Grant admin consent; (b) Exchange admin centre, the shared mailbox, Delegation: give ceo@nikstalis.com Full Access and Send as; (c) /jarvis/connect, Remove the ceo@nikstalis.com Outlook row and press "Connect Microsoft 365 / Outlook" again so the new scopes are granted; (d) under Shared mailboxes add ceo@hoppertax.com read through ceo@nikstalis.com. The row shows "checked ..." within two minutes, or a plain-English error.
3. **iPhone**: Face ID done. Still to do: on Today tap the bell to allow notifications; check Settings, My rhythm.
4. **Computers** (HP Omnibook done; still Dhahran home, Kuwait room, Kuwait office, travel laptop if it is a different machine): see `docs/JARVIS-BRIDGE.md`. Pair each from /jarvis/machines, run the installer, and turn on Remote Control in the Claude desktop app.
5. **Claude app connector**: see `docs/JARVIS-MCP.md`. The URL token is JARVIS_MCP_TOKEN in Netlify.
6. **Supabase quota**: the organisation went over its quota last billing cycle, and projects are restricted from 29 Nov 2026 if it stays over. That would take down the site and Jarvis. Check usage in the Supabase dashboard and upgrade or trim before then.
7. **Tidy**: delete the stray JarvisConnection row "whatsapp / pending" (paused); optionally rename the Railway project to "Jarvis".

Traps learned during setup:
- Claude Code auto mode refuses to register the bridge's logon task itself. Claude can pair (`node scripts/jarvis-bridge.mjs pair <CODE> --name ...`) but the owner runs `powershell -ExecutionPolicy Bypass -File scripts\install-jarvis-bridge.ps1; Start-ScheduledTask -TaskName "Jarvis Bridge"` from the repo folder.
- The Supabase MCP connector on the HP Omnibook is signed in to "CordCraft's Org", which does not contain this site's project (vbrwrexbjnwayhohstra), so SQL and quota checks for the site fail there. Use the Supabase dashboard for the quota, and the Connect page or the owner's own SQL for row clean-ups.
- Netlify: never tick "Contains secret values" for non-secret values (the domain, URLs, client ids). They appear in the build output, trip "Exposed secrets detected" and fail the build. Netlify also skips empty commits, so push a real change or use Trigger deploy.
- Netlify secret values cannot be read back by anyone. To give another service the database or an API key, create a dedicated credential (as done for Supabase and Anthropic).
- The Google Cloud console ignores reference clicks on an API's Enable button; click by position and confirm the page changes to "API/Service details".
- The listener sends push through the site (`/api/jarvis-push` with header `x-listener-key`), so the VAPID keys live only in Netlify.
