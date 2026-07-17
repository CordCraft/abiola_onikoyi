import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { logout } from "./actions";

export const metadata: Metadata = {
  title: "Jarvis",
  manifest: "/jarvis/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Jarvis",
  },
};

const NAV = [
  {
    href: "/jarvis",
    label: "Overview",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    href: "/jarvis/chat",
    label: "Chat",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
  {
    href: "/jarvis/ventures",
    label: "Ventures",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
      </svg>
    ),
  },
  {
    href: "/jarvis/goals",
    label: "Goals",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/jarvis/memory",
    label: "Memory",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
  },
];

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
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 md:h-16 md:px-6">
          <div className="flex items-center gap-7">
            <Link href="/jarvis" className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-zinc-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.png" alt="" className="h-full w-full object-contain p-0.5" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-zinc-900">Jarvis</span>
            </Link>
            <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
              {[...NAV, { href: "/jarvis/timeline", label: "Timeline" }, { href: "/jarvis/graph", label: "Graph" }].map((item) => (
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
            <span className="hidden text-zinc-500 md:inline">{user}</span>
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

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-6 pb-24 md:px-6 md:py-10 md:pb-10">
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200/70 bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-zinc-500 transition-colors hover:text-indigo-600"
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
