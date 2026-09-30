/**
 * Defensive reading of application_snapshots.job_json (a JSON column written by the tracker; older
 * or hand-made rows may miss keys). Pure — every value is type-checked before it is shown.
 */
export interface SnapshotFact {
  key: string;
  value: unknown;
  method: string | null;
  confidence: string | null;
}

export interface SnapshotView {
  manual: boolean;
  jobId: number | null;
  title: string | null;
  titleRaw: string | null;
  company: string | null;
  countryIso2: string | null;
  city: string | null;
  locationRaw: string | null;
  workplaceType: string | null;
  remoteClass: string | null;
  postedAt: string | null;
  closingAt: string | null;
  visaStatus: string | null;
  seniority: string | null;
  experienceBand: string | null;
  languageRequirement: string | null;
  sourceKey: string | null;
  score: number | null;
  descriptionText: string;
  facts: SnapshotFact[];
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function iso(v: unknown): string | null {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
}

export function readSnapshot(jobJson: unknown): SnapshotView {
  const j = obj(jobJson);
  const facts: SnapshotFact[] = [];
  for (const [key, raw] of Object.entries(obj(j.facts))) {
    const f = obj(raw);
    if (!("value" in f) || f.value === null || f.value === undefined) continue;
    facts.push({ key, value: f.value, method: str(f.method), confidence: str(f.confidence) });
  }
  facts.sort((a, b) => a.key.localeCompare(b.key));
  const jobId = typeof j.jobId === "number" && Number.isInteger(j.jobId) && j.jobId > 0 ? j.jobId : null;
  return {
    manual: j.manual === true,
    jobId,
    title: str(j.title),
    titleRaw: str(j.titleRaw),
    company: str(j.company),
    countryIso2: str(j.countryIso2),
    city: str(j.city),
    locationRaw: str(j.locationRaw),
    workplaceType: str(j.workplaceType),
    remoteClass: str(j.remoteClass),
    postedAt: iso(j.postedAt),
    closingAt: iso(j.closingAt),
    visaStatus: str(j.visaStatus),
    seniority: str(j.seniority),
    experienceBand: str(j.experienceBand),
    languageRequirement: str(j.languageRequirement),
    sourceKey: str(j.sourceKey),
    score: typeof j.score === "number" && Number.isFinite(j.score) ? j.score : null,
    descriptionText: typeof j.descriptionText === "string" ? j.descriptionText.trim() : "",
    facts,
  };
}

/** The salary slip stored next to the copy: {value, method, confidence, source}. */
export function readSnapshotSalary(salaryJson: unknown): { value: Record<string, unknown>; method: string | null; confidence: string | null; estimated: boolean } | null {
  const s = obj(salaryJson);
  const value = obj(s.value);
  if (!Object.keys(value).length) return null;
  const method = str(s.method);
  return { value, method, confidence: str(s.confidence), estimated: value.kind === "estimated" || method === "estimated" };
}

/** "Berlin, DE" / the raw location / the country code. */
export function snapshotLocation(v: SnapshotView): string | null {
  if (v.city && v.countryIso2) return `${v.city}, ${v.countryIso2}`;
  return v.locationRaw ?? v.city ?? v.countryIso2;
}
