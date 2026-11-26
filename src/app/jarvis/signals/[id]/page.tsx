import { redirect } from "next/navigation";

// Signals now live on the item page (card plus its own chat).
export default async function SignalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/jarvis/items/signal-${id}`);
}
