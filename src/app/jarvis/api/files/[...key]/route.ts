import { getStore } from "@netlify/blobs";
import { getSession } from "@/lib/session";
import { FILE_STORE } from "@/app/api/jarvis-bridge/lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Session-protected download of a task deliverable from Netlify Blobs.
// GET /jarvis/api/files/jobs/<jobId>/<filename>
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const session = await getSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { key: parts } = await ctx.params;
  const key = parts.map((p) => decodeURIComponent(p)).join("/");
  if (!key.startsWith("jobs/") || key.includes("..") || key.length > 300) {
    return new Response("Not found", { status: 404 });
  }
  const store = getStore(FILE_STORE);
  const entry = await store.getWithMetadata(key, { type: "arrayBuffer" });
  if (!entry) return new Response("Not found", { status: 404 });

  const meta = (entry.metadata ?? {}) as { name?: string; contentType?: string };
  const name = (meta.name || key.split("/").pop() || "file").replace(/[^\w.\- ()]/g, "_");
  return new Response(entry.data, {
    headers: {
      "content-type": meta.contentType || "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
