import Link from "next/link";
import { profile } from "@/content/profile";

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-10">
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">
        {kicker}
      </p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-zinc-950 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl"
      />
      <div className="mx-auto max-w-5xl px-6 py-24 sm:py-32">
        <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center">
          <div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-white/10 text-3xl font-bold ring-1 ring-white/15">
            {profile.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.photo}
                alt={profile.name}
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : (
              profile.initials
            )}
          </div>
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-indigo-300">
              {profile.location}
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
              {profile.name}
            </h1>
            <p className="mt-3 text-xl font-medium text-zinc-300">
              {profile.headline}
            </p>
          </div>
        </div>

        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-zinc-300">
          {profile.tagline}
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#contact"
            className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200"
          >
            Get in touch
          </a>
          <Link
            href="/dashboard"
            className="rounded-full border border-white/25 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            View projects →
          </Link>
        </div>
      </div>
    </section>
  );
}

export function About() {
  return (
    <section id="about" className="mx-auto max-w-5xl px-6 py-20">
      <SectionHeading kicker="About" title="Background" />
      <div className="max-w-3xl space-y-5 text-lg leading-relaxed text-zinc-600">
        {profile.about.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </section>
  );
}

export function Experience() {
  return (
    <section id="experience" className="border-t border-zinc-100 bg-zinc-50/60">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <SectionHeading kicker="Experience" title="Where I've worked" />
        <ol className="relative space-y-10 border-l border-zinc-200 pl-8">
          {profile.experience.map((job, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[2.35rem] top-1.5 grid h-4 w-4 place-items-center rounded-full bg-accent ring-4 ring-zinc-50" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <h3 className="text-lg font-semibold text-zinc-900">
                  {job.role}
                </h3>
                <span className="text-sm font-medium text-zinc-500">
                  {job.start} — {job.end}
                </span>
              </div>
              <p className="mt-0.5 font-medium text-accent">
                {job.company}
                {job.location ? (
                  <span className="font-normal text-zinc-400">
                    {" · "}
                    {job.location}
                  </span>
                ) : null}
              </p>
              {job.summary ? (
                <p className="mt-2 text-zinc-600">{job.summary}</p>
              ) : null}
              {job.highlights && job.highlights.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-zinc-600 marker:text-zinc-300">
                  {job.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Skills() {
  return (
    <section id="skills" className="mx-auto max-w-5xl px-6 py-20">
      <SectionHeading kicker="Skills" title="What I bring" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {profile.skills.map((group) => (
          <div
            key={group.category}
            className="rounded-xl border border-zinc-200 bg-white p-6"
          >
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-900">
              {group.category}
            </h3>
            <ul className="mt-4 flex flex-wrap gap-2">
              {group.items.map((item) => (
                <li
                  key={item}
                  className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-700"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Education() {
  return (
    <section id="education" className="border-t border-zinc-100 bg-zinc-50/60">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <SectionHeading kicker="Education" title="Studies & credentials" />
        <div className="space-y-6">
          {profile.education.map((ed, i) => (
            <div
              key={i}
              className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-xl border border-zinc-200 bg-white p-6"
            >
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">
                  {ed.school}
                </h3>
                <p className="mt-0.5 font-medium text-accent">
                  {ed.credential}
                  {ed.field ? (
                    <span className="font-normal text-zinc-500">
                      {" · "}
                      {ed.field}
                    </span>
                  ) : null}
                </p>
                {ed.details ? (
                  <p className="mt-2 text-zinc-600">{ed.details}</p>
                ) : null}
              </div>
              {ed.start || ed.end ? (
                <span className="text-sm font-medium text-zinc-500">
                  {ed.start} — {ed.end}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Contact() {
  return (
    <section id="contact" className="mx-auto max-w-5xl px-6 py-20">
      <SectionHeading kicker="Contact" title="Let's connect" />
      <div className="flex flex-col items-start gap-6 rounded-2xl bg-zinc-950 p-10 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-lg text-zinc-300">
            Open to conversations, collaborations, and new ideas.
          </p>
          <a
            href={`mailto:${profile.email}`}
            className="mt-2 inline-block text-xl font-semibold text-white underline-offset-4 hover:underline"
          >
            {profile.email}
          </a>
        </div>
        <div className="flex gap-3">
          {profile.socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target={s.href.startsWith("http") ? "_blank" : undefined}
              rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="rounded-full border border-white/25 px-5 py-2 text-sm font-semibold transition-colors hover:bg-white/10"
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
