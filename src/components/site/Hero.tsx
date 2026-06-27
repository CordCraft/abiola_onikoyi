"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { HeroScene } from "@/components/three/HeroScene";
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

    const ctx = gsap.context(() => {
      gsap.from(".hero-anim", {
        opacity: 0,
        y: 30,
        duration: 1,
        ease: "power3.out",
        stagger: 0.12,
        delay: 0.15,
      });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative min-h-screen overflow-hidden bg-background"
    >
      {/* 3D particle field */}
      <HeroScene />

      {/* Legibility overlays */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 10%, transparent 30%, rgba(5,6,10,0.55) 75%, rgba(5,6,10,0.95) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-background"
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-28">
        <p className="hero-anim text-sm font-medium uppercase tracking-[0.25em] text-accent">
          Petroleum Engineer · {profile.location}
        </p>

        <h1 className="hero-anim mt-5 text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
          Abiola <span className="gradient-text">Onikoyi</span>
        </h1>

        <p className="hero-anim mt-6 max-w-2xl text-lg leading-relaxed text-zinc-300 sm:text-xl">
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

        {/* Stats */}
        <div className="hero-anim mt-16 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          {profile.stats.map((s) => (
            <div key={s.label} className="border-l border-white/10 pl-4">
              <div className="text-3xl font-semibold text-white">{s.value}</div>
              <div className="mt-1 text-xs leading-snug text-zinc-400">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll cue */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-zinc-500">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
          <span className="h-10 w-px animate-pulse bg-gradient-to-b from-accent to-transparent" />
        </div>
      </div>
    </section>
  );
}
