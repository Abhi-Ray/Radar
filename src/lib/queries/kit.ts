/**
 * /kit reads (server only): resume versions, templates, per-country CV conventions and the
 * tailoring checklist for one job (`?job=`), built from the job's facts and my profile.
 */
import "server-only";
import { and, asc, count, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import {
  applications,
  companies,
  companyEvidence,
  countries,
  jobs,
  resumeVersions,
  templates,
  visaRoutes,
  type ResumeVersionRow,
  type TemplateRow,
} from "@/db/schema";
import { parseSponsorNote, parseSponsorSummary, registerKeyLabel, sponsorClass, type SponsorClass } from "@/components/companies/model";
import { parseCvConventions, type CvConventions } from "@/components/countries/model";
import { TRACK_LABEL, type ResumeTrackKey } from "@/components/kit/labels";
import { parseSkillsFact, planSkills, suggestTrack, tailoringSteps, whyCompanyDraft, type ChecklistStep, type SkillPlan } from "@/components/kit/tailoring";
import { getDb, type DbOrTx } from "@/lib/db";
import { loadResolvedFacts } from "@/lib/provenance/store";
import { getSetting } from "@/lib/settings";

export interface ResumeListItem extends ResumeVersionRow {
  usedBy: number;
}

export interface CountryConventions {
  iso2: string;
  name: string;
  tier: number;
  conventions: CvConventions;
  templates: TemplateRow[];
}

export interface TailoringJob {
  id: number;
  title: string;
  titleRaw: string;
  companyId: number;
  companyName: string;
  city: string | null;
  countryIso2: string | null;
  countryName: string | null;
  roleKey: string | null;
}

export interface Tailoring {
  job: TailoringJob;
  plan: SkillPlan;
  profileSkills: string[];
  track: ResumeTrackKey;
  why: string;
  steps: ChecklistStep[];
  sponsor: SponsorClass;
  visaLine: string | null;
  /** The rule reference the visa verdict was worked out against (a logic id, shown in mono). */
  visaRule: string | null;
  conventions: CvConventions | null;
  applicationId: number | null;
}

export interface KitData {
  resumes: ResumeListItem[];
  templates: TemplateRow[];
  conventions: CountryConventions[];
  countries: Array<{ iso2: string; name: string }>;
  /** Jobs worth tailoring for: saved or with an application (newest first). */
  jobChoices: Array<{ id: number; label: string }>;
  tailoring: Tailoring | null;
}

export async function loadKit(opts: { db?: DbOrTx; jobId?: number | null } = {}): Promise<KitData> {
  const db = opts.db ?? getDb();
  const [resumeRows, usage, templateRows, countryRows, jobChoiceRows] = await Promise.all([
    db.select().from(resumeVersions).orderBy(desc(resumeVersions.updatedAt), desc(resumeVersions.id)),
    db
      .select({ id: applications.resumeVersionId, n: count() })
      .from(applications)
      .where(isNotNull(applications.resumeVersionId))
      .groupBy(applications.resumeVersionId),
    db.select().from(templates).orderBy(asc(templates.kind), asc(templates.name)),
    db
      .select({ iso2: countries.iso2, name: countries.name, tier: countries.tier, cv: countries.cvConventionsJson })
      .from(countries)
      .orderBy(asc(countries.tier), asc(countries.name)),
    db
      .selectDistinct({ id: jobs.id, title: jobs.canonicalTitle, company: companies.name, updatedAt: jobs.updatedAt })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(applications, eq(applications.jobId, jobs.id))
      .where(and(isNull(jobs.mergedIntoJobId), or(eq(jobs.saved, true), isNotNull(applications.id))))
      .orderBy(desc(jobs.updatedAt))
      .limit(100),
  ]);
  const used = new Map(usage.map((u) => [u.id as number, Number(u.n)]));
  const byCountry = new Map<string, TemplateRow[]>();
  for (const t of templateRows) {
    if (t.kind !== "cv_convention" || !t.countryIso2) continue;
    byCountry.set(t.countryIso2, [...(byCountry.get(t.countryIso2) ?? []), t]);
  }
  const conventions: CountryConventions[] = countryRows
    .map((c) => ({ iso2: c.iso2, name: c.name, tier: c.tier, conventions: parseCvConventions(c.cv), templates: byCountry.get(c.iso2) ?? [] }))
    .filter((c) => c.conventions.items.length || c.conventions.notes.length || c.templates.length);
  const tailoring = opts.jobId ? await loadTailoring(db, opts.jobId, byCountry) : null;
  return {
    resumes: resumeRows.map((r) => ({ ...r, usedBy: used.get(r.id) ?? 0 })),
    templates: templateRows,
    conventions,
    countries: countryRows.map((c) => ({ iso2: c.iso2, name: c.name })),
    jobChoices: jobChoiceRows.map((j) => ({ id: j.id, label: `${j.title} · ${j.company}` })),
    tailoring,
  };
}

async function loadTailoring(db: DbOrTx, jobId: number, conventionTemplates: Map<string, TemplateRow[]>): Promise<Tailoring | null> {
  const [row] = await db
    .select({
      id: jobs.id,
      title: jobs.canonicalTitle,
      titleRaw: jobs.titleRaw,
      companyId: jobs.companyId,
      companyName: companies.name,
      companyType: companies.type,
      sizeBand: companies.sizeBand,
      sponsorSummary: companies.sponsorSummaryJson,
      city: jobs.city,
      countryIso2: jobs.countryIso2,
      countryName: countries.name,
      cv: countries.cvConventionsJson,
      roleKey: jobs.roleKey,
      text: jobs.descriptionText,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(countries, eq(countries.iso2, jobs.countryIso2))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) return null;
  const [resolved, profile, notes, routes, [app]] = await Promise.all([
    loadResolvedFacts(db, jobId),
    getSetting(db, "profile"),
    db
      .select({ valueJson: companyEvidence.valueJson })
      .from(companyEvidence)
      .where(and(eq(companyEvidence.companyId, row.companyId), eq(companyEvidence.kind, "manual_note")))
      .orderBy(desc(companyEvidence.checkedAt), desc(companyEvidence.id))
      .limit(20),
    row.countryIso2
      ? db
          .select({ name: visaRoutes.name })
          .from(visaRoutes)
          .where(and(eq(visaRoutes.countryIso2, row.countryIso2), eq(visaRoutes.isActive, true)))
          .orderBy(asc(visaRoutes.id))
      : Promise.resolve([] as Array<{ name: string }>),
    db.select({ id: applications.id }).from(applications).where(eq(applications.jobId, jobId)).orderBy(desc(applications.id)).limit(1),
  ]);
  const fact = parseSkillsFact(resolved.skills?.winner?.value);
  const plan = planSkills({ profileSkills: profile.skills, fact, text: row.text });
  const track = suggestTrack(row.roleKey, row.title);
  const summary = parseSponsorSummary(row.sponsorSummary);
  const note = notes.map((n) => parseSponsorNote(n.valueJson)).find((n) => n !== null) ?? null;
  const sponsor = sponsorClass(summary, note);
  const register = summary?.registers.find((r) => r.matchStatus === "confirmed");
  const why = whyCompanyDraft({
    company: row.companyName,
    title: row.title,
    city: row.city,
    country: row.countryName,
    type: row.companyType,
    sizeBand: row.sizeBand,
    sponsor,
    sponsorRegister: register ? registerName(register.registerKey) : null,
    mirror: plan.mirror,
  });
  const eligibility = resolved.eligibility?.winner?.value as { result?: unknown; reason?: unknown; rule?: unknown } | undefined;
  let visaLine: string | null = null;
  let visaRule: string | null = null;
  if (eligibility && typeof eligibility.reason === "string" && eligibility.reason.trim()) {
    visaLine = eligibility.reason.trim();
    visaRule = typeof eligibility.rule === "string" && eligibility.rule.trim() ? eligibility.rule.trim() : null;
  } else if (routes.length) {
    visaLine = `Routes for ${row.countryName ?? row.countryIso2}: ${routes.map((r) => r.name).join(", ")}.`;
  }
  const conventions = row.countryIso2 ? parseCvConventions(row.cv) : null;
  const hasConventions = Boolean(
    (conventions && (conventions.items.length || conventions.notes.length)) || (row.countryIso2 && conventionTemplates.get(row.countryIso2)?.length),
  );
  const steps = tailoringSteps({
    plan,
    title: row.title,
    track,
    trackLabel: TRACK_LABEL[track],
    countryName: row.countryName,
    hasConventions,
    visaRoute: visaLine,
  });
  return {
    job: {
      id: row.id,
      title: row.title,
      titleRaw: row.titleRaw,
      companyId: row.companyId,
      companyName: row.companyName,
      city: row.city,
      countryIso2: row.countryIso2,
      countryName: row.countryName,
      roleKey: row.roleKey,
    },
    plan,
    profileSkills: profile.skills,
    track,
    why,
    steps,
    sponsor,
    visaLine,
    visaRule,
    conventions,
    applicationId: app?.id ?? null,
  };
}

function registerName(key: string): string {
  return registerKeyLabel(key);
}
