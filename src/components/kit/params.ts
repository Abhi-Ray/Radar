/** /kit URL state: ?tab=, ?resume=<id|new>, ?template=<id|new>, ?job=<id>. Pure. */
export const KIT_TABS = ["resumes", "templates", "conventions", "tailor"] as const;
export type KitTab = (typeof KIT_TABS)[number];

export const KIT_TAB_LABEL: Record<KitTab, string> = {
  resumes: "Resumes",
  templates: "Templates",
  conventions: "CV conventions",
  tailor: "Tailor for a job",
};

export interface KitParams {
  tab: KitTab;
  resume: number | "new" | null;
  template: number | "new" | null;
  job: number | null;
}

type Input = Record<string, string | string[] | undefined> | null | undefined;

function one(sp: Input, key: string): string | null {
  const v = sp?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

export function parsePositiveId(raw: string | null): number | null {
  if (!raw || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

function idOrNew(raw: string | null): number | "new" | null {
  if (raw === "new") return "new";
  return parsePositiveId(raw);
}

export function parseKitParams(sp: Input): KitParams {
  const rawTab = one(sp, "tab");
  const resume = idOrNew(one(sp, "resume"));
  const template = idOrNew(one(sp, "template"));
  const job = parsePositiveId(one(sp, "job"));
  let tab: KitTab;
  if (rawTab && (KIT_TABS as readonly string[]).includes(rawTab)) tab = rawTab as KitTab;
  else if (template !== null) tab = "templates";
  else if (resume !== null) tab = "resumes";
  else if (job !== null) tab = "tailor";
  else tab = "resumes";
  return { tab, resume, template, job };
}

/** `/kit?…` with only the keys that matter (job carries across tabs). */
export function kitHref(p: Partial<KitParams>): string {
  const sp = new URLSearchParams();
  if (p.tab) sp.set("tab", p.tab);
  if (p.resume !== null && p.resume !== undefined) sp.set("resume", String(p.resume));
  if (p.template !== null && p.template !== undefined) sp.set("template", String(p.template));
  if (p.job) sp.set("job", String(p.job));
  const qs = sp.toString();
  return qs ? `/kit?${qs}` : "/kit";
}
