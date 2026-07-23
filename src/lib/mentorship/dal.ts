import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMenteeSession } from "@/lib/mentorship/session";
import type { MentorshipMentee } from "@prisma/client";

// Verifies the mentee session AND that the mentee still exists and is active,
// redirecting to the mentee login otherwise. Call at the top of every portal
// page and every mentee Server Action. Wrapped in React cache so repeated
// calls within one request hit the database once.
// Cookies cannot be mutated during a page render, so stale sessions are sent
// through /mentorship/logout (a route handler), which clears the cookie and
// lands on the login page without a redirect loop.
export const verifyMentee = cache(async (): Promise<MentorshipMentee> => {
  const session = await getMenteeSession();
  if (!session?.menteeId) {
    redirect("/mentorship/login");
  }
  const mentee = await prisma.mentorshipMentee.findUnique({
    where: { id: session.menteeId },
  });
  if (!mentee || !mentee.active) {
    redirect("/mentorship/logout");
  }
  return mentee;
});
