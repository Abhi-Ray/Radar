/** Labels for the kit's enums (resume tracks, template kinds). Pure and client-safe. */
import { RESUME_TRACKS, TEMPLATE_KINDS } from "@/db/schema/_enums";

export type ResumeTrackKey = (typeof RESUME_TRACKS)[number];
export type TemplateKindKey = (typeof TEMPLATE_KINDS)[number];

export const RESUME_TRACK_KEYS: readonly ResumeTrackKey[] = RESUME_TRACKS;
export const TEMPLATE_KIND_KEYS: readonly TemplateKindKey[] = TEMPLATE_KINDS;

export const TRACK_LABEL: Record<ResumeTrackKey, string> = {
  cloud_security: "Cloud security",
  devsecops: "DevSecOps",
  fullstack: "Full-stack",
  other: "Other",
};

export const TRACK_TONE: Record<ResumeTrackKey, "cobalt" | "lilac" | "acid" | "concrete"> = {
  cloud_security: "cobalt",
  devsecops: "lilac",
  fullstack: "acid",
  other: "concrete",
};

export const TEMPLATE_KIND_LABEL: Record<TemplateKindKey, string> = {
  cover_letter: "Cover letter",
  outreach: "Outreach",
  checklist: "Checklist",
  cv_convention: "CV convention",
};

export const TEMPLATE_KIND_HINT: Record<TemplateKindKey, string> = {
  cover_letter: "A letter with {{slots}} to fill for each job.",
  outreach: "A message to a recruiter or hiring manager.",
  checklist: "Your own steps, with [ ] boxes.",
  cv_convention: "How CVs are written in one country (pick the country).",
};

export function isResumeTrack(v: unknown): v is ResumeTrackKey {
  return typeof v === "string" && (RESUME_TRACKS as readonly string[]).includes(v);
}

export function isTemplateKind(v: unknown): v is TemplateKindKey {
  return typeof v === "string" && (TEMPLATE_KINDS as readonly string[]).includes(v);
}
