#!/usr/bin/env node
// Claude Code -> Jarvis bridge. Runs as a Claude Code "Stop" hook: after every
// Claude turn it tells Jarvis which project you are in, what you asked, and
// what Claude finished with, plus any changed Claude memory files.
//
// Install: copy to ~/.claude/hooks/jarvis-sync.mjs, create ~/.claude/jarvis.json
//   { "url": "https://abiolaonikoyi.com", "secret": "<CRON_SECRET from Netlify>" }
// and register it under hooks.Stop in ~/.claude/settings.json.
// Never blocks or breaks Claude: every failure exits 0 silently.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const HOME = join(homedir(), ".claude");
const CONFIG = join(HOME, "jarvis.json");
const CACHE = join(HOME, "jarvis-sync-cache.json");

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// First real user prompt and Claude's final words, from the transcript.
function summarise(transcriptPath) {
  let firstPrompt = null;
  let lastMessage = null;
  try {
    const lines = readFileSync(transcriptPath, "utf8").split("\n");
    for (const line of lines) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = e.message;
      if (!msg) continue;
      if (e.type === "user" && !firstPrompt && !e.isMeta) {
        const t = textOf(msg.content).trim();
        if (t && !t.startsWith("<")) firstPrompt = t.slice(0, 600);
      }
      if (e.type === "assistant") {
        const t = textOf(msg.content).trim();
        if (t) lastMessage = t;
      }
    }
  } catch {}
  return { firstPrompt, lastMessage: lastMessage ? lastMessage.slice(-3000) : null };
}

// Claude's memory files (~/.claude/projects/*/memory/*.md) that changed.
function changedMemory(cache) {
  const out = [];
  const seen = {};
  const projects = join(HOME, "projects");
  if (!existsSync(projects)) return { out, seen };
  for (const dir of readdirSync(projects)) {
    const mem = join(projects, dir, "memory");
    if (!existsSync(mem) || !statSync(mem).isDirectory()) continue;
    for (const f of readdirSync(mem)) {
      if (!f.endsWith(".md")) continue;
      const content = readFileSync(join(mem, f), "utf8");
      const hash = createHash("sha1").update(content).digest("hex");
      const key = `${dir}/${f}`;
      seen[key] = hash;
      if (cache.memory?.[key] !== hash) out.push({ name: f.replace(/\.md$/, ""), content, key });
    }
  }
  return { out, seen };
}

async function main() {
  const config = readJson(CONFIG, null);
  const url = config?.url || process.env.JARVIS_URL;
  const secret = config?.secret || process.env.JARVIS_SECRET;
  if (!url || !secret) return;

  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, "").trim() || "{}");
  } catch {}
  const cwd = input.cwd || process.cwd();

  const cache = readJson(CACHE, {});
  const { out: memory, seen } = changedMemory(cache);
  const { firstPrompt, lastMessage } = input.transcript_path ? summarise(input.transcript_path) : {};

  const body = {
    sessionId: input.session_id,
    cwd,
    gitRemote: git(cwd, ["remote", "get-url", "origin"]),
    branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    firstPrompt,
    lastMessage,
    at: new Date().toISOString(),
    memory: memory.slice(0, 60).map(({ name, content }) => ({ name, content })),
  };

  const res = await fetch(`${url.replace(/\/$/, "")}/api/jarvis-ingest/claude`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-capture-secret": secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) {
    // Only remember memory hashes once Jarvis has them.
    writeFileSync(CACHE, JSON.stringify({ ...cache, memory: seen, lastOk: body.at }, null, 2));
  } else {
    writeFileSync(CACHE, JSON.stringify({ ...cache, lastError: `${res.status} at ${body.at}` }, null, 2));
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
