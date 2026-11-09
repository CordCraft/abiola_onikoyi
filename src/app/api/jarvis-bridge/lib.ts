import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";

// Shared helpers for the /api/jarvis-bridge/* machine routes. These live under
// /api/* on purpose (outside the proxy matcher) and authenticate with
// x-machine-id + x-machine-secret headers.

export const FILE_STORE = "jarvis-files";
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 10;
export const PAIRING_KEY = "bridge_pairing";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export type Machine = NonNullable<Awaited<ReturnType<typeof prisma.jarvisMachine.findUnique>>>;

// Returns the machine when the headers are valid, else null.
export async function authMachine(req: Request): Promise<Machine | null> {
  const id = req.headers.get("x-machine-id") || "";
  const secret = req.headers.get("x-machine-secret") || "";
  if (!id || !secret || id.length > 64 || secret.length > 200) return null;
  await ensureV2Tables();
  const m = await prisma.jarvisMachine.findUnique({ where: { id } });
  if (!m) {
    safeEqualHex(sha256(secret), sha256("x")); // keep timing similar for unknown ids
    return null;
  }
  return safeEqualHex(sha256(secret), m.secretHash) ? m : null;
}

export const unauthorized = () => json({ ok: false, error: "Unauthorized" }, 401);

export type JobResult = {
  progress?: string[];
  files?: { name: string; size: number; key: string; contentType: string }[];
  text?: string;
  costUsd?: number | null;
  sessionId?: string | null;
  exitCode?: number | null;
  [k: string]: unknown;
};

export function asResult(v: Prisma.JsonValue | null | undefined): JobResult {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JobResult) : {};
}

export function toJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

// Loads a job and checks it belongs to this machine.
export async function ownedJob(machine: Machine, id: string) {
  const job = await prisma.jarvisJob.findUnique({ where: { id } });
  if (!job || job.kind !== "machine_task" || job.target !== `machine:${machine.id}`) return null;
  return job;
}

export function cleanFileName(name: string): string {
  const base = name.replace(/[\\/]+/g, "__").replace(/[^\w.\- ()]+/g, "_").replace(/^\.+/, "");
  return (base || "file").slice(0, 120);
}

// Pairing codes: 8 chars, single use, 15 minutes, stored hashed.
type PairingEntry = { hash: string; expiresAt: number };
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

async function readPairing(): Promise<PairingEntry[]> {
  const row = await prisma.jarvisSetting.findUnique({ where: { key: PAIRING_KEY } });
  try {
    const arr = JSON.parse(row?.value || "[]") as PairingEntry[];
    return arr.filter((e) => e && typeof e.hash === "string" && e.expiresAt > Date.now());
  } catch {
    return [];
  }
}

async function writePairing(entries: PairingEntry[]) {
  const value = JSON.stringify(entries);
  await prisma.jarvisSetting.upsert({
    where: { key: PAIRING_KEY },
    create: { key: PAIRING_KEY, value },
    update: { value },
  });
}

const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function createPairingCode(): Promise<{ code: string; expiresAt: number }> {
  await ensureV2Tables();
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  const expiresAt = Date.now() + 15 * 60_000;
  const entries = (await readPairing()).slice(-9);
  entries.push({ hash: sha256(code), expiresAt });
  await writePairing(entries);
  return { code, expiresAt };
}

// Consumes a code if valid. True once; the code is gone afterwards.
export async function consumePairingCode(code: string): Promise<boolean> {
  const hash = sha256(normCode(code));
  const entries = await readPairing();
  const idx = entries.findIndex((e) => safeEqualHex(e.hash, hash));
  if (idx === -1) return false;
  entries.splice(idx, 1);
  await writePairing(entries);
  return true;
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}
