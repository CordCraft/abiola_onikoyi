import { NextResponse, type NextRequest } from "next/server";
import { decryptSession } from "@/lib/jwt";

// Next.js 16 renamed `middleware` to `proxy` (Node.js runtime). This performs an
// optimistic auth check: it reads the signed session cookie and redirects
// unauthenticated visitors away from /dashboard, and authenticated visitors
// away from /login. The authoritative check still happens in each page/action
// via verifySession() (see src/lib/dal.ts).
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // The PWA manifest must be fetchable by the browser's installer without a
  // session (iOS fetches it out-of-band when adding to the home screen).
  if (path === "/jarvis/manifest.webmanifest") {
    return NextResponse.next();
  }
  const isProtected =
    path === "/dashboard" ||
    path.startsWith("/dashboard/") ||
    path === "/jarvis" ||
    path.startsWith("/jarvis/");
  const isLogin = path === "/login";

  const token = req.cookies.get("session")?.value;
  const session = await decryptSession(token);

  if (isProtected && !session?.user) {
    // API callers need a machine-readable failure, not a redirect that fetch
    // follows into a 200 HTML login page.
    if (path.includes("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", req.nextUrl);
    if (path !== "/dashboard") url.searchParams.set("from", path);
    return NextResponse.redirect(url);
  }

  if (isLogin && session?.user) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/jarvis",
    "/jarvis/:path*",
    "/login",
  ],
};
