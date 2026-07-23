import { PROGRAM_WEEKS, monthOfWeek } from "@/lib/mentorship/constants";

// 13-dot journey strip: past weeks lit, current week pulsing, future dim.
// checkedWeeks lights a small tick under weeks with a submitted check-in.
export function WeekStrip({
  currentWeek,
  checkedWeeks,
}: {
  currentWeek: number;
  checkedWeeks: number[];
}) {
  const checked = new Set(checkedWeeks);

  return (
    <div>
      <div className="flex items-center justify-between gap-1">
        {Array.from({ length: PROGRAM_WEEKS }, (_, i) => i + 1).map((w) => {
          const isPast = currentWeek > w;
          const isNow = currentWeek === w;
          return (
            <div key={w} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                title={`Week ${w}`}
                className={`h-2.5 w-2.5 rounded-full transition-colors ${
                  isNow
                    ? "pulse-ring bg-accent"
                    : isPast
                      ? "bg-accent/70"
                      : "bg-white/15"
                }`}
              />
              <span
                className={`text-[9px] leading-none ${
                  isNow ? "font-bold text-accent" : "text-zinc-600"
                }`}
              >
                {w}
              </span>
              <span
                className={`h-1 w-1 rounded-full ${
                  checked.has(w) ? "bg-emerald-400" : "bg-transparent"
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <span className={monthOfWeek(Math.max(1, currentWeek)) === 1 ? "text-accent" : ""}>
          Discovery
        </span>
        <span className={monthOfWeek(Math.max(1, currentWeek)) === 2 ? "text-accent" : ""}>
          Build
        </span>
        <span className={monthOfWeek(Math.max(1, currentWeek)) === 3 ? "text-accent" : ""}>
          Deliver
        </span>
      </div>
    </div>
  );
}
