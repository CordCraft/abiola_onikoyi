"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { label: "Overview", href: "/mentorship/portal" },
  { label: "Goals & Tasks", href: "/mentorship/portal/goals" },
  { label: "Check-ins", href: "/mentorship/portal/checkins" },
  { label: "Messages", href: "/mentorship/portal/messages" },
  { label: "Sessions", href: "/mentorship/portal/sessions" },
  { label: "Resources", href: "/mentorship/portal/resources" },
];

export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto pb-2">
      {links.map((l) => {
        const active =
          l.href === "/mentorship/portal"
            ? pathname === l.href
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-gradient-to-r from-accent/20 to-accent-2/20 text-white shadow-[inset_0_0_0_1px] shadow-accent/40"
                : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
