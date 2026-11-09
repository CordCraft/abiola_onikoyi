# Jarvis bridge: work from your iPhone on any computer

The bridge is a small Node script (`scripts/jarvis-bridge.mjs`, no npm packages) that runs on each of your Windows computers. It reports what is on the machine to Jarvis and runs tasks you send from your phone with Claude Code, then sends the answer and any files back.

Open `https://abiolaonikoyi.com/jarvis/machines` on your phone to use it.

## What it does

- Every 30 seconds it reports: hostname, OS, uptime, `claude --version`, git repos (branch, uncommitted changes, last commit) found one level under `~/Downloads`, `~/Documents` and `~`, and your 10 most recent Claude Code sessions.
- Every 10 seconds it asks for work. A task runs `claude -p` in the chosen folder with a permission mode: **Look only** (`plan`, cannot change anything) or **Allowed to edit** (`acceptEdits`). Timeout 20 minutes. Progress lines appear on the page about every 15 seconds. Cancel works from the page.
- Files the task saves in `<folder>/jarvis-out/` (edit mode only) are uploaded (max 10 files, 4MB each) and can be downloaded from the task card.
- It never crashes on network errors: it backs off and retries. Only one bridge instance can run per computer (lock file).

## One-time setup per computer

Needs Node 20+ and Claude Code (`claude` on PATH, or set `"claudePath"` in `~/.claude/jarvis-bridge.json`).

1. On your phone or any browser, open `/jarvis/machines`, press **Show code** under "Pair a new computer".
2. On the computer, copy `scripts/jarvis-bridge.mjs` and `scripts/install-jarvis-bridge.ps1` somewhere (or use the repo checkout), then in PowerShell:

   ```powershell
   node jarvis-bridge.mjs pair <CODE> --name "Kuwait office"
   powershell -ExecutionPolicy Bypass -File install-jarvis-bridge.ps1
   Start-ScheduledTask -TaskName "Jarvis Bridge"
   ```

   Pairing saves `~/.claude/jarvis-bridge.json` (url, machine id, a long secret, name, roots). The URL defaults to the one in `~/.claude/jarvis.json`, else `https://abiolaonikoyi.com`; override with `--url`.
3. The card for that computer turns green within about 30 seconds.

The code is single use and expires after 15 minutes. Run `pair` again with a new code and the same name to rotate a computer's secret.

Useful commands:

```powershell
node jarvis-bridge.mjs run --dry-run   # print what would be reported, send nothing
node jarvis-bridge.mjs status          # show saved config (secret hidden)
Get-Content $HOME\.claude\jarvis-bridge.log -Tail 30
powershell -ExecutionPolicy Bypass -File install-jarvis-bridge.ps1 -Uninstall
```

To allow more folders, edit `roots` in `~/.claude/jarvis-bridge.json` (a task folder must be inside a root or inside a repo the bridge found). To update the bridge, run the install script again and restart the task.

## Live sessions: Remote Control

The bridge is for fire-and-forget tasks. For live back-and-forth, also turn on Remote Control in the Claude desktop app on each computer (Settings), so the Claude iPhone app can attach to it. Keep the computer awake: Windows power plan set to never sleep when plugged in, and disable hibernate on the always-on machines.

## Security notes

- Each computer has its own secret; the server stores only a SHA-256 hash. Removing a computer on the page revokes it immediately.
- Tasks run with your Windows account's rights. "Look only" uses Claude's read-only plan mode; "Allowed to edit" lets Claude change files in that folder. Anyone who can sign in to Jarvis can send tasks, so keep your Jarvis login strong.
- The prompt is passed to Claude on stdin, never on a command line.

## Server pieces

- `src/app/api/jarvis-bridge/*`: pair, heartbeat, jobs/next, jobs/[id]/progress|result|file. Outside the proxy matcher, authenticated with `x-machine-id` and `x-machine-secret`.
- Tables `JarvisMachine` and `JarvisJob` (kind `machine_task`, target `machine:<id>`), created lazily by `ensureV2Tables()`.
- Files live in the Netlify Blobs store `jarvis-files` and download through the session-protected `/jarvis/api/files/jobs/<jobId>/<name>`.
- Chat tools: `list_computers`, `run_on_computer`, `get_computer_job` in `src/lib/jarvis/tools-machines.ts`.
