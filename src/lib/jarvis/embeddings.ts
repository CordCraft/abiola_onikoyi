import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// Semantic memory via Voyage AI embeddings (Anthropic's partner) + pgvector.
// Every function no-ops gracefully when VOYAGE_API_KEY is not configured, so
// the app works fully (keyword search only) until the key is added.

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5";
const DIMS = 1024;
const CHUNK_CHARS = 1500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_DOC = 60;

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: texts, input_type: inputType, output_dimension: DIMS }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`voyage: embeddings request failed (${res.status})`, (await res.text()).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    const out: number[][] = new Array(texts.length);
    for (const d of json.data) out[d.index] = d.embedding;
    return out;
  } catch (e) {
    console.error("voyage: embeddings request threw", e);
    return null;
  }
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    chunks.push(clean.slice(start, start + CHUNK_CHARS));
    start += CHUNK_CHARS - CHUNK_OVERLAP;
  }
  return chunks;
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

// Index (or re-index) one record's text. Safe to call fire-and-forget.
export async function indexRecord(
  kind: "document" | "note",
  recordId: string,
  text: string,
  title = "",
): Promise<void> {
  if (!embeddingsEnabled()) return;
  const chunks = chunkText(title ? `${title}\n${text}` : text);
  if (!chunks.length) return;
  const vectors = await embed(chunks, "document");
  if (!vectors) return;
  try {
    await prisma.$executeRaw`DELETE FROM jarvis_embedding WHERE kind = ${kind} AND record_id = ${recordId}`;
    for (let i = 0; i < chunks.length; i++) {
      if (!vectors[i]) continue;
      await prisma.$executeRaw`
        INSERT INTO jarvis_embedding (kind, record_id, chunk, content, embedding)
        VALUES (${kind}, ${recordId}, ${i}, ${chunks[i]}, ${toVectorLiteral(vectors[i])}::vector)
        ON CONFLICT (kind, record_id, chunk) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding`;
    }
  } catch (e) {
    console.error("embeddings: index write failed", e);
  }
}

export async function removeFromIndex(kind: "document" | "note", recordId: string): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM jarvis_embedding WHERE kind = ${kind} AND record_id = ${recordId}`;
  } catch {
    // table may not exist yet; fine
  }
}

export type SemanticHit = {
  kind: string;
  recordId: string;
  content: string;
  similarity: number;
};

// Nearest chunks by cosine similarity, deduped per record (best chunk wins).
export async function semanticSearch(
  query: string,
  kinds: ("document" | "note")[],
  limit = 8,
): Promise<SemanticHit[]> {
  if (!embeddingsEnabled()) return [];
  const vectors = await embed([query.slice(0, 4000)], "query");
  const qv = vectors?.[0];
  if (!qv) return [];
  try {
    const rows = await prisma.$queryRaw<
      { kind: string; record_id: string; content: string; similarity: number }[]
    >`
      SELECT DISTINCT ON (kind, record_id)
        kind, record_id, content,
        1 - (embedding <=> ${toVectorLiteral(qv)}::vector) AS similarity
      FROM jarvis_embedding
      WHERE kind IN (${Prisma.join(kinds)})
      ORDER BY kind, record_id, embedding <=> ${toVectorLiteral(qv)}::vector
      LIMIT 60`;
    return rows
      .map((r) => ({ kind: r.kind, recordId: r.record_id, content: r.content, similarity: Number(r.similarity) }))
      .filter((r) => r.similarity > 0.35)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch (e) {
    console.error("embeddings: search failed", e);
    return [];
  }
}

// Index anything not yet embedded (new records whose inline embed failed, or
// the whole backlog right after the key is first configured). Batched.
export async function embedBacklog(batch = 20): Promise<{ documents: number; notes: number } | { skipped: string }> {
  if (!embeddingsEnabled()) return { skipped: "VOYAGE_API_KEY not configured" };

  const docs = await prisma.$queryRaw<{ id: string; name: string; content: string }[]>`
    SELECT d.id, d.name, d.content FROM "JarvisDocument" d
    WHERE NOT EXISTS (SELECT 1 FROM jarvis_embedding e WHERE e.kind = 'document' AND e.record_id = d.id)
    ORDER BY d."createdAt" DESC LIMIT ${batch}`;
  for (const d of docs) {
    await indexRecord("document", d.id, d.content.slice(0, CHUNK_CHARS * MAX_CHUNKS_PER_DOC), d.name);
  }

  const notes = await prisma.$queryRaw<{ id: string; body: string }[]>`
    SELECT n.id, n.body FROM "JarvisNote" n
    WHERE NOT EXISTS (SELECT 1 FROM jarvis_embedding e WHERE e.kind = 'note' AND e.record_id = n.id)
    ORDER BY n."createdAt" DESC LIMIT ${batch}`;
  for (const n of notes) {
    await indexRecord("note", n.id, n.body);
  }

  return { documents: docs.length, notes: notes.length };
}
