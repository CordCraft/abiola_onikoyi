# Jarvis health: iPhone setup

Jarvis reads your health from the iPhone, estimates sleep from when you stop and start using the phone, plans a bodyweight + running day around your rhythm, and nudges you with notifications you can answer.

Apple only lets apps on the phone read Health data. There is no web API for it. There are two ways in:
- **The native Jarvis app** (`Downloads\jarvis-ios`, installed through TestFlight; see its README). It reads Health directly, syncs in the background, and puts a Reply field in every notification banner. With the app, you only need the tap automations in section 2.
- **Apple Shortcuts only** (sections 2 to 4). This needs no app.

## 1. Make your key

1. Open **abiolaonikoyi.com/jarvis/health** on the iPhone.
2. Under "Connect your iPhone", tap **Make my iPhone key** and **Copy key**. It is shown once. Only a hash is stored. Making a new key turns the old one off.

Every request below sends the header `Authorization: Bearer <your key>` to `https://abiolaonikoyi.com/api/jarvis-health`.

## 2. Taps, for the sleep estimate

Sleep is the longest break of 3 hours or more in phone use between 18:00 and 14:00 the next day. Bedtime is the last tap before the break, and wake-up is the first tap after it. iOS does not let Shortcuts see every unlock, so app opens stand in for taps. The more apps you include, the sharper the estimate.

In the Shortcuts app, open **Automation**, tap **+**, and choose **App**:

1. Choose the apps you open most, especially last thing at night and first thing in the morning. For example: WhatsApp, Messages, Safari, Chrome, Mail, Outlook, Instagram, X, YouTube, Teams.
2. Tick **Is Opened**. Choose **Run Immediately**. Turn **Notify When Run** off.
3. Add the action **Get Contents of URL**:
   - URL: `https://abiolaonikoyi.com/api/jarvis-health`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <your key>`
   - Request Body: **JSON**, with one Text field: `event` = `phone_use`
   - Optional: add a field `app` set to the Shortcut Input's Name.
4. Save.

Optional extras that use the same action:
- **Charger** automations (Is Connected and Is Disconnected). Plugging in at night and unplugging in the morning are strong signals.
- **Alarm**, When Stopped. This is a good wake-up marker.

Opening Jarvis itself always counts. The installed app pings on every open.

## 3. Health numbers

Create a Shortcut named **Send health to Jarvis**:

1. **Find Health Samples**: Type is Steps, Start Date is today. Then **Calculate Statistics**, Sum. Set Variable `steps`.
2. **Find Health Samples**: Type is Resting Heart Rate, Start Date is in the last 1 day, sort by Start Date latest first, limit 1. Get **Value**. Set Variable `rhr`.
3. **Find Health Samples**: Type is Heart Rate Variability, in the last 1 day. **Calculate Statistics**, Average. Set Variable `hrv`.
4. **Find Health Samples**: Type is Active Energy, Start Date is today. **Calculate Statistics**, Sum. Set Variable `energy`.
5. **Find Health Samples**: Type is Walking + Running Distance, Start Date is today. **Calculate Statistics**, Sum. Set Variable `km`.
6. Only if you wear an Apple Watch or use Sleep Focus: **Find Health Samples**, Type is Sleep Analysis, in the last 1 day, Value is Asleep (any of Core, Deep, REM). Get **Duration** in minutes, then **Calculate Statistics**, Sum. Set Variable `sleepmin`.
7. **Get Contents of URL**: POST to the same URL with the same header, Request Body **JSON**:
   - `day` (Text) = `today`
   - `metrics` (Dictionary) = `steps`: steps, `resting_hr`: rhr, `hrv`: hrv, `active_energy`: energy, `walking_running_km`: km, `sleep_minutes`: sleepmin

Then add **Time of Day** automations that run this Shortcut at **09:00, 13:00, 17:00 and 21:00**, each with Run Immediately on. Every send overwrites that day's numbers, so running it more often is fine.

Other metric names Jarvis accepts include `weight_kg`, `vo2max`, `spo2`, `respiratory_rate`, `exercise_min`, `flights`, `water_ml` and `mindful_min`. A value can be a number or Shortcut text with several numbers on separate lines. Steps, energy, distance and minutes are summed. Everything else is averaged.

## 4. Optional: ask Siri for the plan

Create a Shortcut named **Jarvis plan**. Use **Get Contents of URL**, method GET, to the same URL with the same header. Then use **Speak Text** with the result. "Hey Siri, Jarvis plan" then reads out today's times. Add `?full=1` to the URL for the full picture.

## 5. Notifications you can answer

Every Jarvis push now opens a reply screen, not the homepage. The reply screen shows the message, one-tap answers (Done, Skipping today, Move it to this evening, Do it, Not now, Mark it done) and a text box. Your answer goes to Jarvis with the notification attached, and Jarvis acts on it. For example, it logs the workout, completes the task, approves the signal or moves the session in your calendar.

Web app limit: iOS does not allow a text field inside a web app's notification banner, and it ignores web notification buttons. In the PWA, one tap opens the reply screen with the keyboard ready. The native app (`jarvis-ios`) has a real Reply field in the banner, plus Done, Mark done, and Do it / Not now buttons. Jarvis answers with a new notification you can reply to again, in the same chat. Once the native app is registered, the iPhone's web push subscription is skipped so you are not alerted twice.

## How the coach works

- **Plan.** Strength runs Sunday, Tuesday and Thursday, rotating A (push-ups, squats, plank, glute bridges), B (push-up variety, lunges, side plank, pike push-ups) and C (ladders plus a max test). Runs are an easy run on Monday and intervals on Wednesday. A long easy run on Saturday is added once the easy run reaches 25 minutes. Workdays also get three short move breaks and a wind-down. Workouts go before work if there is a 50-minute window after you wake. Otherwise they go straight after work.
- **Progression.** Max tests raise the numbers, and finished runs add a minute to the easy run, up to 45 minutes. You can tell Jarvis "I can do 30 push-ups now" or "make runs Sunday and Tuesday" at any time.
- **Readiness.** The score is 0 to 100. It comes from last night's sleep, resting heart rate and HRV against your 2-week normal, and yesterday's load. Red cuts strength to 2 rounds and swaps intervals for an easy run.
- **Nudges.** The coach runs every 15 minutes (`netlify/functions/health-coach.mts`). It sends the morning brief after your first tap of the day, each session at its time, and a check-in 3 hours later if nothing was logged. It also sends a steps nudge when you are well behind, and a wind-down. It never sends during quiet hours, and sends at most 8 a day. Times and quiet hours come from Settings, My rhythm.

## Code map

| Piece | Where |
| --- | --- |
| Ingest (Shortcuts) | `src/app/api/jarvis-health/route.ts` |
| App-open ping | `src/app/jarvis/api/health-ping/route.ts`, `src/components/jarvis/PhoneUseBeacon.tsx` |
| Sleep inference | `src/lib/jarvis/health/sleep.ts` |
| Plan, readiness, progression | `src/lib/jarvis/health/plan.ts` |
| Snapshot, token, logging | `src/lib/jarvis/health/data.ts` |
| Chat tools | `src/lib/jarvis/tools-health.ts` (`get_health`, `log_workout`, `update_fitness_profile`) |
| Coach cron | `src/app/api/cron/health-coach/route.ts` |
| Reply screen | `src/app/jarvis/reply/[id]/page.tsx` (every push is stored in `JarvisNotification` by `src/lib/jarvis/push.ts`) |
| Native app endpoints | `src/app/api/jarvis-app/{register,feed,reply,turn}`, `src/lib/jarvis/app-push.ts` (Expo push), `src/lib/jarvis/app-turn.ts` (chained chat turns) |
| Tables | `JarvisHealthSample`, `JarvisWorkout`, `JarvisNotification` (with `threadId`), `JarvisAppDevice` via `ensureCompanionTables()` in `src/lib/jarvis/companion-setup.ts` |
