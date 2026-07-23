import { NextResponse, type NextRequest } from "next/server";
import { deleteMenteeSession } from "@/lib/mentorship/session";

// Clears the mentee session cookie and lands on the login page. A route
// handler (not a Server Action) so verifyMentee can redirect here from a page
// render, where cookie mutation is not allowed.
export async function GET(req: NextRequest) {
  await deleteMenteeSession();
  return NextResponse.redirect(new URL("/mentorship/login", req.nextUrl));
}
