"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { profile } from "@/content/profile";

export function Hero() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      // Intro
      gsap.from(".hero-anim", {
        opacity: 0,
        y: 40,
        duration: 1,
        ease: "power3.out",
        stagger: 0.12,
        delay: 0.15,
      });
      // Scrubbed parallax + fade as you scroll past the hero
      gsap.to(".hero-content", {
        y: -120,
        opacity: 0,
        ease: "none",
        scrollTrigger: {
          trigger: el,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative flex min-h-screen items-center overflow-hidden"
    >
      {/* Soft vignette for text legibility over the live field */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 30%, transparent 35%, rgba(5,6,10,0.35) 70%, rgba(5,6,10,0.8) 100%)",
        }}
      />

      <div className="hero-content relative z-10 mx-auto w-full max-w-5xl px-6 py-28">
        <p className="hero-anim text-sm font-medium uppercase tracking-[0.25em] text-accent">
          Petroleum Engineer · {profile.location}
        </p>

        <h1 className="hero-anim mt-5 text-5xl font-semibold leading-[1.05] tracking-tight drop-shadow-[0_2px_30px_rgba(0,0,0,0.5)] sm:text-7xl">
          Abiola <span className="gradient-text">Onikoyi</span>
        </h1>

        <p className="hero-anim mt-6 max-w-2xl text-lg leading-relaxed text-zinc-200 sm:text-xl">
          {profile.tagline}
        </p>

        <div className="hero-anim mt-9 flex flex-wrap items-center gap-4">
          <a
            href="#contact"
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
          >
            Get in touch
          </a>
          <Link
            href="/dashboard"
            className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/10"
          >
            View projects →
          </Link>
        </div>

        <div className="hero-anim mt-16 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          {profile.stats.map((s) => (
            <div key={s.label} className="border-l border-white/15 pl-4">
              <div className="text-3xl font-semibold text-white">{s.value}</div>
              <div className="mt-1 text-xs leading-snug text-zinc-400">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-zinc-500">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
          <span className="h-10 w-px animate-pulse bg-gradient-to-b from-accent to-transparent" />
        </div>
      </div>
    </section>
  );
}
