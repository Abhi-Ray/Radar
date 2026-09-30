/**
 * Desk radar: top jobs as blips. Range = fit (strong fits sit near the hub), bearing = region
 * (each region owns a fixed 36° sector so the scope reads like a map), tone = visa status.
 * Pure; the accessible list next to the scope is built from the same placement.
 */
import type { RadarBlip } from "@/components/ui/RadarSweep";
import { angularDistance, hashString, normalizeAngle } from "@/components/ui/geometry";
import { VISA_META, isVisaStatus } from "@/components/ui/status";

export interface RegionSector {
  key: string;
  label: string;
  /** Short label for the scope legend. */
  short: string;
  countries: readonly string[];
}

/** Clockwise from north. The last one catches jobs without a (known) country. */
export const REGION_SECTORS: readonly RegionSector[] = [
  { key: "dach", label: "DACH & Benelux", short: "DACH·BNL", countries: ["DE", "AT", "CH", "NL", "BE", "LU"] },
  { key: "nordics", label: "Nordics & Baltics", short: "NORDIC", countries: ["DK", "SE", "FI", "NO", "IS", "EE", "LT", "LV"] },
  { key: "cee", label: "Central & Eastern Europe", short: "CEE", countries: ["CZ", "PL", "SI", "RO", "HU", "HR", "SK", "BG"] },
  { key: "mideast", label: "Middle East", short: "ME", countries: ["AE", "IL", "SA", "QA"] },
  { key: "apac", label: "Asia-Pacific", short: "APAC", countries: ["SG", "JP", "KR", "HK", "TW", "MY", "AU", "NZ"] },
  { key: "americas", label: "Americas", short: "AMER", countries: ["US", "CA", "BR", "MX"] },
  { key: "ukie", label: "UK & Ireland", short: "UK·IE", countries: ["GB", "IE"] },
  { key: "swe", label: "Southern & Western Europe", short: "S·W EU", countries: ["FR", "ES", "PT", "IT", "MT", "GR", "CY"] },
  { key: "remote", label: "Remote / worldwide", short: "REMOTE", countries: ["XW"] },
  { key: "unplaced", label: "Unplaced", short: "?", countries: [] },
];

export const SECTOR_SPAN = 360 / REGION_SECTORS.length;
const UNPLACED = REGION_SECTORS.length - 1;

/** Sector index for a country code (unknown / null → "Unplaced"). */
export function sectorFor(countryIso2: string | null | undefined): number {
  if (!countryIso2) return UNPLACED;
  const c = countryIso2.toUpperCase();
  const i = REGION_SECTORS.findIndex((s) => s.countries.includes(c));
  return i === -1 ? UNPLACED : i;
}

/** Centre bearing of a sector (for legend labels). */
export function sectorCentre(index: number): number {
  return index * SECTOR_SPAN + SECTOR_SPAN / 2;
}

/** 0.12 (score 100) … 0.95 (score 0); unscored jobs park on the outer ring. */
export function distanceForScore(score: number | null | undefined): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0.95;
  const s = Math.max(0, Math.min(100, score));
  return Math.round((0.12 + (1 - s / 100) * 0.83) * 1000) / 1000;
}

export interface BlipJob {
  id: number;
  title: string;
  company: string;
  countryIso2: string | null;
  score: number | null;
  visaStatus: string | null;
  firstSeenAt: Date;
}

export interface PlacedJobBlip extends RadarBlip {
  id: number;
  sector: number;
  score: number | null;
  title: string;
  company: string;
  countryIso2: string | null;
  visaLabel: string;
  isNew: boolean;
}

type BlipTone = NonNullable<RadarBlip["tone"]>;
const BLIP_TONES: readonly BlipTone[] = ["acid", "signal", "radar", "cobalt", "stamp", "lilac", "paper", "concrete"];

/** Visa tone on the scope (same colours as the visa stamps elsewhere). */
function blipTone(tone: string): BlipTone {
  return (BLIP_TONES as readonly string[]).includes(tone) ? (tone as BlipTone) : "concrete";
}

/** Margin kept free at each sector edge so neighbouring regions stay visually apart. */
const EDGE = 4;
const MIN_GAP_DEG = 8;
const MIN_GAP_RANGE = 0.07;

/**
 * Places jobs on the scope. Deterministic: the bearing inside the sector comes from the job id,
 * and blips that would overlap are nudged along the sector (then outward) instead of stacking.
 */
export function placeJobBlips(jobs: readonly BlipJob[], opts: { newSince: Date; hrefFor: (id: number) => string }): PlacedJobBlip[] {
  const placed: PlacedJobBlip[] = [];
  const usable = SECTOR_SPAN - EDGE * 2;
  for (const job of jobs) {
    const sector = sectorFor(job.countryIso2);
    const start = sector * SECTOR_SPAN + EDGE;
    let offset = hashString(`job:${job.id}`) % Math.max(1, Math.floor(usable));
    let distance = distanceForScore(job.score);
    for (let tries = 0; tries < 24; tries++) {
      const angle = start + offset;
      const clash = placed.some((p) => Math.abs(p.distance - distance) < MIN_GAP_RANGE && angularDistance(p.angle, angle) < MIN_GAP_DEG);
      if (!clash) break;
      offset = (offset + 7) % Math.max(1, Math.floor(usable));
      // After a lap around the sector, step outward a little.
      if (tries % 4 === 3) distance = Math.min(1, Math.round((distance + 0.04) * 1000) / 1000);
    }
    const visa = job.visaStatus && isVisaStatus(job.visaStatus) ? job.visaStatus : "unknown";
    const meta = VISA_META[visa];
    const isNew = job.firstSeenAt.getTime() >= opts.newSince.getTime();
    const scoreText = job.score === null ? "unscored" : `fit ${Math.round(job.score)}`;
    placed.push({
      id: job.id,
      angle: Math.round(normalizeAngle(start + offset) * 10) / 10,
      distance,
      label: `${job.title} · ${job.company} · ${scoreText} · visa ${meta.label.toLowerCase()} · ${REGION_SECTORS[sector].label}${isNew ? " · new today" : ""}`,
      href: opts.hrefFor(job.id),
      tone: blipTone(meta.tone),
      ping: isNew,
      sector,
      score: job.score,
      title: job.title,
      company: job.company,
      countryIso2: job.countryIso2,
      visaLabel: meta.label,
      isNew,
    });
  }
  return placed;
}

export interface SectorGroup {
  sector: RegionSector;
  index: number;
  blips: PlacedJobBlip[];
}

/** Accessible list alternative: blips grouped by region (scope order), best fit first. */
export function groupBySector(blips: readonly PlacedJobBlip[]): SectorGroup[] {
  return REGION_SECTORS.map((sector, index) => ({
    sector,
    index,
    blips: blips.filter((b) => b.sector === index).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id - b.id),
  })).filter((g) => g.blips.length > 0);
}

// ---- onboarding ------------------------------------------------------------------------------

export const GOLDEN_TARGET = 30;

export interface OnboardingInput {
  settingsWritten: boolean;
  goldenSamples: number;
  targetCountries: number;
  verifiedTargetCountries: number;
  liveSources: number;
}

export interface OnboardingItem {
  key: "settings" | "golden" | "countries" | "sources";
  label: string;
  detail: string;
  done: boolean;
  href: string;
  cta: string;
}

/** The "station not calibrated yet" checklist (spec §19.1). */
export function onboardingItems(i: OnboardingInput): OnboardingItem[] {
  const countriesDone = i.targetCountries > 0 && i.verifiedTargetCountries >= i.targetCountries;
  return [
    {
      key: "settings",
      label: "Write your settings",
      detail: i.settingsWritten ? "Profile saved." : "Profile, target countries and bands are still factory defaults.",
      done: i.settingsWritten,
      href: "/settings",
      cta: "Open settings",
    },
    {
      key: "golden",
      label: `Label ${GOLDEN_TARGET} golden samples`,
      detail: `${Math.min(i.goldenSamples, GOLDEN_TARGET)} of ${GOLDEN_TARGET} labelled — accuracy numbers mean little below that.`,
      done: i.goldenSamples >= GOLDEN_TARGET,
      href: "/accuracy",
      cta: "Label samples",
    },
    {
      key: "countries",
      label: "Verify your target countries",
      detail:
        i.targetCountries === 0
          ? "No target countries set yet."
          : `${Math.min(i.verifiedTargetCountries, i.targetCountries)} of ${i.targetCountries} have a verified visa rule.`,
      done: countriesDone,
      href: "/countries",
      cta: "Check countries",
    },
    {
      key: "sources",
      label: "Put a source live",
      detail: i.liveSources > 0 ? `${i.liveSources} live.` : "Nothing is feeding the scope yet.",
      done: i.liveSources > 0,
      href: "/sources",
      cta: "Open sources",
    },
  ];
}
