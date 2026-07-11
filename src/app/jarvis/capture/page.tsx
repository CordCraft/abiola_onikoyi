import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Android share-sheet target (declared in the web manifest). Sharing text, a
// link, or a page title from any app lands here and becomes an inbox capture.
export default async function ShareCapturePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; text?: string; url?: string }>;
}) {
  await verifySession();
  const { title, text, url } = await searchParams;
  const body = [title, text, url]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n");

  if (body) {
    await prisma.jarvisNote.create({
      data: { body: body.slice(0, 4000), source: "capture" },
    });
  }
  redirect("/jarvis");
}
