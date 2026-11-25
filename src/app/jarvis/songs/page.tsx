import { verifySession } from "@/lib/dal";
import { SongsPage } from "@/components/jarvis/Songs";

export const dynamic = "force-dynamic";

// Liked songs and their Suno packs, plus the one-time setup (YouTube Music
// cookie, Novale channel, style notes). The iPhone app shows the same data.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await verifySession();
  const q = await searchParams;
  return <SongsPage notice={q.yt_connected ? `Connected the YouTube channel ${q.yt_connected}.` : q.yt_error ? `YouTube did not connect: ${q.yt_error}` : null} />;
}
