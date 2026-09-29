import { cn } from "./cn";
import { polarToCartesian, sectorIndex, sectorPath } from "./geometry";
import type { Tone } from "./status";

export interface RadarBlip {
  id: string | number;
  /** Bearing in degrees, 0 = north, clockwise. */
  angle: number;
  /** 0 = centre, 1 = outer ring. */
  distance: number;
  /** Accessible label ("Senior Cloud Security Engineer · Nordlicht Cloud · 86"). */
  label: string;
  href?: string;
  tone?: Extract<Tone, "acid" | "signal" | "radar" | "cobalt" | "stamp" | "lilac" | "paper" | "concrete">;
  /** Draw an expanding ping around it (new/attention). */
  ping?: boolean;
}

export interface RadarSweepProps {
  blips?: RadarBlip[];
  /** No rotation; arm parked at 40°. */
  static?: boolean;
  /** "console" = ink screen with green rings; "paper" = printed chart, ink lines. */
  surface?: "console" | "paper";
  /** Accessible description of the whole scope. */
  label?: string;
  /** Show N/E/S/W and degree ticks. Default true. */
  bearings?: boolean;
  className?: string;
}

const C = 100;
const R = 94;
const BLIP_FILL: Record<NonNullable<RadarBlip["tone"]>, string> = {
  acid: "fill-acid",
  signal: "fill-signal",
  radar: "fill-radar",
  cobalt: "fill-cobalt",
  stamp: "fill-stamp",
  lilac: "fill-lilac",
  paper: "fill-paper",
  concrete: "fill-concrete",
};

/** Stepped (not gradient) afterglow behind the sweep arm. */
const TRAIL = [
  { a0: -64, a1: -48, o: 0.06 },
  { a0: -48, a1: -34, o: 0.1 },
  { a0: -34, a1: -22, o: 0.16 },
  { a0: -22, a1: -12, o: 0.24 },
  { a0: -12, a1: -4, o: 0.34 },
  { a0: -4, a1: 0, o: 0.5 },
];

/**
 * Radar scope, hand-drawn SVG. Rings, ticks, a stepped sweep trail and square blips that
 * re-ignite as the arm passes (CSS sector timing, no inline styles). Motion stops under
 * prefers-reduced-motion. Blips with `href` are real links (keyboard reachable).
 */
export function RadarSweep({
  blips = [],
  static: isStatic = false,
  surface = "console",
  label = "Radar scope",
  bearings = true,
  className,
}: RadarSweepProps) {
  const consoleMode = surface === "console";
  const line = consoleMode ? "stroke-radar" : "stroke-ink";
  const interactive = blips.some((b) => b.href);

  return (
    <svg
      viewBox="0 0 200 200"
      className={cn("block aspect-square h-auto w-full select-none", className)}
      role={interactive ? "group" : "img"}
      aria-label={blips.length ? `${label}: ${blips.length} ${blips.length === 1 ? "blip" : "blips"}` : label}
    >
      {!interactive ? <title>{label}</title> : null}
      {/* Screen */}
      <rect
        x={C - R - 4}
        y={C - R - 4}
        width={(R + 4) * 2}
        height={(R + 4) * 2}
        className={consoleMode ? "fill-ink" : "fill-card"}
      />
      <circle cx={C} cy={C} r={R} className={cn(consoleMode ? "fill-ink" : "fill-paper", "stroke-ink")} strokeWidth={3} />

      <g className={line} fill="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} cx={C} cy={C} r={R * f} strokeWidth={1.25} strokeOpacity={consoleMode ? 0.45 : 0.35} strokeDasharray={f === 0.5 ? "3 3" : undefined} />
        ))}
        <circle cx={C} cy={C} r={R - 1.5} strokeWidth={2} strokeOpacity={consoleMode ? 0.8 : 0.9} />
        <line x1={C} y1={C - R} x2={C} y2={C + R} strokeWidth={1} strokeOpacity={0.35} />
        <line x1={C - R} y1={C} x2={C + R} y2={C} strokeWidth={1} strokeOpacity={0.35} />
        {bearings
          ? Array.from({ length: 72 }, (_, i) => {
              const a = i * 5;
              const major = a % 45 === 0;
              const mid = a % 15 === 0;
              const len = major ? 9 : mid ? 5 : 2.5;
              const p0 = polarToCartesian(C, C, R - 2, a);
              const p1 = polarToCartesian(C, C, R - 2 - len, a);
              return (
                <line
                  key={a}
                  x1={p0.x}
                  y1={p0.y}
                  x2={p1.x}
                  y2={p1.y}
                  strokeWidth={major ? 2.25 : 1.25}
                  strokeOpacity={major ? 0.95 : 0.6}
                  strokeLinecap="square"
                />
              );
            })
          : null}
      </g>

      {bearings ? (
        <g
          aria-hidden="true"
          className={cn("font-mono font-bold", consoleMode ? "fill-radar" : "fill-ink")}
          fontSize={8}
          textAnchor="middle"
          dominantBaseline="central"
        >
          <text x={C} y={C - R + 17}>N</text>
          <text x={C + R - 17} y={C}>E</text>
          <text x={C} y={C + R - 17}>S</text>
          <text x={C - R + 17} y={C}>W</text>
        </g>
      ) : null}

      {/* Sweep arm */}
      <g className={isStatic ? undefined : "radar-arm"} transform={isStatic ? `rotate(40 ${C} ${C})` : undefined} aria-hidden="true">
        {TRAIL.map((t) => (
          <path
            key={t.a0}
            d={sectorPath(C, C, R - 3, t.a0, t.a1)}
            className={consoleMode ? "fill-radar" : "fill-ink"}
            fillOpacity={consoleMode ? t.o : t.o * 0.55}
          />
        ))}
        <line x1={C} y1={C} x2={C} y2={C - R + 3} className={consoleMode ? "stroke-radar" : "stroke-ink"} strokeWidth={2.5} strokeLinecap="square" />
      </g>

      {/* Blips */}
      {blips.map((b) => {
        const d = Math.max(0, Math.min(1, b.distance));
        const p = polarToCartesian(C, C, 8 + d * (R - 16), b.angle);
        const size = 7;
        const fill = BLIP_FILL[b.tone ?? (consoleMode ? "acid" : "signal")];
        const sector = String(sectorIndex(b.angle));
        const shape = (
          <>
            {b.ping ? (
              <rect
                x={p.x - size / 2}
                y={p.y - size / 2}
                width={size}
                height={size}
                fill="none"
                className={cn("radar-ping", consoleMode ? "stroke-acid" : "stroke-ink")}
                strokeWidth={1.5}
              />
            ) : null}
            <rect
              x={p.x - size / 2}
              y={p.y - size / 2}
              width={size}
              height={size}
              data-sector={isStatic ? undefined : sector}
              className={cn(fill, "stroke-ink", !isStatic && "radar-blip")}
              strokeWidth={1.75}
            />
            <rect
              x={p.x - size / 2 - 4}
              y={p.y - size / 2 - 4}
              width={size + 8}
              height={size + 8}
              fill="none"
              className={cn(
                "stroke-transparent",
                consoleMode
                  ? "group-hover:stroke-acid group-focus-visible:stroke-acid"
                  : "group-hover:stroke-cobalt-deep group-focus-visible:stroke-cobalt-deep",
              )}
              strokeWidth={2.5}
            />
          </>
        );
        if (b.href) {
          return (
            <a key={b.id} href={b.href} aria-label={b.label} className="group outline-none">
              <title>{b.label}</title>
              {/* Enlarged invisible hit area for touch. */}
              <rect x={p.x - 11} y={p.y - 11} width={22} height={22} fill="transparent" />
              {shape}
            </a>
          );
        }
        return (
          <g key={b.id} aria-hidden="true">
            {shape}
          </g>
        );
      })}

      {/* Hub */}
      <rect x={C - 4} y={C - 4} width={8} height={8} className={consoleMode ? "fill-radar stroke-ink" : "fill-ink"} strokeWidth={1.5} aria-hidden="true" />
    </svg>
  );
}
