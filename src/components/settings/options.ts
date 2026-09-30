/** Option lists for the /settings forms (client-safe). */
import { COMPANY_TYPES } from "@/db/schema/_enums";
import { ROLES } from "@/data/titles/roles";
import {
  REMOTE_COUNTRY,
  TIER_1_COUNTRIES,
  TIER_2_COUNTRIES,
  TIER_3_COUNTRIES,
  TIER_4_COUNTRIES,
} from "@/lib/contracts/settings";

export const COMPANY_TYPES_LIST = COMPANY_TYPES;

export const COMPANY_TYPE_LABEL: Record<(typeof COMPANY_TYPES)[number], string> = {
  startup: "Startup",
  scaleup: "Scale-up",
  midsize: "Mid-size",
  mnc: "Multinational",
  agency: "Agency / recruiter",
  unknown: "Unknown type",
};

/** A role's place in the profile: one of the three target lists, or not targeted. */
export const TARGET_FAMILIES = ["primary", "secondary", "fallback", "none"] as const;
export type TargetFamily = (typeof TARGET_FAMILIES)[number];

export const TARGET_FAMILY_LABEL: Record<TargetFamily, string> = {
  primary: "Primary",
  secondary: "Secondary",
  fallback: "Fallback",
  none: "Not a target",
};

/** Roles offered in the profile form ("other" is the catch-all and never a target). */
export const TARGETABLE_ROLES = ROLES.filter((r) => r.key !== "other");

export const COUNTRY_TIERS: readonly { key: string; label: string; codes: readonly string[] }[] = [
  { key: "t1", label: "Tier 1 · EU core", codes: TIER_1_COUNTRIES },
  { key: "t2", label: "Tier 2 · Nordics & Central/Eastern Europe", codes: TIER_2_COUNTRIES },
  { key: "t3", label: "Tier 3 · Other high-pay markets", codes: TIER_3_COUNTRIES },
  { key: "t4", label: "Tier 4 · Middle East & other", codes: TIER_4_COUNTRIES },
  { key: "remote", label: "Remote · worldwide", codes: [REMOTE_COUNTRY] },
];

export const TIERED_COUNTRY_CODES: ReadonlySet<string> = new Set(COUNTRY_TIERS.flatMap((t) => t.codes));

/** The family a role currently has in the profile lists ("none" when it is in none of them). */
export function familyOf(roleKey: string, lists: { primary: readonly string[]; secondary: readonly string[]; fallback: readonly string[] }): TargetFamily {
  if (lists.primary.includes(roleKey)) return "primary";
  if (lists.secondary.includes(roleKey)) return "secondary";
  if (lists.fallback.includes(roleKey)) return "fallback";
  return "none";
}
