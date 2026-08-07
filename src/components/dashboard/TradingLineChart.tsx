"use client";

import { useMemo, useRef, useState } from "react";

// Lightweight SVG line chart for the trading dashboard (client-side, no chart
// library). Series colors come from the validated light-mode palette used
// across dashboards: blue #2a78d6, orange #eb6834. Chrome ink follows the
// zinc admin aesthetic.

export type SeriesPoint = { t: number; v: number };

export type ChartSeries = {
  name: string;
  color: string;
  points: SeriesPoint[];
  // When set, the area between the line and `fillTo` is shaded. Used by the
  // underwater plot, where the depth of the shading is the whole point.
  fill?: string;
  fillTo?: number;
};

type Props = {
  series: ChartSeries[];
  height?: number;
  // Horizontal reference line, e.g. a 100% margin level threshold
  referenceLine?: { value: number; label: string; color: string };
  valueFormat?: "money" | "percent";
  currency?: string;
  compact?: boolean; // sparkline mode: no axes, grid, legend or tooltip
};

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Lagos",
});
const timeFmtFull = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
  timeZone: "Africa/Lagos",
});
const numFmt = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numFmtShort = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
});

export default function TradingLineChart({
  series,
  height = 240,
  referenceLine,
  valueFormat = "money",
  currency = "",
  compact = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const width = 720; // viewBox units; scales responsively via CSS
  const pad = compact
    ? { top: 4, right: 4, bottom: 4, left: 4 }
    : { top: 12, right: 16, bottom: 26, left: 56 };

  const { tMin, tMax, vMin, vMax } = useMemo(() => {
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.t < tMin) tMin = p.t;
        if (p.t > tMax) tMax = p.t;
        if (p.v < vMin) vMin = p.v;
        if (p.v > vMax) vMax = p.v;
      }
    }
    if (referenceLine) {
      if (referenceLine.value < vMin) vMin = referenceLine.value;
      if (referenceLine.value > vMax) vMax = referenceLine.value;
    }
    if (!Number.isFinite(tMin)) {
      tMin = 0;
      tMax = 1;
      vMin = 0;
      vMax = 1;
    }
    if (vMax === vMin) {
      vMax += 1;
      vMin -= 1;
    }
    const span = vMax - vMin;
    return { tMin, tMax, vMin: vMin - span * 0.06, vMax: vMax + span * 0.06 };
  }, [series, referenceLine]);

  const x = (t: number) =>
    pad.left +
    ((t - tMin) / Math.max(1, tMax - tMin)) * (width - pad.left - pad.right);
  const y = (v: number) =>
    pad.top + (1 - (v - vMin) / (vMax - vMin)) * (height - pad.top - pad.bottom);

  const paths = useMemo(
    () =>
      series.map((s) => {
        const d = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
          .join("");
        let area: string | null = null;
        if (s.fill && s.points.length > 1) {
          const base = y(s.fillTo ?? 0).toFixed(1);
          const first = s.points[0];
          const last = s.points[s.points.length - 1];
          area = `${d}L${x(last.t).toFixed(1)},${base}L${x(first.t).toFixed(1)},${base}Z`;
        }
        return { ...s, d, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, tMin, tMax, vMin, vMax],
  );

  const yTicks = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => vMin + ((vMax - vMin) * i) / n);
  }, [vMin, vMax]);

  const xTicks = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / n);
  }, [tMin, tMax]);

  const fmtVal = (v: number) =>
    valueFormat === "percent"
      ? `${numFmtShort.format(v)}%`
      : `${numFmt.format(v)}${currency ? ` ${currency}` : ""}`;
  const fmtAxisVal = (v: number) =>
    valueFormat === "percent" ? `${numFmtShort.format(v)}%` : numFmtShort.format(v);

  // Nearest points to the hovered time, one per series
  const hover = useMemo(() => {
    if (hoverX === null) return null;
    const t =
      tMin + ((hoverX - pad.left) / Math.max(1, width - pad.left - pad.right)) * (tMax - tMin);
    const picks = series
      .map((s) => {
        if (s.points.length === 0) return null;
        let best = s.points[0];
        for (const p of s.points) {
          if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
        }
        return { name: s.name, color: s.color, point: best };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (picks.length === 0) return null;
    return { t: picks[0].point.t, picks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverX, series, tMin, tMax]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (compact) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < pad.left || px > width - pad.right) {
      setHoverX(null);
      return;
    }
    setHoverX(px);
  };

  const hasData = series.some((s) => s.points.length > 1);
  if (!hasData) {
    return (
      <div
        className="grid place-items-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400"
        style={{ height }}
      >
        Not enough data yet. Charts fill in as the Reporter EA posts.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        style={{ height: "auto" }}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverX(null)}
        role="img"
        aria-label={series.map((s) => s.name).join(", ")}
      >
        {!compact &&
          yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(v)}
                y2={y(v)}
                stroke="#e4e4e7"
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y(v) + 3.5}
                textAnchor="end"
                fontSize={11}
                fill="#898781"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtAxisVal(v)}
              </text>
            </g>
          ))}
        {!compact &&
          xTicks.map((t, i) => (
            <text
              key={i}
              x={x(t)}
              y={height - 8}
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
              fontSize={11}
              fill="#898781"
            >
              {timeFmt.format(t)}
            </text>
          ))}

        {referenceLine && (
          <g>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(referenceLine.value)}
              y2={y(referenceLine.value)}
              stroke={referenceLine.color}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={width - pad.right}
              y={y(referenceLine.value) - 5}
              textAnchor="end"
              fontSize={11}
              fill={referenceLine.color}
            >
              {referenceLine.label}
            </text>
          </g>
        )}

        {paths.map((s) =>
          s.area ? (
            <path key={`${s.name}-area`} d={s.area} fill={s.fill} stroke="none" />
          ) : null,
        )}

        {paths.map((s) => (
          <path
            key={s.name}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hover && !compact && (
          <g>
            <line
              x1={x(hover.t)}
              x2={x(hover.t)}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke="#c3c2b7"
              strokeWidth={1}
            />
            {hover.picks.map((p) => (
              <circle
                key={p.name}
                cx={x(p.point.t)}
                cy={y(p.point.v)}
                r={4}
                fill={p.color}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>

      {hover && !compact && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm"
          style={
            x(hover.t) > width * 0.6
              ? { right: `${100 - (x(hover.t) / width) * 100 + 2}%` }
              : { left: `${(x(hover.t) / width) * 100 + 2}%` }
          }
        >
          <div className="font-medium text-zinc-900">{timeFmtFull.format(hover.t)}</div>
          {hover.picks.map((p) => (
            <div key={p.name} className="mt-1 flex items-center gap-2 text-zinc-600">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span>{p.name}</span>
              <span
                className="ml-auto pl-3 font-medium text-zinc-900"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtVal(p.point.v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {!compact && series.length > 1 && (
        <div className="mt-2 flex items-center gap-4 text-xs text-zinc-600">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
