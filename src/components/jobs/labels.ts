/**
 * Human labels for the job enums (list filters, cards, detail page). Pure; safe on client and server.
 */
import type {
  COMPANY_TYPES,
  CONFIDENCES,
  EXPERIENCE_BANDS,
  JOB_STATES,
  LANGUAGE_REQUIREMENTS,
  LINK_STATUSES,
  REMOTE_CLASSES,
  ROLE_FAMILIES,
  SENIORITY_WORDS,
  WORKPLACE_TYPES,
} from "@/db/schema/_enums";

export type RemoteClass = (typeof REMOTE_CLASSES)[number];
export type RoleFamily = (typeof ROLE_FAMILIES)[number];
export type CompanyType = (typeof COMPANY_TYPES)[number];
export type JobState = (typeof JOB_STATES)[number];
export type ConfidenceKey = (typeof CONFIDENCES)[number];
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];
export type LinkStatus = (typeof LINK_STATUSES)[number];
export type LanguageRequirement = (typeof LANGUAGE_REQUIREMENTS)[number];
export type ExperienceBandKey = (typeof EXPERIENCE_BANDS)[number];
export type SeniorityWord = (typeof SENIORITY_WORDS)[number];

export const REMOTE_LABEL: Record<RemoteClass, string> = {
  worldwide: "Worldwide",
  region_limited: "Region-limited",
  timezone_limited: "Time-zone-limited",
  unclear: "Unclear",
  not_remote: "Not remote",
};

export const FAMILY_LABEL: Record<RoleFamily, string> = {
  primary: "Primary target",
  secondary: "Secondary target",
  fallback: "Fallback",
  other: "Other",
};

export const COMPANY_TYPE_LABEL: Record<CompanyType, string> = {
  startup: "Startup",
  scaleup: "Scale-up",
  midsize: "Mid-size",
  mnc: "MNC",
  agency: "Agency",
  unknown: "Unknown",
};

export const STATE_LABEL: Record<JobState, string> = {
  new: "New",
  active: "Active",
  updated: "Updated",
  stale: "Stale",
  closed: "Closed",
  expired: "Expired",
  suspicious: "Suspicious",
};

export const CONFIDENCE_LABEL: Record<ConfidenceKey, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const WORKPLACE_LABEL: Record<WorkplaceType, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

export const LINK_LABEL: Record<LinkStatus, string> = {
  ok: "Link OK",
  dead: "Dead link",
  unknown: "Link unchecked",
  redirected: "Redirects",
};

export const LANGUAGE_LABEL: Record<LanguageRequirement, string> = {
  english_ok: "English OK",
  local_required: "Local language required",
  unclear: "Unclear",
};

export const EXPERIENCE_BAND_LABEL: Record<ExperienceBandKey, string> = {
  core: "Core band",
  show: "Within reach",
  hide: "Outside band",
  unknown: "Unknown",
};

export const SENIORITY_LABEL: Record<SeniorityWord, string> = {
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  lead: "Lead",
  principal: "Principal",
};

/** "cloud_security_engineer" → "Cloud security engineer". */
export function roleKeyLabel(key: string | null | undefined): string {
  if (!key) return "Unmapped role";
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return "Unmapped role";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Label lookup that tolerates unknown values (DB enums can grow before the UI does). */
export function labelOf<K extends string>(map: Record<K, string>, value: string | null | undefined, fallback = "Unknown"): string {
  if (value === null || value === undefined) return fallback;
  return (map as Record<string, string>)[value] ?? value;
}
