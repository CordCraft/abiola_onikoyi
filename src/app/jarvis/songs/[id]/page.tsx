import { verifySession } from "@/lib/dal";
import { SongDetail } from "@/components/jarvis/Songs";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  return <SongDetail id={(await params).id} />;
}
