import Link from "next/link";
import type { Metadata } from "next";
import { SignupWizard } from "@/components/mentorship/SignupWizard";

export const metadata: Metadata = {
  title: "Join · Mentorship",
  robots: { index: false },
};

export default function JoinPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mentorship/portal-ambient.jpg"
          alt=""
          className="ambient-drift h-full w-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/85 to-background" />
      </div>

      <SignupWizard />

      <p className="text-sm text-zinc-400">
        Already registered?{" "}
        <Link
          href="/mentorship/login"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
