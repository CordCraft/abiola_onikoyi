"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
} from "d3-force";

export type GraphNode = {
  id: string;
  label: string;
  type: "venture" | "project" | "document" | "decision" | "goal";
  href?: string;
};
export type GraphLink = { source: string; target: string };

type SimNode = SimulationNodeDatum & GraphNode;

const NODE_STYLE: Record<GraphNode["type"], { r: number; fill: string }> = {
  venture: { r: 16, fill: "#4f46e5" },
  project: { r: 12, fill: "#10b981" },
  document: { r: 7, fill: "#0ea5e9" },
  decision: { r: 7, fill: "#8b5cf6" },
  goal: { r: 10, fill: "#f59e0b" },
};

const W = 900;
const H = 620;

// Force-directed map of the knowledge base. Click any node to open it.
export function GraphView({ nodes, links }: { nodes: GraphNode[]; links: GraphLink[] }) {
  const router = useRouter();
  const [positions, setPositions] = useState<SimNode[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const linkPairs = useMemo(() => links, [links]);

  useEffect(() => {
    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const sim = forceSimulation(simNodes)
      .force(
        "link",
        forceLink<SimNode, { source: string; target: string }>(
          linkPairs.map((l) => ({ ...l })),
        )
          .id((d) => d.id)
          .distance(70)
          .strength(0.5),
      )
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => NODE_STYLE[d.type].r + 10))
      .stop();

    // Run the layout to convergence (node counts are small), then publish the
    // positions asynchronously so the effect never sets state synchronously.
    for (let i = 0; i < 250; i++) sim.tick();
    const t = setTimeout(() => setPositions([...simNodes]), 0);
    return () => {
      clearTimeout(t);
      sim.stop();
    };
  }, [nodes, linkPairs]);

  const byId = useMemo(() => {
    const m = new Map<string, SimNode>();
    for (const n of positions ?? []) m.set(n.id, n);
    return m;
  }, [positions]);

  if (!positions) {
    return (
      <div className="grid h-[420px] place-items-center text-sm text-zinc-400">
        Laying out the graph...
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[640px]" role="img" aria-label="Knowledge graph">
        {linkPairs.map((l, i) => {
          const a = byId.get(l.source);
          const b = byId.get(l.target);
          if (!a || !b) return null;
          const active = hover === l.source || hover === l.target;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? "#6366f1" : "#d4d4d8"}
              strokeWidth={active ? 1.6 : 1}
              opacity={hover && !active ? 0.25 : 0.8}
            />
          );
        })}
        {positions.map((n) => {
          const s = NODE_STYLE[n.type];
          const dim = hover !== null && hover !== n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className={n.href ? "cursor-pointer" : undefined}
              opacity={dim ? 0.45 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => n.href && router.push(n.href)}
            >
              <circle r={s.r} fill={s.fill} fillOpacity={0.9} stroke="white" strokeWidth={1.5} />
              <text
                y={s.r + 11}
                textAnchor="middle"
                className="pointer-events-none select-none fill-zinc-600"
                fontSize={n.type === "venture" || n.type === "project" ? 11 : 9}
                fontWeight={n.type === "venture" || n.type === "project" ? 600 : 400}
              >
                {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
        {Object.entries(NODE_STYLE).map(([type, s]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.fill }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
