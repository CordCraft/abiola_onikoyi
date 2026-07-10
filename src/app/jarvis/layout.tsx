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
    <div className="relative min-h-screen bg-[#f6f6f9] text-zinc-900">
      {/* Ambient background wash */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-indigo-400/20 blur-[130px]" />
        <div className="absolute top-1/4 -right-24 h-80 w-80 rounded-full bg-violet-400/15 blur-[130px]" />
        <div className="absolute -bottom-20 left-0 h-72 w-72 rounded-full bg-sky-300/20 blur-[130px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-7">
            <Link href="/jarvis" className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-zinc-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.png" alt="" className="h-full w-full object-contain p-0.5" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-zinc-900">Jarvis</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm font-medium">
              {[
                { href: "/jarvis", label: "Overview" },
                { href: "/jarvis/chat", label: "Chat" },
                { href: "/jarvis/ventures", label: "Ventures" },
                { href: "/jarvis/goals", label: "Goals" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-1.5 text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/dashboard" className="hidden text-zinc-500 transition-colors hover:text-zinc-900 sm:inline">
              Dashboard
            </Link>
            <span className="hidden text-zinc-300 sm:inline">·</span>
            <span className="hidden text-zinc-500 sm:inline">{user}</span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-full border border-zinc-300 px-3.5 py-1.5 font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
