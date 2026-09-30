/**
 * Before/after diff for the audit trail (pure, client-safe). Walks two JSON values and lists the
 * leaf paths that were added, removed or changed. Arrays of scalars are compared as a whole
 * (a changed tag list reads better as one line than as index shuffles).
 */

export type DiffKind = "added" | "removed" | "changed";

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isScalarArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function join(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${key}]`;
  const safe = /^[A-Za-z_$][\w$-]*$/.test(key) ? key : JSON.stringify(key);
  return base ? `${base}.${safe}` : safe;
}

/**
 * Leaf-level diff. `maxEntries` caps the output (huge payloads); the last entry then says how many
 * were left out (path "…").
 */
export function jsonDiff(before: unknown, after: unknown, maxEntries = 200): DiffEntry[] {
  const out: DiffEntry[] = [];
  let skipped = 0;
  const push = (e: DiffEntry) => {
    if (out.length < maxEntries) out.push(e);
    else skipped++;
  };
  const walk = (a: unknown, b: unknown, path: string) => {
    if (same(a, b)) return;
    if (a === undefined) return push({ path: path || "(value)", kind: "added", after: b });
    if (b === undefined) return push({ path: path || "(value)", kind: "removed", before: a });
    if (isObject(a) && isObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const k of keys) walk(a[k], b[k], join(path, k));
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && !(isScalarArray(a) && isScalarArray(b))) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) walk(i < a.length ? a[i] : undefined, i < b.length ? b[i] : undefined, join(path, i));
      return;
    }
    push({ path: path || "(value)", kind: "changed", before: a, after: b });
  };
  walk(before ?? undefined, after ?? undefined, "");
  if (skipped > 0) out.push({ path: "…", kind: "changed", before: null, after: `${skipped} more change${skipped === 1 ? "" : "s"} not shown` });
  return out;
}

/** Compact one-line rendering of a JSON value for the diff table. */
export function showValue(v: unknown, max = 160): string {
  if (v === undefined) return "—";
  let s: string;
  if (typeof v === "string") s = v;
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Pretty JSON for the raw before/after panes (bounded so a huge row cannot swamp the page). */
export function prettyJson(v: unknown, max = 20_000): string {
  if (v === null || v === undefined) return "—";
  let s: string;
  try {
    s = JSON.stringify(v, null, 2);
  } catch {
    s = String(v);
  }
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
}
