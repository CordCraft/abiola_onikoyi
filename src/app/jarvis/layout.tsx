import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { logout } from "./actions";

export default async function JarvisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await verifySession();

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/jarvis" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-zinc-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.png" alt="" className="h-full w-full object-contain p-0.5" />
              </span>
              <span className="font-semibold tracking-tight text-zinc-900">Jarvis</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium text-zinc-600">
              <Link href="/jarvis" className="hover:text-zinc-900">Overview</Link>
              <Link href="/jarvis/chat" className="hover:text-zinc-900">Chat</Link>
              <Link href="/jarvis/ventures" className="hover:text-zinc-900">Ventures</Link>
              <Link href="/jarvis/goals" className="hover:text-zinc-900">Goals</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="hidden text-zinc-500 hover:text-zinc-900 sm:inline">
              Dashboard
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
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
