import { getStore } from "@netlify/blobs";
import { prisma } from "@/lib/prisma";
import {
  FILE_STORE,
  MAX_FILES,
  MAX_FILE_BYTES,
  asResult,
  authMachine,
  cleanFileName,
  json,
  ownedJob,
  toJson,
  unauthorized,
} from "../../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { name, contentType?, contentBase64 } stores one deliverable in Netlify
// Blobs (store "jarvis-files", key jobs/<jobId>/<name>) and lists it in
// result.files. Max 4MB each, 10 per task (Netlify caps bodies near 6MB).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const machine = await authMachine(req);
  if (!machine) return unauthorized();
  const { id } = await ctx.params;
  const job = await ownedJob(machine, id);
  if (!job) return json({ ok: false, error: "Not found" }, 404);

  let body: { name?: unknown; contentType?: unknown; contentBase64?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON" }, 400);
  }
  const name = cleanFileName(String(body.name || ""));
  const b64 = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
  if (!b64) return json({ ok: false, error: "contentBase64 required" }, 400);
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > MAX_FILE_BYTES) return json({ ok: false, error: "File over 4MB" }, 413);

  const result = asResult(job.result);
  const files = (result.files ?? []).filter((f) => f.name !== name);
  if (files.length >= MAX_FILES) return json({ ok: false, error: "Too many files" }, 400);

  const key = `jobs/${id}/${name}`;
  const contentType =
    typeof body.contentType === "string" ? body.contentType.slice(0, 100) : "application/octet-stream";
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await getStore(FILE_STORE).set(key, ab, { metadata: { name, contentType } });
  files.push({ name, size: bytes.length, key, contentType });
  await prisma.jarvisJob.update({ where: { id }, data: { result: toJson({ ...result, files }) } });
  return json({ ok: true, key });
}
