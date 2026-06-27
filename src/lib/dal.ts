import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// Verifies the session and redirects to /login if absent. Call this at the top
// of every protected page and every admin Server Action. It is the real
// authorization boundary (the proxy is only an optimistic first check).
// Wrapped in React `cache` so repeated calls within one request are cheap.
export const verifySession = cache(async (): Promise<{ user: string }> => {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }
  return { user: session.user };
});
