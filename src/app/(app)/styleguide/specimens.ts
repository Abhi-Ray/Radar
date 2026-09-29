/**
 * Specimen content for the /styleguide showcase ONLY. Fictional employers and values chosen to
 * exercise every state of the kit (long names, unknowns, estimates, low confidence). Nothing here
 * is read by any other screen, and the page labels all of it as specimen.
 */
import type { ConfidenceLevel, EligibilityResult, MethodKind, VisaStatus } from "@/components/ui/status";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface SpecimenJob {
  id: number;
  title: string;
  company: string;
  country: string;
  city: string | null;
  visa: VisaStatus;
  eligibility: EligibilityResult;
  fit: number | null;
  salary: string | null;
  salaryEstimated: boolean;
  seenAt: Date;
  fresh: boolean;
}

export function specimenJobs(now: Date): SpecimenJob[] {
  const t = now.getTime();
  return [
    {
      id: 4102,
      title: "Senior Cloud Security Engineer",
      company: "Nordlicht Cloud GmbH",
      country: "DE",
      city: "Berlin",
      visa: "confirmed",
      eligibility: "meets",
      fit: 86,
      salary: "€72k–€88k",
      salaryEstimated: false,
      seenAt: new Date(t - 42 * MIN),
      fresh: true,
    },
    {
      id: 4099,
      title: "Platform Engineer (Kubernetes, Go)",
      company: "Grachtwerk B.V.",
      country: "NL",
      city: "Amsterdam",
      visa: "likely",
      eligibility: "borderline",
      fit: 71,
      salary: "€58k–€70k",
      salaryEstimated: true,
      seenAt: new Date(t - 5 * HOUR),
      fresh: true,
    },
    {
      id: 4087,
      title: "DevSecOps Engineer — Payments Infrastructure & Compliance Automation",
      company: "Fjordpay AS",
      country: "NO",
      city: null,
      visa: "unknown",
      eligibility: "cant_tell",
      fit: 64,
      salary: null,
      salaryEstimated: false,
      seenAt: new Date(t - 26 * HOUR),
      fresh: false,
    },
    {
      id: 4051,
      title: "Site Reliability Engineer",
      company: "Lumen Retail Ltd",
      country: "IE",
      city: "Dublin",
      visa: "conflicting",
      eligibility: "meets",
      fit: 52,
      salary: "€65k",
      salaryEstimated: false,
      seenAt: new Date(t - 3 * DAY),
      fresh: false,
    },
    {
      id: 4012,
      title: "Security Analyst (SOC, Level 2)",
      company: "Castellum Seguridad S.L.",
      country: "ES",
      city: "Madrid",
      visa: "not_offered",
      eligibility: "doesnt_meet",
      fit: 31,
      salary: "€34k–€40k",
      salaryEstimated: false,
      seenAt: new Date(t - 9 * DAY),
      fresh: false,
    },
  ];
}

export interface SpecimenLog {
  id: number;
  at: Date;
  title: string;
  body?: string;
  actor: string;
  icon: "radar" | "stamp" | "edit" | "mail" | "alert" | "check";
  tone: "radar" | "signal" | "cobalt" | "acid" | "stamp" | "lilac" | "ink";
}

export function specimenLog(now: Date): SpecimenLog[] {
  const t = now.getTime();
  return [
    { id: 6, at: new Date(t - 20 * MIN), title: "Follow-up due", body: "No reply 7 days after applying.", actor: "tracker", icon: "alert", tone: "signal" },
    { id: 5, at: new Date(t - 3 * HOUR), title: "Stamped: visa confirmed", body: "Register match — Nordlicht Cloud GmbH.", actor: "visa-rules", icon: "stamp", tone: "radar" },
    { id: 4, at: new Date(t - 26 * HOUR), title: "Applied", body: "CV v7 + cover letter (DE).", actor: "you", icon: "mail", tone: "cobalt" },
    { id: 3, at: new Date(t - 2 * DAY), title: "Salary corrected", body: "€70k → €72k–€88k from the recruiter's email.", actor: "you", icon: "edit", tone: "acid" },
    { id: 2, at: new Date(t - 4 * DAY), title: "Blip picked up", body: "greenhouse · nordlicht", actor: "pipeline", icon: "radar", tone: "ink" },
  ];
}

export const SPECIMEN_RECEIPT: {
  title: string;
  value: string;
  serial: string;
  quote: string;
  source: string;
  method: MethodKind;
  confidence: ConfidenceLevel;
  logicVersion: string;
} = {
  title: "Visa sponsorship",
  value: "Confirmed",
  serial: "#V-004102",
  quote: "We sponsor work permits and the EU Blue Card for all engineering roles, and cover relocation.",
  source: "Job posting · careers.nordlicht.example",
  method: "posting",
  confidence: "high",
  logicVersion: "visa-rules@2026-09-01.2",
};

export const SPECIMEN_RUNS = [212, 230, 219, 241, 236, 0, 198, 244, 251, 239, 262, 248, 255, 271];
export const SPECIMEN_AI_CALLS = [12, 18, 9, 22, 31, 17, 38];
