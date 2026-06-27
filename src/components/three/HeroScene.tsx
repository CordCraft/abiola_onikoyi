"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// An animated wave-field of glowing points. It drifts on its own, parallaxes
// with the mouse, and shifts with scroll. Pure Three.js (built in a useEffect),
// so it renders only on the client and cleans itself up on unmount.
export function HeroScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const scene = new THREE.Scene();
    const bg = new THREE.Color("#05060a");
    scene.fog = new THREE.FogExp2(bg, 0.018);

    let width = container.clientWidth;
    let height = container.clientHeight;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);
    camera.position.set(0, 14, 26);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Build a grid of points on the XZ plane; Z (depth) recedes from the camera.
    const COLS = 80;
    const ROWS = 80;
    const SPACING = 0.9;
    const count = COLS * ROWS;
    const positions = new Float32Array(count * 3);
    const baseX = new Float32Array(count);
    const baseZ = new Float32Array(count);

    let i = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const x = (c - COLS / 2) * SPACING;
        const z = (r - ROWS / 2) * SPACING;
        baseX[i] = x;
        baseZ[i] = z;
        positions[i * 3] = x;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = z;
        i++;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: new THREE.Color("#2dd4bf"),
      size: 0.06,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    const group = new THREE.Group();
    group.add(points);
    scene.add(group);

    // Interaction state
    const mouse = { x: 0, y: 0 };
    let scrollProgress = 0;

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? window.scrollY / max : 0;
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;

    const updateWave = (t: number) => {
      for (let n = 0; n < count; n++) {
        const x = baseX[n];
        const z = baseZ[n];
        const y =
          Math.sin(x * 0.3 + t) * 0.8 +
          Math.cos(z * 0.3 + t * 0.8) * 0.8 +
          Math.sin((x + z) * 0.18 + t * 0.5) * 0.6;
        posAttr.array[n * 3 + 1] = y;
      }
      posAttr.needsUpdate = true;
    };

    let raf = 0;
    let time = 0;
    const clock = new THREE.Clock();

    const render = () => {
      const delta = clock.getDelta();
      time += delta * 0.6;
      updateWave(time);

      // Drift + scroll-driven rotation and camera dolly
      group.rotation.y = time * 0.04 + scrollProgress * 0.6;
      group.rotation.x = -0.1 + scrollProgress * 0.25;

      // Mouse parallax (eased)
      camera.position.x += (mouse.x * 4 - camera.position.x) * 0.03;
      camera.position.y += (14 - mouse.y * 3 - camera.position.y) * 0.03;
      camera.position.z = 26 - scrollProgress * 8;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };

    if (prefersReduced) {
      // One static, pleasant frame.
      updateWave(0.6);
      group.rotation.x = -0.1;
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(render);
    }

    const onResize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="absolute inset-0 h-full w-full"
    />
  );
}
