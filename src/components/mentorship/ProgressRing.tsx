// Animated SVG progress ring (server-safe: pure markup + CSS animation).
export function ProgressRing({
  pct,
  size = 120,
  label,
}: {
  pct: number;
  size?: number;
  label?: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Programme progress ${clamped}%`}
      >
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="color-mix(in oklab, white 10%, transparent)"
          strokeWidth={stroke}
        />
        <circle
          className="ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={
            {
              "--ring-circumference": `${c}`,
              "--ring-offset": `${offset}`,
            } as React.CSSProperties
          }
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-white">
            {clamped}%
          </p>
          {label ? <p className="text-[10px] text-zinc-500">{label}</p> : null}
        </div>
      </div>
    </div>
  );
}
