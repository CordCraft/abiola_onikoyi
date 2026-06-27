"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// A GPU-driven particle wave-field rendered as a FIXED, full-page background so
// the 3D motion is felt behind every section. The wave is computed in the
// vertex shader (cheap even at high density) and reacts to time, scroll, and
// the mouse (a ripple follows the cursor).
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform vec2 uMouse;     // mouse projected into the field's XZ plane
  uniform float uAmp;      // global amplitude (intensity)
  varying float vH;
  varying float vDist;

  void main() {
    vec3 p = position;

    float wave =
        sin(p.x * 0.22 + uTime) * 1.3
      + cos(p.z * 0.22 + uTime * 0.8) * 1.3
      + sin((p.x + p.z) * 0.13 + uTime * 0.55) * 0.9;

    // Gentle ripple that follows the cursor
    float md = distance(p.xz, uMouse);
    wave += exp(-md * md * 0.012) * 1.0 * sin(uTime * 1.8 - md * 0.8);

    p.y += wave * uAmp;
    vH = wave;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.9 + (vH + 2.0) * 0.5) * (300.0 / -mv.z);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vH;
  varying float vDist;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d);
    float t = clamp((vH + 2.0) / 4.0, 0.0, 1.0);
    vec3 col = mix(uColorA, uColorB, t);
    float fog = clamp(1.0 - (vDist - 12.0) / 70.0, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha * fog * 0.55);
  }
`;

export function SiteBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = window.innerWidth;
    let height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, width / height, 0.1, 240);
    camera.position.set(0, 16, 30);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Dense grid of points on the XZ plane
    const COLS = 120;
    const ROWS = 120;
    const SPACING = 0.7;
    const HALF = (COLS * SPACING) / 2;
    const count = COLS * ROWS;
    const positions = new Float32Array(count * 3);
    let idx = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        positions[idx * 3] = (c - COLS / 2) * SPACING;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = (r - ROWS / 2) * SPACING;
        idx++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const uniforms = {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uAmp: { value: 0.6 },
      uColorA: { value: new THREE.Color("#27364f") }, // muted slate-blue (troughs)
      uColorB: { value: new THREE.Color("#3aa6a0") }, // soft teal (crests)
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    const group = new THREE.Group();
    group.add(points);
    scene.add(group);

    // Interaction
    const mouse = { x: 0, y: 0 };
    const mouseTarget = { x: 0, y: 0 };
    let scrollProgress = 0;

    const onMouseMove = (e: MouseEvent) => {
      mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? window.scrollY / max : 0;
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const clock = new THREE.Clock();
    let raf = 0;
    let running = true;

    const renderFrame = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      uniforms.uTime.value += delta * 0.4;
      uniforms.uScroll.value = scrollProgress;

      // Ease mouse and project into the field plane for the ripple
      mouse.x += (mouseTarget.x - mouse.x) * 0.05;
      mouse.y += (mouseTarget.y - mouse.y) * 0.05;
      uniforms.uMouse.value.set(mouse.x * HALF, mouse.y * HALF);

      // Scroll drives the whole field: it rotates and the camera flies through it
      group.rotation.y = uniforms.uTime.value * 0.02 + scrollProgress * 0.6;
      group.rotation.x = -0.18 + scrollProgress * 0.25;
      group.rotation.z = scrollProgress * 0.08;

      camera.position.x += (mouse.x * 3 - camera.position.x) * 0.04;
      camera.position.y = 16 - scrollProgress * 5 - mouse.y * 1.5;
      camera.position.z = 30 - scrollProgress * 7;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(renderFrame);
    };

    if (prefersReduced) {
      uniforms.uAmp.value = 0.5;
      uniforms.uTime.value = 0.6;
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(renderFrame);
    }

    const onResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", onResize);

    // Pause rendering when the tab is hidden
    const onVisibility = () => {
      if (document.hidden) {
        if (running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      } else if (!running && !prefersReduced) {
        running = true;
        clock.getDelta();
        raf = requestAnimationFrame(renderFrame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
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
      className="pointer-events-none fixed inset-0 -z-10 h-screen w-screen"
    />
  );
}
