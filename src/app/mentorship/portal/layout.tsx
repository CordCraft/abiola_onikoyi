import Link from "next/link";
import type { Metadata } from "next";
import { verifyMentee } from "@/lib/mentorship/dal";
import { profile } from "@/content/profile";
import { PortalNav } from "@/components/mentorship/PortalNav";
import {
  COHORT_LABEL,
  PROGRAM_WEEKS,
  programWeek,
} from "@/lib/mentorship/constants";

export const metadata: Metadata = {
  title: "Mentorship Portal",
  robots: { index: false },
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const mentee = await verifyMentee();
  const week = programWeek();

  return (
    <div className="relative min-h-screen">
      {/* Ambient art layer behind everything */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mentorship/portal-ambient.jpg"
          alt=""
          className="ambient-drift h-full w-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
      </div>

      <header className="sticky top-0 z-40 border-b hairline bg-background/60 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-6">
          <div className="flex h-16 items-center justify-between">
            <Link href="/mentorship/portal" className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-md bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-mark.png"
                  alt={`${profile.name} logo`}
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="hidden font-semibold tracking-tight text-white sm:inline">
                Mentorship Portal
              </span>
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <span className="hidden text-zinc-500 sm:inline">
                {COHORT_LABEL}
                {week >= 1 && week <= PROGRAM_WEEKS
                  ? ` · Week ${week} of ${PROGRAM_WEEKS}`
                  : null}
              </span>
              <span className="font-medium text-zinc-300">{mentee.name.split(" ")[0]}</span>
              <a
                href="/mentorship/logout"
                className="rounded-full border border-white/15 px-3 py-1 font-medium text-zinc-300 transition-colors hover:bg-white/10"
              >
                Sign out
              </a>
            </div>
          </div>
          <PortalNav />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
