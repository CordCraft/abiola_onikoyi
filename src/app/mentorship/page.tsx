import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Reveal } from "@/components/anim/Reveal";
import { profile } from "@/content/profile";
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

const MONTH_IMAGES: Record<number, string> = {
  1: "/mentorship/month-1.jpg",
  2: "/mentorship/month-2.jpg",
  3: "/mentorship/month-3.jpg",
};

const OUTCOMES = [
  {
    title: "A personal development plan",
    body: "A written assessment of where you are, where you are heading, and three concrete goals we agree together.",
    icon: (
      <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    ),
  },
  {
    title: "A capstone artifact",
    body: "A published article, portfolio project, certification, or application package you can point to when opportunities come.",
    icon: (
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    ),
  },
  {
    title: "Industry perspective",
    body: "Direct guidance drawn from 17+ years across Shell and Saudi Aramco, from reservoir engineering to patented innovation.",
    icon: <path d="M2 12h4l3-9 4 18 3-9h6" />,
  },
  {
    title: "A 12-month roadmap",
    body: "You leave with a clear, personal plan for the year after the programme ends.",
    icon: (
      <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    ),
  },
];

const HERO_STATS = [
  { value: "17+", label: "years in energy" },
  { value: "5", label: "US patents" },
  { value: "3", label: "month journey" },
  { value: "4×", label: "touchpoints monthly" },
];

export default function MentorshipPage() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        {/* Cinematic hero */}
        <section className="relative flex min-h-[94vh] items-end overflow-hidden">
          <div className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/mentorship/hero.jpg"
              alt="Offshore energy platform glowing at night"
              className="ambient-drift h-full w-full object-cover"
            />
            {/* Layered gradients: readable text, seamless blend into the page */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/30" />
            <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />
          </div>

          <div className="relative mx-auto w-full max-w-5xl px-6 pb-24 pt-40">
            <Reveal y={30} stagger={0.12}>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] gradient-text">
                Mentorship · {COHORT_LABEL}
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
                From the classroom to a{" "}
                <span className="gradient-text">career in energy</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-300">
                A three-month, goal-driven mentorship for chemical engineering
                students of the NSChE University of Lagos chapter. Small
                cohort. Individual attention. Real deliverables.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Link
                  href="/mentorship/login"
                  className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-7 py-3 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-6px] shadow-accent/50 transition-all hover:shadow-[0_12px_40px_-6px] hover:shadow-accent/60 hover:brightness-110"
                >
                  Mentee sign in
                </Link>
                <a
                  href="#journey"
                  className="rounded-full border border-white/20 px-7 py-3 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
                >
                  Explore the journey
                </a>
              </div>
              <div className="mt-14 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
                {HERO_STATS.map((s) => (
                  <div key={s.label} className="glass rounded-2xl px-4 py-3">
                    <p className="text-2xl font-semibold tracking-tight text-white">
                      {s.value}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">{s.label}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <div className="scroll-cue h-9 w-5 rounded-full border border-white/25 p-1">
              <div className="mx-auto h-2 w-1 rounded-full bg-white/60" />
            </div>
          </div>
        </section>

        {/* The journey */}
        <section id="journey" className="relative py-28">
          <div className="mx-auto max-w-5xl px-6">
            <Reveal>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
                The journey
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Three months, three movements
              </h2>
            </Reveal>
            <div className="relative mt-14">
              {/* Connecting light line on desktop */}
              <div
                aria-hidden
                className="absolute left-0 right-0 top-0 hidden h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent md:block"
              />
              <Reveal className="grid gap-6 md:grid-cols-3" stagger={0.14}>
                {[1, 2, 3].map((m) => (
                  <div
                    key={m}
                    className="glow-card glass group relative overflow-hidden rounded-3xl md:mt-8"
                  >
                    <div className="relative h-44 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={MONTH_IMAGES[m]}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/20 to-transparent" />
                      <span className="absolute left-5 top-5 grid h-10 w-10 place-items-center rounded-full border border-accent/40 bg-background/70 text-sm font-bold text-accent backdrop-blur">
                        {m}
                      </span>
                    </div>
                    <div className="p-6 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                        Month {m}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold text-white">
                        {MONTH_THEMES[m].title}
                      </h3>
                      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                        {MONTH_THEMES[m].blurb}
                      </p>
                    </div>
                  </div>
                ))}
              </Reveal>
            </div>
          </div>
        </section>

        {/* Rhythm + outcomes */}
        <section className="relative border-t hairline py-28">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage: "url(/mentorship/portal-ambient.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/70 to-background" />
          <div className="relative mx-auto max-w-5xl px-6">
            <div className="grid gap-16 md:grid-cols-2">
              <Reveal>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
                    The rhythm
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    Momentum, monthly
                  </h2>
                  <p className="mt-4 text-zinc-400">
                    At least four touchpoints a month, so progress never stalls
                    between sessions.
                  </p>
                  <ul className="mt-8 space-y-4">
                    {CADENCE.map((c, i) => (
                      <li
                        key={c.label}
                        className="glass glow-card flex items-center gap-4 rounded-2xl p-4"
                        style={{ animationDelay: `${i * 0.4}s` }}
                      >
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10 text-sm font-bold text-accent">
                          {c.perMonth}×
                        </span>
                        <span className="font-medium text-zinc-200">{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
                    The outcome
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    What you leave with
                  </h2>
                  <ul className="mt-8 grid gap-4">
                    {OUTCOMES.map((o) => (
                      <li key={o.title} className="glass glow-card rounded-2xl p-5">
                        <div className="flex items-start gap-4">
                          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent/20 to-accent-2/20 text-accent">
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              {o.icon}
                            </svg>
                          </span>
                          <div>
                            <h3 className="font-semibold text-white">{o.title}</h3>
                            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                              {o.body}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Your mentor */}
        <section className="relative border-t hairline py-28">
          <div className="mx-auto max-w-5xl px-6">
            <Reveal className="glass relative overflow-hidden rounded-3xl">
              <div className="grid items-center gap-8 p-8 sm:p-12 md:grid-cols-[auto_1fr]">
                {profile.photo ? (
                  <div className="relative mx-auto w-40 sm:w-48">
                    <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-accent/50 to-accent-2/50 opacity-70 blur-md" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={profile.photo}
                      alt={profile.name}
                      className="relative w-full rounded-2xl border border-white/10 object-cover"
                    />
                  </div>
                ) : null}
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
                    Your mentor
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    {profile.name}
                  </h2>
                  <p className="mt-1 font-medium text-accent">{profile.headline}</p>
                  <p className="mt-4 max-w-xl leading-relaxed text-zinc-400">
                    Petroleum engineer with 17+ years across Shell and Saudi
                    Aramco, five US patents, and a passion for raising the next
                    generation of Nigerian engineers. This programme is my
                    commitment to the NSChE UNILAG chapter: real guidance,
                    structured accountability, and doors opened.
                  </p>
                  <Link
                    href="/#about"
                    className="mt-6 inline-block text-sm font-semibold text-accent underline-offset-4 hover:underline"
                  >
                    More about me →
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className="relative overflow-hidden border-t hairline py-28">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, var(--accent), transparent 70%)",
            }}
          />
          <div className="relative mx-auto max-w-3xl px-6 text-center">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Already a mentee?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-zinc-400">
                Your portal tracks your goals, weekly check-ins, tasks, and
                sessions, and gives you a direct line to your mentor.
              </p>
              <Link
                href="/mentorship/login"
                className="mt-9 inline-block rounded-full bg-gradient-to-r from-accent to-accent-2 px-8 py-3 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-6px] shadow-accent/50 transition-all hover:shadow-[0_12px_40px_-6px] hover:shadow-accent/60 hover:brightness-110"
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
