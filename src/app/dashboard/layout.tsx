import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { profile } from "@/content/profile";
import { logout } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await verifySession();

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-zinc-900 text-sm font-bold text-white">
                {profile.initials}
              </span>
              <span className="font-semibold tracking-tight text-zinc-900">
                Dashboard
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium text-zinc-600">
              <Link href="/dashboard" className="hover:text-zinc-900">
                Projects
              </Link>
              <Link href="/dashboard/blog" className="hover:text-zinc-900">
                Blog
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/"
              className="hidden text-zinc-500 hover:text-zinc-900 sm:inline"
            >
              View public site
            </Link>
            <span className="hidden text-zinc-400 sm:inline">·</span>
            <span className="text-zinc-500">{user}</span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
