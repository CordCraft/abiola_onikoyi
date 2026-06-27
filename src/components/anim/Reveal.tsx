"use client";

import { useRef, useEffect, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Reveals its direct children as they scroll into view (fade + rise, staggered).
// Wrap a group of items to stagger them, or a single element to reveal just it.
export function Reveal({
  children,
  className,
  y = 28,
  stagger = 0.09,
  start = "top 85%",
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  stagger?: number;
  start?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    gsap.registerPlugin(ScrollTrigger);
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const targets = el.children.length ? Array.from(el.children) : [el];

    const ctx = gsap.context(() => {
      if (prefersReduced) {
        gsap.set(targets, { opacity: 1, y: 0 });
        return;
      }
      gsap.from(targets, {
        opacity: 0,
        y,
        duration: 0.8,
        ease: "power3.out",
        stagger,
        scrollTrigger: { trigger: el, start, once: true },
      });
    }, el);

    return () => ctx.revert();
  }, [y, stagger, start]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
