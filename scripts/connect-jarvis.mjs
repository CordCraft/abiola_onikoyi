#!/usr/bin/env node
// One-time setup that connects Jarvis to GitHub, Netlify, Supabase and
// Claude Code. Run it yourself in a terminal:
//
//   node scripts/connect-jarvis.mjs
//
// Tokens are typed with hidden input, checked against each service, then
// stored ONLY in Netlify's environment variables (and the CRON secret in
// ~/.claude/jarvis.json). Nothing is printed or written anywhere else.
// Safe to re-run: every step overwrites cleanly.

import { createInterface } from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const SITE_ID = "2189b1c8-6fb8-4f01-b63a-7b3efab1c839"; // abiolaonikoyi
const ACCOUNT_ID = "678b8cae6223ca5c412336fa";
const SITE_URL = "https://abiolaonikoyi.com";
const CLAUDE = join(homedir(), ".claude");
const HERE = dirname(fileURLToPath(import.meta.url));

const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!!\x1b[0m ${m}`);
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

function open(url) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
  } catch {}
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (s.includes("\n") || s.includes("\r")) rl.output.write("\n");
        else rl.output.write("*");
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function check(url, token, label) {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "jarvis-setup", accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${label} rejected the token (${res.status})`);
  return res.json();
}

async function askToken(label, url, testUrl, { allowGhCli = false } = {}) {
  for (;;) {
    let token = await ask(
      allowGhCli ? `  Paste ${label} token (or press Enter to use your GitHub CLI login): ` : `  Paste ${label} token: `,
      { hidden: true },
    );
    if (!token && allowGhCli) {
      try {
        token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        warn("GitHub CLI is not signed in. Create a token on the page that opened instead.");
        open(url);
        continue;
      }
    }
    if (!token) continue;
    try {
      const who = await check(testUrl, token, label);
      ok(`${label} token works${who?.login ? ` (signed in as ${who.login})` : who?.email ? ` (${who.email})` : ""}`);
      return token;
    } catch (e) {
      warn(`${e.message}. Try again.`);
    }
  }
}

async function netlify(path, token, init = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Netlify ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function setEnv(token, key, value) {
  const body = { key, scopes: ["builds", "functions", "runtime"], values: [{ value, context: "all" }], is_secret: false };
  try {
    await netlify(`/accounts/${ACCOUNT_ID}/env?site_id=${SITE_ID}`, token, { method: "POST", body: JSON.stringify([body]) });
  } catch {
    // Already exists (possibly marked secret, which cannot be edited in place):
    // delete it and create it fresh.
    await netlify(`/accounts/${ACCOUNT_ID}/env/${key}?site_id=${SITE_ID}`, token, { method: "DELETE" });
    await netlify(`/accounts/${ACCOUNT_ID}/env?site_id=${SITE_ID}`, token, { method: "POST", body: JSON.stringify([body]) });
  }
}

// `--reset-secret`: replace CRON_SECRET with a fresh one in Netlify AND on this
// laptop in one go, so the hook and the scheduled jobs are guaranteed to match.
async function resetSecret() {
  console.log("\nResetting CRON_SECRET in Netlify and on this laptop.\n");
  step("Netlify token");
  console.log("  Paste the Netlify token you made earlier, or make a new one on the page that opens.");
  open("https://app.netlify.com/user/applications#personal-access-tokens");
  const netlifyToken = await askToken("Netlify", "https://app.netlify.com/user/applications#personal-access-tokens", "https://api.netlify.com/api/v1/user");
  const cronSecret = randomBytes(32).toString("hex");
  await setEnv(netlifyToken, "CRON_SECRET", cronSecret);
  ok("New CRON_SECRET saved in Netlify");
  writeFileSync(join(CLAUDE, "jarvis.json"), JSON.stringify({ url: SITE_URL, secret: cronSecret }, null, 2) + "\n");
  ok("Same secret saved in ~/.claude/jarvis.json");
  await redeployAndSync(netlifyToken, cronSecret);
}

async function main() {
  if (process.argv.includes("--reset-secret")) return resetSecret();
  console.log("\nConnecting Jarvis to GitHub, Netlify, Supabase and Claude Code.");
  console.log("Tokens are hidden as you paste them and only stored in Netlify.\n");

  step("1/6  Netlify token");
  console.log("  A Netlify page is opening. Click 'New access token', name it Jarvis, copy it.");
  open("https://app.netlify.com/user/applications#personal-access-tokens");
  const netlifyToken = await askToken("Netlify", "https://app.netlify.com/user/applications#personal-access-tokens", "https://api.netlify.com/api/v1/user");

  step("2/6  Supabase token");
  console.log("  A Supabase page is opening. Click 'Generate new token', name it Jarvis, copy it.");
  open("https://supabase.com/dashboard/account/tokens");
  const supabaseToken = await askToken("Supabase", "https://supabase.com/dashboard/account/tokens", "https://api.supabase.com/v1/projects");

  step("3/6  GitHub token");
  console.log("  Easiest: press Enter to reuse the GitHub login already on this laptop.");
  console.log("  (Or create a dedicated one: https://github.com/settings/tokens/new?description=Jarvis&scopes=repo )");
  const githubToken = await askToken("GitHub", "https://github.com/settings/tokens/new?description=Jarvis&scopes=repo", "https://api.github.com/user", { allowGhCli: true });

  step("4/6  Saving tokens to Netlify");
  await setEnv(netlifyToken, "NETLIFY_TOKEN", netlifyToken);
  ok("NETLIFY_TOKEN");
  await setEnv(netlifyToken, "SUPABASE_ACCESS_TOKEN", supabaseToken);
  ok("SUPABASE_ACCESS_TOKEN");
  await setEnv(netlifyToken, "GITHUB_TOKEN", githubToken);
  ok("GITHUB_TOKEN");

  step("5/6  Connecting Claude Code on this laptop");
  // CRON_SECRET guards every scheduled job and the laptop hook. If Netlify has
  // none, create a strong one (this also revives the briefing and nudges).
  let cronSecret = null;
  let exists = false;
  try {
    const env = await netlify(`/accounts/${ACCOUNT_ID}/env/CRON_SECRET?site_id=${SITE_ID}`, netlifyToken);
    exists = true;
    const vals = env?.values ?? [];
    cronSecret = (vals.find((v) => v.context === "production") ?? vals.find((v) => v.context === "all") ?? vals[0])?.value ?? null;
  } catch {}
  if (!exists) {
    cronSecret = randomBytes(32).toString("hex");
    await setEnv(netlifyToken, "CRON_SECRET", cronSecret);
    ok("CRON_SECRET was missing in Netlify; created a new one (scheduled jobs will work again)");
  }
  if (!cronSecret) {
    warn("Could not read CRON_SECRET from Netlify (it may be marked secret).");
    open(`https://app.netlify.com/projects/abiolaonikoyi/configuration/env#CRON_SECRET`);
    cronSecret = await ask("  Paste the CRON_SECRET value from the page that opened: ", { hidden: true });
  }
  mkdirSync(join(CLAUDE, "hooks"), { recursive: true });
  writeFileSync(join(CLAUDE, "jarvis.json"), JSON.stringify({ url: SITE_URL, secret: cronSecret }, null, 2) + "\n");
  ok("Saved ~/.claude/jarvis.json");

  const hookSrc = join(HERE, "jarvis-sync-hook.mjs");
  const hookDst = join(CLAUDE, "hooks", "jarvis-sync.mjs");
  if (existsSync(hookSrc)) copyFileSync(hookSrc, hookDst);
  ok("Installed hook script");

  const settingsPath = join(CLAUDE, "settings.json");
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {}
  const command = `"${process.execPath.replace(/\\/g, "/")}" "${hookDst.replace(/\\/g, "/")}"`;
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  const already = JSON.stringify(settings.hooks.Stop).includes("jarvis-sync.mjs");
  if (!already) settings.hooks.Stop.push({ hooks: [{ type: "command", command, timeout: 15 }] });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  ok(already ? "Claude Code hook was already on" : "Turned on the Claude Code hook (~/.claude/settings.json)");

  await redeployAndSync(netlifyToken, cronSecret);
}

async function redeployAndSync(netlifyToken, cronSecret) {
  step("Redeploying the site so it picks up the changes");
  const build = await netlify(`/sites/${SITE_ID}/builds`, netlifyToken, { method: "POST", body: "{}" });
  ok("Build started. Waiting for it to go live (usually 2 to 4 minutes)...");
  const started = Date.now();
  let state = "";
  while (Date.now() - started < 10 * 60_000) {
    await new Promise((r) => setTimeout(r, 15_000));
    try {
      const d = await netlify(`/deploys/${build.deploy_id}`, netlifyToken);
      if (d.state !== state) {
        state = d.state;
        console.log(`  ... ${state}`);
      }
      if (state === "ready" || state === "error") break;
    } catch {}
  }
  if (state !== "ready") {
    warn(`Deploy ended as "${state || "unknown"}". Check Netlify, then press Sync now on ${SITE_URL}/jarvis/activity`);
    return;
  }

  const res = await fetch(`${SITE_URL}/api/cron/sync-sources`, { method: "POST", headers: { "x-cron-secret": cronSecret } });
  const out = await res.json().catch(() => null);
  if (out?.results) {
    for (const r of out.results) {
      if (r.error) warn(`${r.source}: ${r.error}`);
      else if (r.skipped) warn(`${r.source}: ${r.skipped}`);
      else ok(`${r.source}: ${r.added ?? 0} new items from ${r.scanned ?? 0} sources`);
    }
  } else {
    warn(`First sync returned ${res.status}. Press Sync now on ${SITE_URL}/jarvis/activity`);
  }

  console.log(`\nDone. Jarvis now updates itself. Open ${SITE_URL}/jarvis/activity`);
  console.log("Restart any open Claude Code sessions so they pick up the new hook.\n");
}

main().catch((e) => {
  console.error(`\nSetup stopped: ${e.message}`);
  process.exit(1);
});
