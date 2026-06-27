import { profile } from "@/content/profile";

export function Footer() {
  const year = 2026; // updated annually; avoids hydration mismatch from new Date()

  return (
    <footer className="mt-auto border-t hairline bg-background/45 backdrop-blur-[2px]">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 px-6 py-10 sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-md bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-mark.png"
              alt={`${profile.name} logo`}
              className="h-full w-full object-contain"
            />
          </span>
          <p className="text-sm text-zinc-500">
            © {year} {profile.name}. All rights reserved.
          </p>
        </div>
        <div className="flex items-center gap-5">
          {profile.socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target={s.href.startsWith("http") ? "_blank" : undefined}
              rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-sm font-medium text-zinc-500 transition-colors hover:text-white"
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
