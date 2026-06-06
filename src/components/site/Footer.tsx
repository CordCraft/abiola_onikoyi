import { profile } from "@/content/profile";

export function Footer() {
  const year = 2026; // updated annually; avoids hydration mismatch from new Date()

  return (
    <footer className="mt-auto border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <p className="text-sm text-zinc-500">
          © {year} {profile.name}. All rights reserved.
        </p>
        <div className="flex items-center gap-5">
          {profile.socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target={s.href.startsWith("http") ? "_blank" : undefined}
              rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
