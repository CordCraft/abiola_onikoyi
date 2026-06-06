import { NextResponse, type NextRequest } from "next/server";
import { decryptSession } from "@/lib/jwt";

// Next.js 16 renamed `middleware` to `proxy` (Node.js runtime). This performs an
// optimistic auth check: it reads the signed session cookie and redirects
// unauthenticated visitors away from /dashboard, and authenticated visitors
// away from /login. The authoritative check still happens in each page/action
// via verifySession() (see src/lib/dal.ts).
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const isLogin = path === "/login";

  const token = req.cookies.get("session")?.value;
  const session = await decryptSession(token);

  if (isDashboard && !session?.user) {
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
  matcher: ["/dashboard", "/dashboard/:path*", "/login"],
};
