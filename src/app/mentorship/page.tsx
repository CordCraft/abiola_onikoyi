import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Reveal } from "@/components/anim/Reveal";
import {
  MONTH_THEMES,
  CADENCE,
  COHORT_LABEL,
} from "@/lib/mentorship/constants";

export const metadata: Metadata = {
  title: "Mentorship",
  description:
    "A structured three-month mentorship programme for chemical engineering students, led by Abiola Onikoyi.",
};

const OUTCOMES = [
  {
    title: "A personal development plan",
    body: "A written assessment of where you are, where you are heading, and three concrete goals we agree together.",
  },
  {
    title: "A capstone artifact",
    body: "A published article, portfolio project, certification, or application package you can point to when opportunities come.",
  },
  {
    title: "Industry perspective",
    body: "Direct guidance drawn from 17+ years across Shell and Saudi Aramco, from reservoir engineering to patented innovation.",
  },
  {
    title: "A 12-month roadmap",
    body: "You leave with a clear, personal plan for the year after the programme ends.",
  },
];

export default function MentorshipPage() {
  return (
    <>
      <Nav />
      <main className="flex-1 pt-28">
        <section className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
            Mentorship
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            A structured path from the classroom to a career in energy
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-400">
            A three-month, goal-driven mentorship programme for chemical
            engineering students of the NSChE University of Lagos chapter.
            Small cohort, individual attention, real deliverables.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/mentorship/login"
              className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90"
            >
              Mentee sign in
            </Link>
            <span className="text-sm font-medium text-zinc-500">
              {COHORT_LABEL} · by invitation
            </span>
          </div>
        </section>

        <section className="border-t hairline bg-background/45 py-20 backdrop-blur-[2px]">
          <div className="mx-auto max-w-5xl px-6">
            <Reveal>
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Three months, three movements
              </h2>
            </Reveal>
            <Reveal className="mt-10 grid gap-6 md:grid-cols-3" stagger={0.12}>
              {[1, 2, 3].map((m) => (
                <div
                  key={m}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                    Month {m}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {MONTH_THEMES[m].title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                    {MONTH_THEMES[m].blurb}
                  </p>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="border-t hairline bg-background/45 py-20 backdrop-blur-[2px]">
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid gap-12 md:grid-cols-2">
              <Reveal>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    The monthly rhythm
                  </h2>
                  <p className="mt-4 text-zinc-400">
                    At least four touchpoints a month, so momentum never stalls
                    between sessions.
                  </p>
                  <ul className="mt-6 space-y-4">
                    {CADENCE.map((c) => (
                      <li key={c.label} className="flex items-center gap-4">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10 text-sm font-bold text-accent">
                          {c.perMonth}×
                        </span>
                        <span className="text-zinc-300">{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    What you leave with
                  </h2>
                  <ul className="mt-6 space-y-5">
                    {OUTCOMES.map((o) => (
                      <li key={o.title}>
                        <h3 className="font-semibold text-white">{o.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                          {o.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="border-t hairline bg-background/45 py-20 backdrop-blur-[2px]">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <Reveal>
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Already a mentee?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-zinc-400">
                Your portal tracks your goals, weekly check-ins, tasks, and
                sessions, and gives you a direct line to your mentor.
              </p>
              <Link
                href="/mentorship/login"
                className="mt-8 inline-block rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
              >
                Open the portal
              </Link>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
