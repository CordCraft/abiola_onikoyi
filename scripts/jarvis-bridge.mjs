#!/usr/bin/env node
// Jarvis bridge agent. Lets Jarvis (your phone) see this computer and give it
// work. Plain Node 20+, zero dependencies.
//
//   node jarvis-bridge.mjs pair <PAIRING_CODE> --name "Kuwait office"
//   node jarvis-bridge.mjs run            (loop: heartbeat + job polling)
//   node jarvis-bridge.mjs run --dry-run  (print the heartbeat payload, send nothing)
//   node jarvis-bridge.mjs status         (show saved config, no secrets)
//
// Config: ~/.claude/jarvis-bridge.json  { url, machineId, secret, name, roots }
// Setup guide: docs/JARVIS-BRIDGE.md

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  unlinkSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, sep, basename } from "node:path";
import { homedir, hostname, platform, release, uptime, arch } from "node:os";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const CONFIG_PATH = join(CLAUDE_DIR, "jarvis-bridge.json");
const SYNC_CONFIG_PATH = join(CLAUDE_DIR, "jarvis.json");
const LOCK_PATH = join(CLAUDE_DIR, "jarvis-bridge.lock");
const IS_WIN = platform() === "win32";

const HEARTBEAT_MS = 30_000;
const POLL_MS = 10_000;
const PROGRESS_MS = 15_000;
const REPO_SCAN_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MIN = 20;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_OUTPUT_CHARS = 100_000;

// ---------------------------------------------------------------- utilities

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

export function parseArgs(argv) {
  const out = { _: [], flags: {}, multi: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      let key = eq > -1 ? a.slice(2, eq) : a.slice(2);
      let val;
      if (eq > -1) val = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) val = argv[++i];
      else val = true;
      out.flags[key] = val;
      (out.multi[key] ||= []).push(val);
    } else out._.push(a);
  }
  return out;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch {
    return fallback;
  }
}

function defaultUrl() {
  const sync = readJson(SYNC_CONFIG_PATH, null);
  return (sync?.url || "https://abiolaonikoyi.com").replace(/\/$/, "");
}

function defaultRoots() {
  return [join(HOME, "Downloads"), join(HOME, "Documents")];
}

function loadConfig() {
  const c = readJson(CONFIG_PATH, null);
  if (!c) return null;
  return { ...c, roots: Array.isArray(c.roots) && c.roots.length ? c.roots : defaultRoots() };
}

function run(cmd, args, { cwd, timeout = 5000 } = {}) {
  return new Promise((resolveP) => {
    execFile(
      cmd,
      args,
      { cwd, timeout, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolveP(err ? null : String(stdout).trim()),
    );
  });
}

function runShell(cmdline, timeout = 8000) {
  // Fixed command lines only (no user input), shell needed for claude.cmd on Windows.
  return new Promise((resolveP) => {
    execFile(cmdline, [], { shell: true, timeout, encoding: "utf8", windowsHide: true }, (err, stdout) =>
      resolveP(err ? null : String(stdout).trim()),
    );
  });
}

// ------------------------------------------------------------ path safety

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function safeReal(p) {
  try {
    return realpathSync(resolve(p));
  } catch {
    return null;
  }
}

// A job folder must be inside a configured root or inside a known repo.
export function folderAllowed(folder, roots, knownRepos = []) {
  const real = safeReal(folder);
  if (!real) return null;
  try {
    if (!statSync(real).isDirectory()) return null;
  } catch {
    return null;
  }
  const allowed = [...roots, ...knownRepos].map(safeReal).filter(Boolean);
  return allowed.some((a) => isInside(a, real)) ? real : null;
}

// ----------------------------------------------------------- repo scanning

const SKIP_DIRS = new Set([
  "node_modules",
  "appdata",
  "application data",
  "$recycle.bin",
  "onedrive",
  "my documents",
  "downloads",
  "documents",
]);

function listChildDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

export function findRepoPaths(roots) {
  const found = new Set();
  const consider = (dir) => {
    if (existsSync(join(dir, ".git"))) found.add(dir);
  };
  for (const root of roots) {
    consider(root);
    for (const child of listChildDirs(root)) {
      const name = basename(child).toLowerCase();
      // For a home-directory root, skip system and cloud-sync folders.
      if (resolve(root) === resolve(HOME) && SKIP_DIRS.has(name)) continue;
      consider(child);
    }
  }
  return [...found];
}

async function repoInfo(dir) {
  const [branch, status, last] = await Promise.all([
    run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]),
    run("git", ["-C", dir, "status", "--porcelain"], { timeout: 8000 }),
    run("git", ["-C", dir, "log", "-1", "--format=%h%x09%cI%x09%s"]),
  ]);
  const [hash, date, ...subject] = (last || "").split("\t");
  return {
    name: basename(dir),
    path: dir,
    branch: branch || null,
    dirty: status === null ? null : status.length > 0,
    changed: status ? status.split("\n").length : 0,
    lastCommit: last ? { hash, date, subject: subject.join("\t").slice(0, 120) } : null,
  };
}

async function scanRepos(roots) {
  const paths = findRepoPaths([...roots, HOME]).slice(0, 60);
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < paths.length) {
      const p = paths[i++];
      out.push(await repoInfo(p));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out.sort((a, b) => (b.lastCommit?.date || "").localeCompare(a.lastCommit?.date || ""));
}

// ----------------------------------------------------- Claude session scan

function readHead(path, bytes = 96 * 1024) {
  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
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

export function recentSessions(limit = 10) {
  const projects = join(CLAUDE_DIR, "projects");
  if (!existsSync(projects)) return [];
  const files = [];
  for (const dir of readdirSync(projects)) {
    const full = join(projects, dir);
    let entries;
    try {
      if (!statSync(full).isDirectory()) continue;
      entries = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const p = join(full, f);
        files.push({ p, dir, id: f.replace(/\.jsonl$/, ""), mtime: statSync(p).mtimeMs });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit).map((f) => {
    let cwd = null;
    let prompt = null;
    for (const line of readHead(f.p).split("\n")) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (!cwd && typeof e.cwd === "string") cwd = e.cwd;
      if (!prompt && e.type === "user" && !e.isMeta && e.message) {
        const t = textOf(e.message.content).trim();
        if (t && !t.startsWith("<")) prompt = t.replace(/\s+/g, " ").slice(0, 160);
      }
      if (cwd && prompt) break;
    }
    return {
      id: f.id,
      folder: cwd || f.dir,
      lastModified: new Date(f.mtime).toISOString(),
      prompt,
    };
  });
}

// --------------------------------------------------------------- heartbeat

let repoCache = { at: 0, repos: [] };
let claudeVersion = null;
let claudeBin = "claude";

// Find the claude CLI: config.claudePath, PATH, then the usual install spots.
async function resolveClaude(cfg) {
  const candidates = [cfg.claudePath, "claude"];
  const appData = process.env.APPDATA || join(HOME, "AppData", "Roaming");
  const local = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");
  candidates.push(
    join(HOME, ".claude", "local", IS_WIN ? "claude.exe" : "claude"),
    join(HOME, ".local", "bin", IS_WIN ? "claude.exe" : "claude"),
    join(local, "Programs", "claude", "claude.exe"),
  );
  try {
    const base = join(appData, "Claude", "claude-code");
    for (const v of readdirSync(base).sort().reverse()) candidates.push(join(base, v, "claude.exe"));
  } catch {}
  for (const c of candidates.filter(Boolean)) {
    if (c !== "claude" && !existsSync(c)) continue;
    const v = await runShell(`${c.includes(" ") ? `"${c}"` : c} --version`);
    if (v) {
      claudeBin = c.includes(" ") ? `"${c}"` : c;
      return v;
    }
  }
  return null;
}

async function buildHeartbeat(cfg, busyJobId) {
  if (Date.now() - repoCache.at > REPO_SCAN_MS) {
    repoCache = { at: Date.now(), repos: await scanRepos(cfg.roots) };
  }
  if (!claudeVersion || claudeVersion === "not found") claudeVersion = (await resolveClaude(cfg)) || "not found";
  return {
    name: cfg.name,
    hostname: hostname(),
    os: `${platform()} ${release()} ${arch()}`,
    uptimeSec: Math.round(uptime()),
    claudeVersion,
    bridgeVersion: 1,
    roots: cfg.roots,
    busyJobId: busyJobId || null,
    repos: repoCache.repos,
    sessions: recentSessions(10),
    at: new Date().toISOString(),
  };
}

// --------------------------------------------------------------------- API

class Api {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = cfg.url.replace(/\/$/, "");
  }
  async call(method, path, body, timeoutMs = 20_000) {
    const res = await fetch(`${this.base}/api/jarvis-bridge/${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-machine-id": this.cfg.machineId,
        "x-machine-secret": this.cfg.secret,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status} ${json?.error || text.slice(0, 120)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }
}

// ------------------------------------------------------------- job running

function killTree(child) {
  try {
    if (IS_WIN) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else child.kill("SIGKILL");
  } catch {}
}

function describeToolUse(block) {
  const i = block.input || {};
  const target = i.file_path || i.path || i.pattern || i.command || i.url || i.query || "";
  return `${block.name}${target ? `: ${String(target).replace(/\s+/g, " ").slice(0, 100)}` : ""}`;
}

const WRAPPER = (prompt, mode) =>
  [
    "You were started remotely from the owner's phone through Jarvis. Nobody can answer questions, so do not ask any; make reasonable assumptions and say what you assumed.",
    mode === "plan"
      ? "You are in read-only mode: you cannot edit or create files. Investigate and put the full deliverable in your final answer."
      : "If you produce files the owner should receive (reports, documents, exports, screenshots), save them in a folder named jarvis-out inside the current folder (max 10 files, 4MB each).",
    "Finish with a clear, concise summary of what you found or did, formatted in Markdown, readable on a phone. Never use em dashes.",
    "",
    "TASK:",
    prompt,
  ].join("\n");

function collectOutputFiles(folder, sinceMs) {
  const dir = join(folder, "jarvis-out");
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d, depth) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 2) walk(p, depth + 1);
      } else if (e.isFile()) {
        try {
          const st = statSync(p);
          if (st.mtimeMs >= sinceMs - 2000) out.push({ path: p, size: st.size, name: relative(dir, p).split(sep).join("__") });
        } catch {}
      }
    }
  };
  walk(dir, 0);
  return out;
}

const MIME = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

async function runJob(api, cfg, job) {
  const p = job.payload || {};
  const mode = p.permissionMode === "acceptEdits" ? "acceptEdits" : "plan";
  const timeoutMin = Math.min(Math.max(Number(p.timeoutMin) || DEFAULT_TIMEOUT_MIN, 1), 120);
  const prompt = String(p.prompt || "").slice(0, 20_000);
  const startedAt = Date.now();

  const fail = async (message) => {
    log("job", job.id, "failed:", message);
    await api
      .call("POST", `jobs/${job.id}/result`, { text: message, exitCode: 1, error: message })
      .catch((e) => log("result post failed", e.message));
  };

  if (!prompt.trim()) return fail("Empty prompt.");
  const known = repoCache.repos.map((r) => r.path);
  const folder = folderAllowed(p.folder || "", cfg.roots, known);
  if (!folder) return fail(`Folder not allowed or not found on this computer: ${p.folder}`);

  log("job", job.id, mode, folder);
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", mode];
  const child = spawn(claudeBin, args, {
    cwd: folder,
    shell: IS_WIN, // claude may be a .cmd shim on Windows; args are fixed, the prompt goes via stdin
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let spawnError = null;
  child.on("error", (e) => {
    spawnError = e;
  });
  try {
    child.stdin.on("error", () => {});
    child.stdin.end(WRAPPER(prompt, mode));
  } catch {}

  let buf = "";
  let raw = "";
  let resultEvent = null;
  let assistantText = "";
  let pending = [];
  let cancelled = false;
  let timedOut = false;
  let stderr = "";

  const onLine = (line) => {
    if (!line.trim()) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (e.type === "result") resultEvent = e;
    else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type === "tool_use") pending.push(describeToolUse(b));
        else if (b.type === "text" && b.text?.trim()) {
          assistantText = b.text;
          pending.push(`Claude: ${b.text.replace(/\s+/g, " ").slice(0, 140)}`);
        }
      }
    }
  };
  child.stdout.on("data", (d) => {
    const s = d.toString("utf8");
    if (raw.length < 2_000_000) raw += s;
    buf += s;
    let nl;
    while ((nl = buf.indexOf("\n")) > -1) {
      onLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  });
  child.stderr.on("data", (d) => {
    if (stderr.length < 8000) stderr += d.toString("utf8");
  });

  const exited = new Promise((r) => child.on("close", (code) => r(code)));

  const flush = async () => {
    const lines = pending.splice(0, 40);
    try {
      const r = await api.call("POST", `jobs/${job.id}/progress`, { lines });
      if (r?.cancel && !cancelled) {
        cancelled = true;
        killTree(child);
      }
    } catch (e) {
      pending.unshift(...lines);
      log("progress failed", e.message);
    }
  };
  const progressTimer = setInterval(flush, PROGRESS_MS);
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, timeoutMin * 60_000);

  const code = await exited;
  clearInterval(progressTimer);
  clearTimeout(timeoutTimer);
  if (buf.trim()) onLine(buf);

  let text = "";
  let costUsd;
  let sessionId;
  let exitCode = code ?? 1;
  if (resultEvent) {
    text = typeof resultEvent.result === "string" ? resultEvent.result : assistantText;
    costUsd = resultEvent.total_cost_usd ?? resultEvent.cost_usd;
    sessionId = resultEvent.session_id;
    if (resultEvent.is_error) exitCode = exitCode || 1;
  } else {
    text = assistantText || raw.slice(-4000) || stderr.slice(-2000);
  }
  if (spawnError) {
    text = `Could not start claude: ${spawnError.message}`;
    exitCode = 1;
  }
  if (timedOut) {
    text = `Timed out after ${timeoutMin} minutes.\n\n${text}`;
    exitCode = 124;
  }
  if (cancelled) {
    text = `Cancelled from Jarvis.\n\n${text}`;
    exitCode = 130;
  }
  if (!text.trim() && stderr.trim()) text = stderr.trim().slice(-2000);

  // Deliverables first (so the page shows them once the result lands).
  const uploaded = [];
  const skipped = [];
  if (mode === "acceptEdits") {
    const files = collectOutputFiles(folder, startedAt).slice(0, MAX_FILES + 5);
    for (const f of files) {
      if (uploaded.length >= MAX_FILES) {
        skipped.push(`${f.name} (over ${MAX_FILES} file limit)`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        skipped.push(`${f.name} (${(f.size / 1048576).toFixed(1)}MB, over 4MB)`);
        continue;
      }
      try {
        const ext = (f.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
        await api.call(
          "POST",
          `jobs/${job.id}/file`,
          {
            name: f.name,
            contentType: MIME[ext] || "application/octet-stream",
            contentBase64: readFileSync(f.path).toString("base64"),
          },
          60_000,
        );
        uploaded.push(f.name);
      } catch (e) {
        skipped.push(`${f.name} (upload failed: ${e.message})`);
      }
    }
  }
  if (skipped.length) text += `\n\nFiles not delivered: ${skipped.join(", ")}`;

  await flush().catch(() => {});
  const body = {
    text: text.slice(0, MAX_OUTPUT_CHARS),
    costUsd,
    sessionId,
    exitCode,
    files: uploaded,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await api.call("POST", `jobs/${job.id}/result`, body);
      log("job", job.id, "finished exit", exitCode, "files", uploaded.length);
      return;
    } catch (e) {
      log("result post failed", e.message);
      await sleep(5000 * (attempt + 1));
    }
  }
}

// ---------------------------------------------------------------- the loop

function acquireLock() {
  try {
    mkdirSync(CLAUDE_DIR, { recursive: true });
  } catch {}
  if (existsSync(LOCK_PATH)) {
    const pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false; // alive
      } catch {
        // stale lock
      }
    }
  }
  writeFileSync(LOCK_PATH, String(process.pid));
  const release_ = () => {
    try {
      if (readFileSync(LOCK_PATH, "utf8").trim() === String(process.pid)) unlinkSync(LOCK_PATH);
    } catch {}
  };
  process.on("exit", release_);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
  return true;
}

async function loop(cfg) {
  if (!acquireLock()) {
    console.error("Another Jarvis bridge is already running. Exiting.");
    process.exit(0);
  }
  const api = new Api(cfg);
  let busyJobId = null;
  let failures = 0;
  let lastHeartbeat = 0;
  log(`Jarvis bridge running as "${cfg.name}" against ${cfg.url}`);

  process.on("uncaughtException", (e) => log("uncaught", e?.message));
  process.on("unhandledRejection", (e) => log("unhandled", e?.message || e));

  while (true) {
    try {
      if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
        const hb = await buildHeartbeat(cfg, busyJobId);
        await api.call("POST", "heartbeat", hb);
        lastHeartbeat = Date.now();
      }
      if (!busyJobId) {
        const r = await api.call("GET", "jobs/next");
        if (r?.job) {
          busyJobId = r.job.id;
          runJob(api, cfg, r.job)
            .catch((e) => log("runJob crashed", e?.message))
            .finally(() => {
              busyJobId = null;
              lastHeartbeat = 0; // refresh state right after a job
            });
        }
      }
      failures = 0;
      await sleep(POLL_MS + Math.random() * 3000);
    } catch (e) {
      failures++;
      if (e.status === 401 || e.status === 403) {
        log("Unauthorized: this computer may have been removed in Jarvis. Re-pair if needed.");
      }
      const wait = Math.min(5000 * 2 ** Math.min(failures, 6), 5 * 60_000);
      log(`error (${failures}): ${e.message}; retry in ${Math.round(wait / 1000)}s`);
      await sleep(wait + Math.random() * 2000);
    }
  }
}

// ---------------------------------------------------------------------- CLI

async function pair(args) {
  const code = String(args._[1] || "").trim();
  if (!code) {
    console.error('Usage: node jarvis-bridge.mjs pair <PAIRING_CODE> --name "Kuwait office" [--url https://...]');
    process.exit(2);
  }
  const name = typeof args.flags.name === "string" ? args.flags.name.trim() : hostname();
  const url = (typeof args.flags.url === "string" ? args.flags.url : defaultUrl()).replace(/\/$/, "");
  const roots = args.multi.root?.filter((r) => typeof r === "string").map((r) => resolve(r)) ?? defaultRoots();
  const res = await fetch(`${url}/api/jarvis-bridge/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name, hostname: hostname(), os: `${platform()} ${release()}` }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.machineId) {
    console.error(`Pairing failed (${res.status}): ${json?.error || "unknown error"}`);
    process.exit(1);
  }
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ url, machineId: json.machineId, secret: json.secret, name: json.name || name, roots }, null, 2),
  );
  console.log(`Paired as "${json.name || name}". Config saved to ${CONFIG_PATH}`);
  console.log("Now run: node jarvis-bridge.mjs run   (or install the scheduled task).");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === "pair") return pair(args);

  if (cmd === "status") {
    const c = loadConfig();
    if (!c) return console.log("Not paired.");
    return console.log(JSON.stringify({ ...c, secret: "(hidden)" }, null, 2));
  }

  if (cmd === "run") {
    if (args.flags["dry-run"]) {
      const cfg = loadConfig() || {
        url: defaultUrl(),
        machineId: "(not paired)",
        name: typeof args.flags.name === "string" ? args.flags.name : hostname(),
        roots: defaultRoots(),
      };
      const hb = await buildHeartbeat(cfg, null);
      console.log(JSON.stringify(hb, null, 2));
      return;
    }
    const cfg = loadConfig();
    if (!cfg?.machineId || !cfg.secret) {
      console.error("Not paired yet. Run: node jarvis-bridge.mjs pair <CODE> --name \"My PC\"");
      process.exit(1);
    }
    return loop(cfg);
  }

  console.log(
    [
      "Jarvis bridge",
      '  pair <CODE> --name "Kuwait office" [--url URL] [--root DIR ...]',
      "  run [--dry-run]",
      "  status",
    ].join("\n"),
  );
}

// Only run the CLI when executed directly (keeps helpers importable for tests).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
