# Connecting Jarvis to everything

After this setup Jarvis keeps itself updated. You never type status in by hand.

| Source | What Jarvis sees | How often |
| --- | --- | --- |
| GitHub | Every commit and open PR across your repos. New repos become Jarvis projects automatically. | Every 30 min |
| Netlify | Every deploy on every site, including failures and their error messages | Every 30 min |
| Supabase | Every database and whether it is healthy or paused | Every 30 min |
| Claude Code (laptop) | Each session: which project, what you asked, what Claude finished with. Also Claude's memory notes on every project. | End of every Claude turn |

Jarvis uses all of this in four places:
- **Chat** answers "where is HopperTax at?" from real activity.
- **The morning briefing** includes what you shipped and what is broken.
- **Your phone** gets an instant push when a deploy fails, a database pauses, or a PR has been waiting 3+ days.
- **The Activity page** at `/jarvis/activity` shows the live feed.

---

## Setup: one command (about 3 minutes)

Run this in a terminal on the laptop:

```powershell
& "C:\Program Files\nodejs\node.exe" "C:\Users\Abiola Onikoyi\Downloads\abiola_onikoyi\scripts\connect-jarvis.mjs"
```

The script walks you through it. Your part:
1. **Netlify token.** It opens the page. Click **New access token**, name it `Jarvis`, copy it, paste it into the terminal.
2. **Supabase token.** It opens the page. Click **Generate new token**, name it `Jarvis`, copy it, paste it.
3. **GitHub.** Press **Enter** to reuse the GitHub login already on this laptop. Or paste a dedicated token from the link it shows.

Then it does the rest on its own:
- checks each token works;
- saves all three into Netlify;
- gives the laptop hook its secret and turns it on;
- redeploys the site and runs the first sync.

Tokens are hidden as you paste and stored only in Netlify. Re-run the script any time to replace a token.

After it finishes, restart any open Claude Code sessions so they pick up the hook.

<details>
<summary>Manual setup (only if the script fails)</summary>

1. Create tokens:
   - GitHub: https://github.com/settings/tokens/new?description=Jarvis&scopes=repo
   - Netlify: https://app.netlify.com/user/applications#personal-access-tokens
   - Supabase: https://supabase.com/dashboard/account/tokens
2. Add them in Netlify (Site configuration, then Environment variables) as `GITHUB_TOKEN`, `NETLIFY_TOKEN` and `SUPABASE_ACCESS_TOKEN`, then trigger a deploy.
3. Put `{"url": "https://abiolaonikoyi.com", "secret": "<CRON_SECRET>"}` in `C:\Users\Abiola Onikoyi\.claude\jarvis.json`.
4. In `C:\Users\Abiola Onikoyi\.claude\settings.json`, add a `Stop` hook that runs `"C:/Program Files/nodejs/node.exe" "C:/Users/Abiola Onikoyi/.claude/hooks/jarvis-sync.mjs"` with a timeout of 15.

</details>

## Optional: let Jarvis hand coding jobs to Claude (2 min per repo)

From your phone, you can ask Jarvis to build or fix something. Jarvis hands the job to Claude Code as a GitHub issue, Claude Code works on a branch and opens a PR, and Jarvis sees the PR when it lands.

For each repo you want this for:
1. Open a terminal in the repo.
2. Run `claude`, then type `/install-github-app`.
3. Follow the prompts.

After that you can say to Jarvis: *"Ask Claude to add a dark mode toggle to MamaPut's settings page."*

## Phone

1. Open https://abiolaonikoyi.com/jarvis on your phone.
2. Choose **Add to Home Screen**.
3. On the Overview page, tap the **notifications** toggle so alerts and the morning briefing reach you.
4. For hands-on coding from the phone, use Remote Control in the Claude mobile app.

## Fixing wrong matches

If Jarvis files a repo under the wrong project or creates a duplicate, tell it:

> link CordCraft/abiola_onikoyi to Personal site

It moves the activity across and deletes the empty duplicate.

## What still cannot sync

- **Ordinary claude.ai chats** (not Claude Code) have no API, so Jarvis cannot read them.
- **Claude Code cloud sessions** do not run your laptop hook. Their commits and PRs still reach Jarvis through GitHub.
