"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

// Per-state targets. Uniforms lerp toward these every frame, so switching state
// glides instead of snapping.
type Targets = {
  speed: number; // orbit speed multiplier
  radius: number; // swarm radius
  curl: number; // flow field strength
  swirl: number; // vortex strength
  core: number; // bright core amount
  ripple: number; // outward ripple driven by level
  pulse: number; // radial pulse driven by level
  bright: number;
};

const TARGETS: Record<OrbState, Targets> = {
  idle: { speed: 0.35, radius: 1.0, curl: 0.38, swirl: 0.0, core: 0.0, ripple: 0.0, pulse: 0.0, bright: 1.05 },
  listening: { speed: 0.6, radius: 0.78, curl: 0.2, swirl: 0.0, core: 0.25, ripple: 1.0, pulse: 0.0, bright: 1.0 },
  thinking: { speed: 1.5, radius: 0.85, curl: 0.3, swirl: 1.0, core: 1.0, ripple: 0.0, pulse: 0.0, bright: 1.15 },
  speaking: { speed: 0.7, radius: 0.95, curl: 0.3, swirl: 0.0, core: 0.3, ripple: 0.0, pulse: 1.0, bright: 1.1 },
};

const VERT = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aShell;
  uniform float uTime;
  uniform float uWave;
  uniform float uLevel;
  uniform float uRadius;
  uniform float uCurl;
  uniform float uSwirl;
  uniform float uRipple;
  uniform float uPulse;
  uniform float uScale;
  varying float vGlow;
  varying float vMix;

  vec3 potential(vec3 p, float t) {
    return vec3(
      sin(p.y * 2.1 + t * 0.9) + cos(p.z * 1.7 - t * 0.6),
      sin(p.z * 2.3 - t * 0.7) + cos(p.x * 1.9 + t * 0.8),
      sin(p.x * 2.0 + t * 0.5) + cos(p.y * 2.2 - t * 0.9)
    );
  }

  // Divergence free flow: curl of a vector potential via central differences.
  vec3 curl(vec3 p, float t) {
    const float e = 0.12;
    vec3 dx = potential(p + vec3(e, 0.0, 0.0), t) - potential(p - vec3(e, 0.0, 0.0), t);
    vec3 dy = potential(p + vec3(0.0, e, 0.0), t) - potential(p - vec3(0.0, e, 0.0), t);
    vec3 dz = potential(p + vec3(0.0, 0.0, e), t) - potential(p - vec3(0.0, 0.0, e), t);
    return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / (2.0 * e);
  }

  vec3 rotateAxis(vec3 v, vec3 axis, float a) {
    float c = cos(a);
    float s = sin(a);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  void main() {
    vec3 dir = normalize(position);
    float shell = aShell;
    vec3 p = dir * shell;

    // Each particle orbits about its own tilted axis at its own pace: the
    // differential drift reads as a murmuration rather than a rigid ball.
    vec3 axis = normalize(vec3(aSeed.y - 0.5, 1.0, aSeed.z - 0.5));
    float rate = (0.25 + 0.6 * aSeed.x) * (aSeed.w > 0.5 ? 1.0 : -0.7);
    p = rotateAxis(p, axis, uTime * rate);

    // Vortex: twist the whole swarm about the vertical axis, faster at the equator.
    float twist = uSwirl * (1.6 - abs(p.y)) * uTime * 0.9;
    p = rotateAxis(p, vec3(0.0, 1.0, 0.0), twist);

    // Flow field wander.
    p += curl(p * 1.15, uWave) * uCurl * 0.22;

    float r = length(p);
    vec3 n = p / max(r, 0.001);

    // Breathing plus radius target.
    float breath = 1.0 + 0.045 * sin(uWave * 0.9 + aSeed.z * 1.5);
    float radial = uRadius * breath;

    // Listening: ripples travel outward, strength follows the live level.
    float ripple = sin(r * 7.0 - uWave * 5.5 + aSeed.x * 1.5) * uRipple * uLevel * 0.2;
    // Speaking: the whole swarm pulses with the level, with a wave over height.
    float pulse = uPulse * uLevel * (0.28 + 0.12 * sin(p.y * 5.0 - uWave * 6.0));

    p = n * (r * radial + ripple + pulse * r);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = -mv.z;
    gl_PointSize = (0.55 + aSeed.x * 1.1) * uScale / depth * (1.0 + uLevel * 0.35);

    vGlow = 1.0 - smoothstep(0.0, 1.0, length(p) / max(uRadius, 0.2));
    vMix = clamp(aSeed.y * 0.7 + length(p) * 0.25, 0.0, 1.0);
  }
`;

// No precision override here: three.js sets one for both stages, and a mismatch on the
// shared uLevel uniform makes the program fail to link.
const FRAG = /* glsl */ `
  uniform float uCore;
  uniform float uBright;
  uniform float uLevel;
  varying float vGlow;
  varying float vMix;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = pow(1.0 - d * 2.0, 2.0);

    vec3 deep = vec3(0.10, 0.32, 1.0);
    vec3 cyan = vec3(0.30, 0.90, 1.0);
    vec3 col = mix(deep, cyan, vMix);
    col += vec3(0.55, 0.8, 1.0) * vGlow * uCore * 0.9;
    col += vec3(0.2, 0.4, 0.5) * uLevel * 0.5;

    float alpha = soft * (0.85 + vGlow * uCore * 0.6) * uBright;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

function particleCount(size: number): number {
  if (typeof navigator === "undefined") return 2500;
  const cores = navigator.hardwareConcurrency || 4;
  const small = size < 110;
  if (small || cores <= 4) return 2500;
  if (cores <= 6) return 3500;
  return 5000;
}

export function JarvisOrb({
  state = "idle",
  level = 0,
  size = 160,
  className = "",
}: {
  state?: OrbState;
  // 0..1 live audio level (mic while listening, playback while speaking)
  level?: number;
  size?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<OrbState>(state);
  const levelRef = useRef(level);
  const sizeRef = useRef(size);
  const resizeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    levelRef.current = Math.min(1, Math.max(0, level));
  }, [level]);
  useEffect(() => {
    sizeRef.current = size;
    resizeRef.current?.();
  }, [size]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      return; // No WebGL: the CSS glow behind the canvas stays as the fallback.
    }

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dprCap = () => Math.min(window.devicePixelRatio || 1, 2);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
    camera.position.z = 3.7;

    const count = particleCount(sizeRef.current);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    const shells = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Uniform direction on a sphere.
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = s * Math.cos(th);
      positions[i * 3 + 1] = u;
      positions[i * 3 + 2] = s * Math.sin(th);
      // Mostly a loose shell, with some stragglers inside.
      shells[i] = 0.55 + Math.pow(Math.random(), 0.6) * 0.45;
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    geometry.setAttribute("aShell", new THREE.BufferAttribute(shells, 1));
    // Positions are shader driven, so skip CPU frustum culling.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);

    const T = TARGETS.idle;
    const uniforms = {
      uTime: { value: 0 },
      uWave: { value: 0 },
      uLevel: { value: 0 },
      uRadius: { value: T.radius },
      uCurl: { value: T.curl },
      uSwirl: { value: T.swirl },
      uRipple: { value: T.ripple },
      uPulse: { value: T.pulse },
      uCore: { value: T.core },
      uBright: { value: T.bright },
      uScale: { value: 16 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);

    const resize = () => {
      const px = sizeRef.current;
      const dpr = dprCap();
      renderer.setPixelRatio(dpr);
      renderer.setSize(px, px, false);
      uniforms.uScale.value = px * dpr * 0.11;
    };
    resizeRef.current = resize;
    resize();

    let visible = true;
    let onScreen = true;
    let raf = 0;
    let last = performance.now();
    let smoothLevel = 0;
    const timeScale = reduced ? 0.06 : 1;

    const tgtSpeed = { value: T.speed };
    const k = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const tgt = TARGETS[stateRef.current];
      const f = k(3.2, dt);
      uniforms.uRadius.value += (tgt.radius - uniforms.uRadius.value) * f;
      uniforms.uCurl.value += (tgt.curl - uniforms.uCurl.value) * f;
      uniforms.uSwirl.value += (tgt.swirl - uniforms.uSwirl.value) * f;
      uniforms.uRipple.value += (tgt.ripple - uniforms.uRipple.value) * f;
      uniforms.uPulse.value += (tgt.pulse - uniforms.uPulse.value) * f;
      uniforms.uCore.value += (tgt.core - uniforms.uCore.value) * f;
      uniforms.uBright.value += (tgt.bright - uniforms.uBright.value) * f;

      // Time is accumulated, not read from the clock, so changing speed never
      // makes the swarm jump.
      tgtSpeed.value += (tgt.speed - tgtSpeed.value) * f;
      const speed = tgtSpeed.value;
      uniforms.uTime.value += dt * speed * timeScale;
      uniforms.uWave.value += dt * (0.4 + speed) * timeScale;

      // Fast attack, slow release on the audio level.
      const raw = reduced ? levelRef.current * 0.3 : levelRef.current;
      smoothLevel += (raw - smoothLevel) * k(raw > smoothLevel ? 18 : 6, dt);
      uniforms.uLevel.value = smoothLevel;

      renderer.render(scene, camera);
    };
    const update = () => {
      const run = visible && onScreen;
      if (run && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onVis = () => {
      visible = document.visibilityState !== "hidden";
      update();
    };
    document.addEventListener("visibilitychange", onVis);
    visible = document.visibilityState !== "hidden";

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        update();
      });
      io.observe(host);
    }

    const onDprChange = () => resize();
    window.addEventListener("resize", onDprChange);

    update();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onDprChange);
      io?.disconnect();
      resizeRef.current = null;
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`relative shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(circle at 50% 50%, rgba(56,140,255,0.16) 0%, rgba(56,140,255,0.05) 45%, transparent 70%)",
      }}
      data-state={state}
      role="img"
      aria-label={`Jarvis is ${state}`}
    />
  );
}
