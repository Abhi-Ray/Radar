/**
 * Pure geometry for the hand-made SVG components (radar, gauge, sparkline, bars, blocks).
 * Angles are in degrees, 0 = north (12 o'clock), increasing clockwise.
 */

/** FNV-1a 32-bit hash — deterministic, for placing blips and tilting stamps. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const round = (n: number, p = 2) => {
  const f = 10 ** p;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

export function normalizeAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: round(cx + r * Math.cos(rad)), y: round(cy + r * Math.sin(rad)) };
}

/** Wedge from the centre, a0 → a1 clockwise. */
export function sectorPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = Math.min(359.99, Math.max(0, a1 - a0));
  const start = polarToCartesian(cx, cy, r, a0);
  const end = polarToCartesian(cx, cy, r, a0 + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M${cx} ${cy} L${start.x} ${start.y} A${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

/** Ring segment between two radii, a0 → a1 clockwise. */
export function annularSectorPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const sweep = Math.min(359.99, Math.max(0, a1 - a0));
  const large = sweep > 180 ? 1 : 0;
  const o0 = polarToCartesian(cx, cy, rOuter, a0);
  const o1 = polarToCartesian(cx, cy, rOuter, a0 + sweep);
  const i1 = polarToCartesian(cx, cy, rInner, a0 + sweep);
  const i0 = polarToCartesian(cx, cy, rInner, a0);
  return [
    `M${o0.x} ${o0.y}`,
    `A${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y}`,
    `L${i1.x} ${i1.y}`,
    `A${rInner} ${rInner} 0 ${large} 0 ${i0.x} ${i0.y}`,
    "Z",
  ].join(" ");
}

/** Which of `sectors` equal slices an angle falls in (for CSS-driven blip timing). */
export function sectorIndex(angleDeg: number, sectors = 24): number {
  return Math.floor(normalizeAngle(angleDeg) / (360 / sectors)) % sectors;
}

/* ---------------- Sparkline / bars ---------------- */

export interface SparkGeometry {
  d: string;
  points: { x: number; y: number; value: number }[];
  min: number;
  max: number;
  /** y for an arbitrary value on the same scale (for baseline bands). */
  yFor: (value: number) => number;
}

/**
 * Polyline path for a sparkline in a `width × height` box with `pad` inset.
 * Non-finite values are skipped (gaps start a new sub-path). Domain can be forced to include
 * extra values (e.g. a baseline band) via `include`.
 */
export function sparkline(
  values: readonly (number | null | undefined)[],
  width: number,
  height: number,
  pad = 3,
  include: readonly number[] = [],
): SparkGeometry {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const domain = [...finite, ...include.filter(Number.isFinite)];
  const min = domain.length ? Math.min(...domain) : 0;
  const max = domain.length ? Math.max(...domain) : 1;
  const span = max - min || 1;
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const yFor = (v: number) => round(pad + innerH - ((v - min) / span) * innerH);
  const points: SparkGeometry["points"] = [];
  let d = "";
  let penDown = false;
  values.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      penDown = false;
      return;
    }
    const x = round(values.length > 1 ? pad + i * stepX : width / 2);
    const y = max === min ? round(pad + innerH / 2) : yFor(v);
    points.push({ x, y, value: v });
    d += `${penDown ? "L" : "M"}${x} ${y} `;
    penDown = true;
  });
  return { d: d.trim(), points, min, max, yFor };
}

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

/** Evenly spaced bars from a zero baseline; negative/non-finite values render as 0 height. */
export function barRects(values: readonly number[], width: number, height: number, gap = 2, maxValue?: number): BarRect[] {
  const n = values.length;
  if (n === 0) return [];
  const max = maxValue ?? Math.max(0, ...values.filter(Number.isFinite));
  const barW = Math.max(1, (width - gap * (n - 1)) / n);
  return values.map((raw, i) => {
    const v = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const h = max > 0 ? (Math.min(v, max) / max) * height : 0;
    // Non-zero values always get at least 1.5px so "tiny" is distinguishable from "none".
    const hh = v > 0 ? Math.max(1.5, h) : 0;
    return { x: round(i * (barW + gap)), y: round(height - hh), width: round(barW), height: round(hh), value: v };
  });
}

/* ---------------- Blocks ---------------- */

export type BlockState = "full" | "partial" | "empty";

/** Split value/max into `blocks` cells: full, one partial (if any remainder), then empty. */
export function blockFill(value: number, max: number, blocks = 10): BlockState[] {
  const n = Math.max(1, Math.floor(blocks));
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return Array(n).fill("empty");
  const ratio = Math.max(0, Math.min(1, value / max));
  const exact = ratio * n;
  const full = Math.floor(exact + 1e-9);
  const hasPartial = exact - full > 1e-9 && full < n;
  return Array.from({ length: n }, (_, i): BlockState => {
    if (i < full) return "full";
    if (i === full && hasPartial) return "partial";
    return "empty";
  });
}

/* ---------------- Radar blips ---------------- */

export interface BlipSeed {
  id: string | number;
  /** Stable key that decides the bearing (e.g. country or company). Defaults to id. */
  key?: string;
  /** 0–100; higher = closer to the centre. null = parked on the outer ring. */
  score?: number | null;
}

export interface PlacedBlip {
  id: string | number;
  angle: number;
  distance: number;
}

/**
 * Deterministic blip placement: bearing from the key's hash, range from the score
 * (score 100 → 0.12 from centre, score 0 → 0.95). Near-identical positions are nudged apart.
 */
export function placeBlips(items: readonly BlipSeed[]): PlacedBlip[] {
  const placed: PlacedBlip[] = [];
  for (const item of items) {
    const key = item.key ?? String(item.id);
    let angle = hashString(`${key}`) % 360;
    // Jitter within the key's bearing using the id so same-key items fan out.
    angle = normalizeAngle(angle + ((hashString(String(item.id)) % 31) - 15));
    const s = item.score;
    const distance = typeof s === "number" && Number.isFinite(s) ? 0.12 + (1 - Math.max(0, Math.min(100, s)) / 100) * 0.83 : 0.95;
    let a = angle;
    for (let tries = 0; tries < 12; tries++) {
      const clash = placed.some(
        (p) => Math.abs(p.distance - distance) < 0.08 && angularDistance(p.angle, a) < 9,
      );
      if (!clash) break;
      a = normalizeAngle(a + 11);
    }
    placed.push({ id: item.id, angle: round(a, 1), distance: round(distance, 3) });
  }
  return placed;
}

export function angularDistance(a: number, b: number): number {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return d > 180 ? 360 - d : d;
}

/** Pick one of `n` variants deterministically from a seed string. */
export function pickVariant(seed: string, n: number): number {
  return n <= 1 ? 0 : hashString(seed) % n;
}
