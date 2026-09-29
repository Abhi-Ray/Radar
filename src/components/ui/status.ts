/**
 * Shared UI vocabulary: tones, and the display metadata for every status the
 * product shows (visa, eligibility, provenance method, confidence, fit band).
 *
 * The status unions mirror the contracts in `@/lib/contracts/*` (string literal unions are
 * structurally identical), so values straight from the DB can be passed in.
 */

export type Tone =
  | "ink"
  | "paper"
  | "card"
  | "acid"
  | "signal"
  | "radar"
  | "cobalt"
  | "stamp"
  | "lilac"
  | "concrete";

export const TONES: readonly Tone[] = [
  "ink",
  "paper",
  "card",
  "acid",
  "signal",
  "radar",
  "cobalt",
  "stamp",
  "lilac",
  "concrete",
];

/** Solid fill + an AA-safe text colour. */
export const TONE_SOLID: Record<Tone, string> = {
  ink: "bg-ink text-paper",
  paper: "bg-paper text-ink",
  card: "bg-card text-ink",
  acid: "bg-acid text-ink",
  signal: "bg-signal text-ink",
  radar: "bg-radar text-ink",
  cobalt: "bg-cobalt text-white",
  stamp: "bg-stamp-deep text-white",
  lilac: "bg-lilac text-ink",
  concrete: "bg-concrete text-ink",
};

/** Pale tint fill, ink text. */
export const TONE_TINT: Record<Tone, string> = {
  ink: "bg-concrete text-ink",
  paper: "bg-paper text-ink",
  card: "bg-card text-ink",
  acid: "bg-acid-tint text-ink",
  signal: "bg-signal-tint text-ink",
  radar: "bg-radar-tint text-ink",
  cobalt: "bg-cobalt-tint text-ink",
  stamp: "bg-stamp-tint text-ink",
  lilac: "bg-lilac-tint text-ink",
  concrete: "bg-concrete text-ink",
};

/** Text colour that passes AA on paper/card. */
export const TONE_TEXT: Record<Tone, string> = {
  ink: "text-ink",
  paper: "text-ink",
  card: "text-ink",
  acid: "text-acid-deep",
  signal: "text-signal-deep",
  radar: "text-radar-deep",
  cobalt: "text-cobalt-deep",
  stamp: "text-stamp-deep",
  lilac: "text-lilac-deep",
  concrete: "text-muted",
};

/** Border colour (fills can use the bright hue; borders use deep hues so they read on paper). */
export const TONE_BORDER: Record<Tone, string> = {
  ink: "border-ink",
  paper: "border-ink",
  card: "border-ink",
  acid: "border-acid-deep",
  signal: "border-signal-deep",
  radar: "border-radar-deep",
  cobalt: "border-cobalt-deep",
  stamp: "border-stamp-deep",
  lilac: "border-lilac-deep",
  concrete: "border-concrete-deep",
};

/** SVG fill/stroke classes (bright hue, used on ink or paper backgrounds). */
export const TONE_FILL: Record<Tone, string> = {
  ink: "fill-ink",
  paper: "fill-paper",
  card: "fill-card",
  acid: "fill-acid",
  signal: "fill-signal",
  radar: "fill-radar",
  cobalt: "fill-cobalt",
  stamp: "fill-stamp",
  lilac: "fill-lilac",
  concrete: "fill-concrete",
};

export const TONE_STROKE: Record<Tone, string> = {
  ink: "stroke-ink",
  paper: "stroke-paper",
  card: "stroke-card",
  acid: "stroke-acid",
  signal: "stroke-signal",
  radar: "stroke-radar",
  cobalt: "stroke-cobalt",
  stamp: "stroke-stamp",
  lilac: "stroke-lilac",
  concrete: "stroke-concrete",
};

/* ---------------- Visa ---------------- */

export type VisaStatus = "confirmed" | "likely" | "unknown" | "not_offered" | "conflicting";
export const VISA_STATUSES: readonly VisaStatus[] = ["confirmed", "likely", "unknown", "not_offered", "conflicting"];

export interface StatusMeta {
  label: string;
  /** Word(s) printed inside a stamp. */
  stamp: string;
  tone: Tone;
  /** One-line honest explanation shown in tooltips / legends. */
  blurb: string;
}

export const VISA_META: Record<VisaStatus, StatusMeta> = {
  confirmed: {
    label: "Confirmed",
    stamp: "Confirmed",
    tone: "radar",
    blurb: "Official register match or an explicit statement from the posting or the company.",
  },
  likely: {
    label: "Likely",
    stamp: "Likely",
    tone: "cobalt",
    blurb: "Company has sponsorship history, or the posting mentions relocation support.",
  },
  unknown: {
    label: "Unknown",
    stamp: "Unknown",
    tone: "concrete",
    blurb: "No evidence either way. This is the honest default.",
  },
  not_offered: {
    label: "Not offered",
    stamp: "Not offered",
    tone: "stamp",
    blurb: "The posting says sponsorship is not available or right to work is required.",
  },
  conflicting: {
    label: "Conflicting",
    stamp: "Conflict",
    tone: "signal",
    blurb: "Evidence disagrees. Both sides are shown for you to judge.",
  },
};

/* ---------------- Eligibility ---------------- */

export type EligibilityResult = "meets" | "borderline" | "doesnt_meet" | "cant_tell";
export const ELIGIBILITY_RESULTS: readonly EligibilityResult[] = ["meets", "borderline", "doesnt_meet", "cant_tell"];

export const ELIGIBILITY_META: Record<EligibilityResult, StatusMeta> = {
  meets: { label: "Meets", stamp: "Meets", tone: "radar", blurb: "Your profile clears the country rule." },
  borderline: {
    label: "Borderline",
    stamp: "Borderline",
    tone: "signal",
    blurb: "Clears the rule with a thin margin, or one criterion is uncertain.",
  },
  doesnt_meet: {
    label: "Doesn't meet",
    stamp: "Doesn't meet",
    tone: "stamp",
    blurb: "Falls below the rule (e.g. salary under the threshold).",
  },
  cant_tell: {
    label: "Can't tell",
    stamp: "Can't tell",
    tone: "concrete",
    blurb: "Missing salary or no verified rule to compare against.",
  },
};

/* ---------------- Provenance method ---------------- */

export type MethodKind = "manual" | "official" | "posting" | "rule" | "ai" | "estimate";
/** Trust order, index 0 = highest. Mirrors TRUST_ORDER in the provenance contract. */
export const METHOD_ORDER: readonly MethodKind[] = ["manual", "official", "posting", "rule", "ai", "estimate"];

export interface MethodMeta {
  label: string;
  long: string;
  description: string;
}

export const METHOD_META: Record<MethodKind, MethodMeta> = {
  manual: { label: "Manual", long: "Manual (you)", description: "Your own correction or note. Highest trust." },
  official: { label: "Official", long: "Official record", description: "Government register or official page." },
  posting: { label: "Posting", long: "Posting says", description: "Explicit statement in the job posting." },
  rule: { label: "Rule", long: "Rule-based", description: "Detected by a versioned rule." },
  ai: { label: "AI", long: "AI-extracted", description: "Extracted by AI with a verified quote. Never beats a rule or record." },
  estimate: { label: "Estimate", long: "Estimated", description: "Country/role average. Not stated anywhere." },
};

/* ---------------- Confidence ---------------- */

export type ConfidenceLevel = "high" | "medium" | "low";
export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ["high", "medium", "low"];

export const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; blocks: 1 | 2 | 3 }> = {
  high: { label: "High", blocks: 3 },
  medium: { label: "Medium", blocks: 2 },
  low: { label: "Low", blocks: 1 },
};

/* ---------------- Fit score ---------------- */

export type FitBandKey = "strong" | "good" | "fair" | "weak" | "none";

export interface FitBand {
  band: FitBandKey;
  label: string;
  tone: Tone;
}

/** 80+ strong, 60+ good, 40+ fair, otherwise weak; null/NaN = not scored. */
export function fitBand(score: number | null | undefined): FitBand {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return { band: "none", label: "Unscored", tone: "concrete" };
  }
  const s = clampScore(score);
  if (s >= 80) return { band: "strong", label: "Strong fit", tone: "radar" };
  if (s >= 60) return { band: "good", label: "Good fit", tone: "acid" };
  if (s >= 40) return { band: "fair", label: "Fair fit", tone: "signal" };
  return { band: "weak", label: "Weak fit", tone: "concrete" };
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ---------------- Guards ---------------- */

function oneOf<T extends string>(list: readonly T[]) {
  return (v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
}

export const isVisaStatus = oneOf(VISA_STATUSES);
export const isEligibilityResult = oneOf(ELIGIBILITY_RESULTS);
export const isMethodKind = oneOf(METHOD_ORDER);
export const isConfidenceLevel = oneOf(CONFIDENCE_LEVELS);
export const isTone = oneOf(TONES);

/** Anything unrecognised becomes "unknown" — never a guess. */
export function toVisaStatus(v: unknown): VisaStatus {
  return isVisaStatus(v) ? v : "unknown";
}

export function toEligibility(v: unknown): EligibilityResult {
  return isEligibilityResult(v) ? v : "cant_tell";
}
