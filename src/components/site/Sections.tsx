import { profile } from "@/content/profile";
import { Reveal } from "@/components/anim/Reveal";
import { Parallax } from "@/components/anim/Parallax";

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-12">
      <p className="text-sm font-semibold uppercase tracking-[0.25em] gradient-text">
        {kicker}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

export function About() {
  return (
    <section
      id="about"
      className="relative bg-background/40 py-28 backdrop-blur-[2px]"
    >
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <SectionHeading kicker="About" title="Background" />
        </Reveal>
        <Reveal className="grid items-start gap-12 md:grid-cols-[1.6fr_1fr]">
          <div className="space-y-5 text-lg leading-relaxed text-zinc-300">
            {profile.about.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="relative">
            <Parallax amount={36}>
              <div className="relative">
                <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-accent/40 to-accent-2/40 opacity-60 blur-md" />
                {profile.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.photo}
                    alt={profile.name}
                    className="relative w-full rounded-2xl border border-white/10 object-cover"
                  />
                ) : null}
              </div>
            </Parallax>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Experience() {
  return (
    <section id="experience" className="relative border-t hairline bg-background/55 py-28 backdrop-blur-[2px]">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <SectionHeading kicker="Experience" title="Career" />
        </Reveal>
        <Reveal
          className="ml-2 space-y-12 border-l border-white/10 pl-8"
          stagger={0.12}
        >
          {profile.experience.map((job, i) => (
            <div key={i} className="relative">
              <span className="absolute -left-[2.6rem] top-1.5 grid h-4 w-4 place-items-center rounded-full bg-accent shadow-[0_0_18px_2px] shadow-accent/40 ring-4 ring-background" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <h3 className="text-lg font-semibold text-white">{job.role}</h3>
                <span className="text-sm font-medium text-zinc-500">
                  {job.start} — {job.end}
                </span>
              </div>
              <p className="mt-1 font-medium text-accent">
                {job.company}
                {job.location ? (
                  <span className="font-normal text-zinc-500">
                    {" · "}
                    {job.location}
                  </span>
                ) : null}
              </p>
              {job.summary ? (
                <p className="mt-2 text-zinc-400">{job.summary}</p>
              ) : null}
              {job.highlights && job.highlights.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-zinc-400 marker:text-accent/50">
                  {job.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Skills() {
  return (
    <section id="skills" className="relative border-t hairline bg-background/55 py-28 backdrop-blur-[2px]">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <SectionHeading kicker="Expertise" title="What I bring" />
        </Reveal>
        <Reveal className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {profile.skills.map((group) => (
            <div
              key={group.category}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white">
                {group.category}
              </h3>
              <ul className="mt-4 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-medium text-zinc-300"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Patents() {
  return (
    <section id="patents" className="relative border-t hairline bg-background/55 py-28 backdrop-blur-[2px]">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <SectionHeading kicker="Innovation" title="Patents" />
        </Reveal>
        <Reveal className="divide-y divide-white/10 border-y border-white/10">
          {profile.patents.map((p) => (
            <a
              key={p.number}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-2 py-6 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:gap-6"
            >
              <span
                className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                  p.status === "Granted"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-amber-400/10 text-amber-300"
                }`}
              >
                {p.status} · {p.year}
              </span>
              <span className="flex-1 text-base font-medium text-zinc-200 group-hover:text-white">
                {p.title}
              </span>
              <span className="font-mono text-xs text-zinc-500 group-hover:text-accent">
                {p.number} ↗
              </span>
            </a>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Education() {
  return (
    <section id="education" className="relative border-t hairline bg-background/55 py-28 backdrop-blur-[2px]">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <SectionHeading kicker="Education" title="Studies" />
        </Reveal>
        <Reveal className="grid gap-6 sm:grid-cols-2">
          {profile.education.map((ed, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
            >
              <div className="flex items-baseline justify-between gap-x-4">
                <h3 className="text-lg font-semibold text-white">{ed.school}</h3>
                {ed.start || ed.end ? (
                  <span className="shrink-0 text-sm font-medium text-zinc-500">
                    {ed.start} — {ed.end}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 font-medium text-accent">
                {ed.credential}
                {ed.field ? (
                  <span className="font-normal text-zinc-500">
                    {" · "}
                    {ed.field}
                  </span>
                ) : null}
              </p>
              {ed.details ? (
                <p className="mt-2 text-zinc-400">{ed.details}</p>
              ) : null}
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Contact() {
  return (
    <section id="contact" className="relative border-t hairline bg-background/55 py-28 backdrop-blur-[2px]">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <SectionHeading kicker="Contact" title="Let's connect" />
        </Reveal>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 p-10 sm:p-14">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 opacity-60"
              style={{
                background:
                  "radial-gradient(80% 120% at 0% 0%, rgba(45,212,191,0.18), transparent 60%), radial-gradient(80% 120% at 100% 100%, rgba(129,140,248,0.18), transparent 60%)",
              }}
            />
            <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg text-zinc-300">
                  Open to conversations, collaborations, and new ideas.
                </p>
                <a
                  href={`mailto:${profile.email}`}
                  className="mt-2 inline-block text-2xl font-semibold text-white underline-offset-4 hover:underline"
                >
                  {profile.email}
                </a>
              </div>
              <div className="flex flex-wrap gap-3">
                {profile.socials.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target={s.href.startsWith("http") ? "_blank" : undefined}
                    rel={
                      s.href.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                    className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
