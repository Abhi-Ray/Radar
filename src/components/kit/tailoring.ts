/**
 * Per-job tailoring checklist (spec §22: "the key skills to mirror and one line on why this
 * company"). Pure and client-safe.
 *
 * Skills come from the job's `skills` fact when the pipeline wrote one (`found` = every known skill
 * the posting names, `matched` = the ones on my profile). Without the fact, the posting text is
 * scanned here with the same word-boundary + alias rules. Nothing is invented: every skill listed
 * appears in the posting, and the "why this company" draft only uses stored facts.
 */
import type { ResumeTrackKey } from "./labels";

/** Canonical skill → extra spellings (mirrors the pipeline's skills stage). */
export const SKILL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  AWS: ["amazon web services"],
  Azure: ["microsoft azure"],
  GCP: ["google cloud", "google cloud platform"],
  IAM: ["identity and access management", "identity & access management"],
  Kubernetes: ["k8s"],
  "CI/CD": ["ci-cd", "cicd", "ci / cd", "continuous integration", "continuous delivery", "continuous deployment"],
  SAST: ["static application security testing"],
  DAST: ["dynamic application security testing"],
  SIEM: [],
  GDPR: ["dsgvo", "rgpd"],
  "ISO 27001": ["iso/iec 27001", "iso27001", "iso-27001", "iso 27k"],
  "SOC 2": ["soc2", "soc ii", "soc-2"],
  "Node.js": ["nodejs", "node js"],
  "Next.js": ["nextjs", "next js"],
  JavaScript: ["ecmascript"],
  TypeScript: [],
  Python: [],
  Linux: [],
  Terraform: [],
  Docker: [],
  Ansible: [],
  Helm: [],
  Vault: ["hashicorp vault"],
  Splunk: [],
  Okta: [],
  OWASP: [],
  NIST: ["nist csf", "nist 800-53"],
  "PCI DSS": ["pci-dss"],
  CSPM: ["cloud security posture management"],
  CNAPP: [],
  "Zero Trust": ["zero-trust"],
  "GitHub Actions": [],
  "GitLab CI": ["gitlab-ci"],
  Jenkins: [],
  React: ["react.js", "reactjs"],
  Java: [],
  SOAR: [],
  EDR: [],
  "Threat Modeling": ["threat modelling"],
  "Penetration Testing": ["pentesting", "pen testing", "penetration test"],
};

/** "Node.js" / "node js" / "NodeJS" → "nodejs" (the backend's skill key). */
export function skillKey(s: string): string {
  return s.toLowerCase().replace(/[\s._/-]/g, "");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function spellings(skill: string): string[] {
  const direct = SKILL_ALIASES[skill];
  if (direct) return [skill, ...direct];
  const k = skillKey(skill);
  const canon = Object.keys(SKILL_ALIASES).find((c) => skillKey(c) === k);
  return canon ? [skill, canon, ...SKILL_ALIASES[canon]] : [skill];
}

/** Whole-token, case-insensitive: "aws" ≠ "laws", "java" ≠ "javascript", "node.js" ≠ "node.jsx". */
export function mentions(text: string, skill: string): boolean {
  const lower = text.toLowerCase();
  return spellings(skill).some((sp) => {
    const s = sp.toLowerCase().replace(/\s+/g, " ").trim();
    if (!s) return false;
    return new RegExp(`(?:^|[^a-z0-9])${escapeRe(s).replace(/ /g, "\\s+")}(?![a-z0-9])`, "i").test(lower);
  });
}

export interface SkillsFact {
  matched?: readonly string[];
  found?: readonly string[];
}

/** Reads a `skills` fact value leniently ({matched, found} string lists). */
export function parseSkillsFact(v: unknown): SkillsFact | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : undefined);
  const matched = list(o.matched);
  const found = list(o.found);
  if (!matched && !found) return null;
  return { matched, found };
}

export interface SkillPlan {
  /** In the posting and on my profile: say these, in the posting's words. */
  mirror: string[];
  /** In the posting, not on my profile: be honest (adjacent experience, learning, or skip). */
  gaps: string[];
  /** On my profile, not in the posting: lower in the CV for this one. */
  unused: string[];
  basis: "fact" | "text" | "none";
}

function uniqueByKey(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = skillKey(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * The overlap between what the posting asks for and my profile skills.
 * `fact` wins when present; otherwise the posting text is scanned for my skills and the known list.
 */
export function planSkills(input: { profileSkills: readonly string[]; fact: SkillsFact | null; text: string | null | undefined }): SkillPlan {
  const profile = uniqueByKey(input.profileSkills);
  const profileKeys = new Set(profile.map(skillKey));
  let found: string[];
  let basis: SkillPlan["basis"];
  if (input.fact && (input.fact.found?.length || input.fact.matched?.length)) {
    found = uniqueByKey([...(input.fact.matched ?? []), ...(input.fact.found ?? [])]);
    basis = "fact";
  } else if (input.text && input.text.trim()) {
    const text = input.text;
    found = uniqueByKey([...profile, ...Object.keys(SKILL_ALIASES)].filter((s) => mentions(text, s)));
    basis = "text";
  } else {
    return { mirror: [], gaps: [], unused: profile, basis: "none" };
  }
  const foundKeys = new Set(found.map(skillKey));
  // Profile spelling for mirrored skills (that is how my CV writes them).
  const mirror = profile.filter((s) => foundKeys.has(skillKey(s)));
  const gaps = found.filter((s) => !profileKeys.has(skillKey(s)));
  const unused = profile.filter((s) => !foundKeys.has(skillKey(s)));
  return { mirror, gaps, unused, basis };
}

export interface WhyCompanyInput {
  company: string;
  title?: string | null;
  city?: string | null;
  country?: string | null;
  type?: string | null;
  sizeBand?: string | null;
  sponsor?: "confirmed" | "possible" | "none" | null;
  sponsorRegister?: string | null;
  /** Mirrored skills (the first two are named). */
  mirror?: readonly string[];
}

const TYPE_WORDS: Record<string, string> = {
  startup: "a startup",
  scaleup: "a scale-up",
  midsize: "a mid-size company",
  mnc: "a multinational",
  agency: "a recruitment agency",
};

/**
 * A first draft of the "why this company" line, built only from stored facts. It is a starting
 * point to rewrite in my own words (the UI says so) — it never claims anything the data lacks.
 */
export function whyCompanyDraft(input: WhyCompanyInput): string {
  const company = input.company.trim() || "This company";
  const place = [input.city, input.country].filter((s): s is string => Boolean(s && s.trim())).join(", ");
  const typeWord = input.type ? TYPE_WORDS[input.type] : undefined;
  const size = input.sizeBand?.trim() || null;
  const desc = typeWord && size ? `${typeWord} of ${size} people` : typeWord ? typeWord : size ? `a company of ${size} people` : null;
  const title = input.title?.trim() || null;
  let line = company;
  if (title || place) {
    if (desc) line += `, ${desc},`;
    line += title ? ` is hiring ${/^[aeiou]/i.test(title) ? "an" : "a"} ${title}` : " is hiring";
    if (place) line += ` in ${place}`;
  } else if (desc) {
    line += ` is ${desc}`;
  }
  const mirror = (input.mirror ?? []).slice(0, 2);
  if (mirror.length) line += ` — the role leans on ${mirror.join(" and ")}, which is where my work is`;
  line += ".";
  if (input.sponsor === "confirmed") line += ` They are on the ${input.sponsorRegister ?? "official"} sponsor record, so the visa route is real.`;
  return line.replace(/\s+/g, " ").trim();
}

/** Resume track to start from for a canonical role key (title fallback when unmapped). */
export function suggestTrack(roleKey: string | null | undefined, title?: string | null): ResumeTrackKey {
  const k = (roleKey ?? "").toLowerCase();
  if (/^(devsecops|appsec|product_security)/.test(k)) return "devsecops";
  if (/cloud|grc/.test(k)) return "cloud_security";
  if (/(fullstack|nextjs|node)_developer/.test(k)) return "fullstack";
  const t = (title ?? "").toLowerCase();
  if (/devsecops|appsec|application security|product security/.test(t)) return "devsecops";
  if (/security/.test(t)) return "cloud_security";
  if (/full[\s-]?stack|next\.?js|node|react|frontend|backend|software (?:engineer|developer)/.test(t)) return "fullstack";
  return "other";
}

export interface ChecklistStep {
  id: string;
  label: string;
  detail: string | null;
}

/** The fixed steps of tailoring one application (the detail lines are filled from the job). */
export function tailoringSteps(input: {
  plan: SkillPlan;
  title?: string | null;
  track: ResumeTrackKey;
  trackLabel: string;
  countryName?: string | null;
  hasConventions: boolean;
  visaRoute?: string | null;
}): ChecklistStep[] {
  const steps: ChecklistStep[] = [];
  steps.push({ id: "resume", label: "Start from the right resume version", detail: `Suggested track: ${input.trackLabel}.` });
  if (input.title) steps.push({ id: "headline", label: "Match the headline to the job title", detail: `“${input.title}”.` });
  steps.push({
    id: "mirror",
    label: "Mirror the key skills in the summary and the top bullets",
    detail: input.plan.mirror.length ? input.plan.mirror.slice(0, 8).join(", ") : "No overlap found — read the posting by hand.",
  });
  steps.push({ id: "proof", label: "Back each mirrored skill with one measured result", detail: null });
  if (input.plan.gaps.length) {
    steps.push({ id: "gaps", label: "Decide how to address the gaps honestly", detail: input.plan.gaps.slice(0, 8).join(", ") });
  }
  steps.push({ id: "why", label: "Write the one line on why this company", detail: null });
  steps.push({
    id: "conventions",
    label: input.countryName ? `Follow the CV conventions for ${input.countryName}` : "Follow the country's CV conventions",
    detail: input.hasConventions ? null : "No conventions recorded for this country yet.",
  });
  if (input.visaRoute) steps.push({ id: "visa", label: "Check the visa route before applying", detail: input.visaRoute });
  steps.push({ id: "log", label: "Log the resume version on the application", detail: null });
  return steps;
}
