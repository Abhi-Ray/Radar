/**
 * /companies list and /companies/[id] detail reads (server only).
 *
 * The sponsor class in SQL (`sponsorClassSql`) mirrors `sponsorClass()` in
 * src/components/companies/model.ts: my latest sponsor note wins, then the register summary
 * (tests/companies/queries-db.test.ts checks both agree). Merged records never show in the list.
 */
import 'server-only';
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  companies,
  companyAliases,
  companyEvidence,
  countries,
  jobs,
  sponsorRegisterEntries,
  type CompanyEvidenceRow,
  type CompanyRow,
  type SponsorRegisterEntryRow,
} from '@/db/schema';
import { COMPANIES_PAGE_SIZE, type CompanyFilters } from '@/components/companies/filters';
import {
  parseAgencyNote,
  parseRegisterEvidence,
  parseSponsorNote,
  parseSponsorSummary,
  sizeBandOrder,
  sponsorClass,
  type RegisterEvidenceView,
  type SponsorClass,
  type SponsorNoteView,
  type SponsorSummaryView,
} from '@/components/companies/model';
import { companyFamily, companyNames, type CompanyName } from '@/lib/company/family';
import { getDb, type DbOrTx } from '@/lib/db';
import { applicationsForCompany } from './applications';
import { likeNeedle } from './jobs';

// ---- sponsor class in SQL --------------------------------------------------------------------

const noteValue = sql`COALESCE(JSON_EXTRACT(${companyEvidence.valueJson}, '$.sponsors'), JSON_EXTRACT(${companyEvidence.valueJson}, '$.offered'))`;

/** My latest sponsor note on the company: 1 (sponsors), 0 (does not), NULL (no note). */
const latestNoteSql = sql`(SELECT CASE JSON_UNQUOTE(${noteValue}) WHEN 'true' THEN 1 WHEN 'false' THEN 0 END
  FROM ${companyEvidence}
  WHERE ${companyEvidence.companyId} = ${companies.id}
    AND ${companyEvidence.kind} = 'manual_note'
    AND JSON_TYPE(${noteValue}) = 'BOOLEAN'
    AND (JSON_EXTRACT(${companyEvidence.valueJson}, '$.field') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(${companyEvidence.valueJson}, '$.field')) = 'sponsors')
  ORDER BY ${companyEvidence.id} DESC LIMIT 1)`;

const summaryStatusSql = sql`JSON_UNQUOTE(JSON_EXTRACT(${companies.sponsorSummaryJson}, '$.status'))`;

export const sponsorClassSql = sql<SponsorClass>`(CASE
  WHEN ${latestNoteSql} = 1 THEN 'confirmed'
  WHEN ${summaryStatusSql} = 'confirmed' THEN IF(${latestNoteSql} = 0, 'possible', 'confirmed')
  WHEN ${latestNoteSql} = 0 THEN 'none'
  WHEN ${summaryStatusSql} IN ('likely', 'possible') THEN 'possible'
  ELSE 'none' END)`;

const openJobsSql = sql<number>`(SELECT COUNT(*) FROM ${jobs} WHERE ${jobs.companyId} = ${companies.id} AND ${jobs.mergedIntoJobId} IS NULL AND ${jobs.state} NOT IN ('closed', 'expired'))`;

// ---- list ------------------------------------------------------------------------------------

type Facet = 'sponsor' | 'size' | 'type' | 'country' | 'agency' | 'q';

function listConditions(f: CompanyFilters, skip?: Facet): SQL[] {
  const parts: SQL[] = [isNull(companies.mergedIntoId)];
  if (f.q && skip !== 'q') {
    const needle = likeNeedle(f.q);
    parts.push(
      or(
        sql`LOWER(${companies.name}) LIKE ${needle}`,
        sql`LOWER(COALESCE(${companies.domain}, '')) LIKE ${needle}`,
        sql`EXISTS (SELECT 1 FROM ${companyAliases} WHERE ${companyAliases.companyId} = ${companies.id} AND LOWER(${companyAliases.alias}) LIKE ${needle})`,
      ) as SQL,
    );
  }
  if (f.sponsor.length && skip !== 'sponsor') parts.push(inArray(sponsorClassSql, f.sponsor));
  if (f.size.length && skip !== 'size') {
    const bands = f.size.filter((s) => s !== 'none');
    const alts: SQL[] = [];
    if (bands.length) alts.push(inArray(companies.sizeBand, bands));
    if (f.size.includes('none')) alts.push(isNull(companies.sizeBand));
    parts.push(or(...alts) as SQL);
  }
  if (f.type.length && skip !== 'type') parts.push(inArray(companies.type, f.type));
  if (f.country.length && skip !== 'country') {
    const codes = f.country.filter((c) => c !== 'none');
    const alts: SQL[] = [];
    if (codes.length) alts.push(inArray(companies.hqCountry, codes));
    if (f.country.includes('none')) alts.push(isNull(companies.hqCountry));
    parts.push(or(...alts) as SQL);
  }
  if (f.agency && skip !== 'agency') parts.push(eq(companies.isAgency, f.agency === 'yes'));
  return parts;
}

export interface CompanyListRow {
  id: number;
  name: string;
  domain: string | null;
  hqCountry: string | null;
  hqCountryName: string | null;
  sizeBand: string | null;
  type: string;
  isAgency: boolean;
  sponsor: SponsorClass;
  summary: SponsorSummaryView | null;
  openJobs: number;
  aliases: number;
  parentCompanyId: number | null;
}

export interface CompanyFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface CompanyList {
  rows: CompanyListRow[];
  total: number;
  /** Every surviving company. */
  all: number;
  page: number;
  pageSize: number;
  facets: Record<'sponsor' | 'size' | 'type' | 'country' | 'agency', CompanyFacetOption[]>;
}

export async function listCompanies(f: CompanyFilters, opts: { db?: DbOrTx } = {}): Promise<CompanyList> {
  const db = opts.db ?? getDb();
  const where = and(...listConditions(f));
  const order =
    f.sort === 'name'
      ? [asc(companies.name), asc(companies.id)]
      : f.sort === 'recent'
        ? [desc(companies.updatedAt), desc(companies.id)]
        : [desc(openJobsSql), asc(companies.name), asc(companies.id)];
  const aliasCount = sql<number>`(SELECT COUNT(*) FROM ${companyAliases} WHERE ${companyAliases.companyId} = ${companies.id})`;

  const [[{ total }], [{ all }]] = await Promise.all([
    db.select({ total: count() }).from(companies).where(where),
    db.select({ all: count() }).from(companies).where(isNull(companies.mergedIntoId)),
  ]);
  const pages = Math.max(1, Math.ceil(Number(total) / COMPANIES_PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const [rows, sponsorFacet, sizeFacet, typeFacet, countryFacet, agencyFacet] = await Promise.all([
    db
      .select({
        id: companies.id,
        name: companies.name,
        domain: companies.domain,
        hqCountry: companies.hqCountry,
        hqCountryName: countries.name,
        sizeBand: companies.sizeBand,
        type: companies.type,
        isAgency: companies.isAgency,
        sponsor: sponsorClassSql,
        summaryJson: companies.sponsorSummaryJson,
        openJobs: openJobsSql,
        aliases: aliasCount,
        parentCompanyId: companies.parentCompanyId,
      })
      .from(companies)
      .leftJoin(countries, eq(countries.iso2, companies.hqCountry))
      .where(where)
      .orderBy(...order)
      .limit(COMPANIES_PAGE_SIZE)
      .offset((page - 1) * COMPANIES_PAGE_SIZE),
    (() => {
      const classes = db
        .select({ v: sql<SponsorClass>`${sponsorClassSql}`.as('v') })
        .from(companies)
        .where(and(...listConditions(f, 'sponsor')))
        .as('classes');
      return db.select({ v: classes.v, n: count() }).from(classes).groupBy(classes.v);
    })(),
    db
      .select({ v: companies.sizeBand, n: count() })
      .from(companies)
      .where(and(...listConditions(f, 'size')))
      .groupBy(companies.sizeBand),
    db
      .select({ v: companies.type, n: count() })
      .from(companies)
      .where(and(...listConditions(f, 'type')))
      .groupBy(companies.type),
    db
      .select({ v: companies.hqCountry, name: countries.name, n: count() })
      .from(companies)
      .leftJoin(countries, eq(countries.iso2, companies.hqCountry))
      .where(and(...listConditions(f, 'country')))
      .groupBy(companies.hqCountry, countries.name),
    db
      .select({ v: companies.isAgency, n: count() })
      .from(companies)
      .where(and(...listConditions(f, 'agency')))
      .groupBy(companies.isAgency),
  ]);
  const byCount = (a: CompanyFacetOption, b: CompanyFacetOption) => b.count - a.count || a.label.localeCompare(b.label);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      hqCountry: r.hqCountry,
      hqCountryName: r.hqCountryName,
      sizeBand: r.sizeBand,
      type: r.type,
      isAgency: r.isAgency,
      sponsor: r.sponsor,
      summary: parseSponsorSummary(r.summaryJson),
      openJobs: Number(r.openJobs),
      aliases: Number(r.aliases),
      parentCompanyId: r.parentCompanyId,
    })),
    total: Number(total),
    all: Number(all),
    page,
    pageSize: COMPANIES_PAGE_SIZE,
    facets: {
      sponsor: sponsorFacet.map((s) => ({ value: s.v, label: s.v, count: Number(s.n) })),
      size: sizeFacet
        .map((s) => ({ value: s.v ?? 'none', label: s.v ?? 'Size unknown', count: Number(s.n) }))
        .sort((a, b) => sizeBandOrder(a.value === 'none' ? '~' : a.value) - sizeBandOrder(b.value === 'none' ? '~' : b.value) || byCount(a, b)),
      type: typeFacet.map((t) => ({ value: t.v, label: t.v, count: Number(t.n) })).sort(byCount),
      country: countryFacet.map((c) => ({ value: c.v ?? 'none', label: c.v ? (c.name ?? c.v) : 'HQ unknown', count: Number(c.n) })).sort(byCount),
      agency: agencyFacet.map((a) => ({ value: a.v ? 'yes' : 'no', label: a.v ? 'Agency' : 'Direct employer', count: Number(a.n) })),
    },
  };
}

// ---- detail ----------------------------------------------------------------------------------

export interface RegisterReceipt {
  evidenceId: number;
  view: RegisterEvidenceView;
  entry: SponsorRegisterEntryRow | null;
  matchStatus: string;
  method: string;
  confidence: string;
  checkedAt: Date;
  logicVersion: string;
  source: string;
  evidence: string | null;
}

export interface NoteReceipt {
  evidenceId: number;
  note: SponsorNoteView;
  url: string | null;
  checkedAt: Date;
}

export interface CompanyRef {
  id: number;
  name: string;
  hqCountry: string | null;
}

export interface CompanyDetail {
  company: CompanyRow;
  /** Set when this record was merged away (the page points to the survivor). */
  mergedInto: CompanyRef | null;
  hqCountryName: string | null;
  names: CompanyName[];
  aliases: Array<{ id: number; alias: string; kind: string; countryIso2: string | null }>;
  parent: CompanyRef | null;
  ancestors: CompanyRef[];
  subsidiaries: CompanyRef[];
  mergedRecords: CompanyRef[];
  /** Names still held by the merged records (splitting one off undoes that merge). */
  mergedAliases: Array<{ id: number; alias: string; kind: string; companyId: number }>;
  summary: SponsorSummaryView | null;
  sponsor: SponsorClass;
  latestNote: SponsorNoteView | null;
  registers: RegisterReceipt[];
  notes: NoteReceipt[];
  agencyNotes: Array<{ evidenceId: number; isAgency: boolean; reason: string | null; checkedAt: Date }>;
  otherEvidence: CompanyEvidenceRow[];
  jobs: Array<{
    id: number;
    title: string;
    countryIso2: string | null;
    city: string | null;
    state: string;
    visaStatus: string | null;
    score: number | null;
    postedAt: Date | null;
    firstSeenAt: Date;
    hidden: boolean;
  }>;
  jobTotal: number;
  applications: Awaited<ReturnType<typeof applicationsForCompany>>;
  duplicates: Array<CompanyRef & { why: string; openJobs: number }>;
}

const JOB_LIMIT = 60;

async function refs(db: DbOrTx, ids: readonly number[]): Promise<CompanyRef[]> {
  if (!ids.length) return [];
  const rows = await db.select({ id: companies.id, name: companies.name, hqCountry: companies.hqCountry }).from(companies).where(inArray(companies.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is CompanyRef => r !== undefined);
}

export async function loadCompany(id: number, opts: { db?: DbOrTx } = {}): Promise<CompanyDetail | null> {
  const db = opts.db ?? getDb();
  const [row] = await db
    .select({ company: companies, hqCountryName: countries.name })
    .from(companies)
    .leftJoin(countries, eq(countries.iso2, companies.hqCountry))
    .where(eq(companies.id, id))
    .limit(1);
  if (!row) return null;
  const c = row.company;
  const mergedInto = c.mergedIntoId !== null ? ((await refs(db, [c.mergedIntoId]))[0] ?? null) : null;

  const [names, aliasRows, family, subsidiaryRows, mergedRows, evidence, jobRows, [{ jobTotal }], dupRows] = await Promise.all([
    companyNames(db, id, { includeSlugs: true }),
    db
      .select({ id: companyAliases.id, alias: companyAliases.alias, kind: companyAliases.kind, countryIso2: companyAliases.countryIso2 })
      .from(companyAliases)
      .where(eq(companyAliases.companyId, id))
      .orderBy(asc(companyAliases.kind), asc(companyAliases.alias)),
    companyFamily(db, id),
    db
      .select({ id: companies.id, name: companies.name, hqCountry: companies.hqCountry })
      .from(companies)
      .where(and(eq(companies.parentCompanyId, id), isNull(companies.mergedIntoId)))
      .orderBy(asc(companies.name))
      .limit(100),
    db
      .select({ id: companies.id, name: companies.name, hqCountry: companies.hqCountry })
      .from(companies)
      .where(eq(companies.mergedIntoId, id))
      .orderBy(asc(companies.name))
      .limit(100),
    db.select().from(companyEvidence).where(eq(companyEvidence.companyId, id)).orderBy(desc(companyEvidence.checkedAt), desc(companyEvidence.id)).limit(200),
    db
      .select({
        id: jobs.id,
        title: jobs.canonicalTitle,
        countryIso2: jobs.countryIso2,
        city: jobs.city,
        state: jobs.state,
        visaStatus: jobs.visaStatus,
        score: jobs.score,
        postedAt: jobs.postedAt,
        firstSeenAt: jobs.firstSeenAt,
        hidden: jobs.hidden,
      })
      .from(jobs)
      .where(and(eq(jobs.companyId, id), isNull(jobs.mergedIntoJobId)))
      .orderBy(desc(jobs.firstSeenAt), desc(jobs.id))
      .limit(JOB_LIMIT),
    db
      .select({ jobTotal: count() })
      .from(jobs)
      .where(and(eq(jobs.companyId, id), isNull(jobs.mergedIntoJobId))),
    c.mergedIntoId === null
      ? db
          .select({ id: companies.id, name: companies.name, hqCountry: companies.hqCountry, normalizedName: companies.normalizedName, domain: companies.domain, openJobs: openJobsSql })
          .from(companies)
          .where(
            and(
              ne(companies.id, id),
              isNull(companies.mergedIntoId),
              or(
                eq(companies.normalizedName, c.normalizedName),
                c.domain ? eq(companies.domain, c.domain) : undefined,
                sql`EXISTS (SELECT 1 FROM ${companyAliases} WHERE ${companyAliases.companyId} = ${companies.id} AND ${companyAliases.normalizedAlias} = ${c.normalizedName})`,
              ),
            ),
          )
          .orderBy(asc(companies.id))
          .limit(12)
      : Promise.resolve([] as Array<CompanyRef & { normalizedName: string; domain: string | null; openJobs: number }>),
  ]);

  const parent = c.parentCompanyId !== null ? ((await refs(db, [c.parentCompanyId]))[0] ?? null) : null;
  const mergedAliases = mergedRows.length
    ? await db
        .select({ id: companyAliases.id, alias: companyAliases.alias, kind: companyAliases.kind, companyId: companyAliases.companyId })
        .from(companyAliases)
        .where(
          inArray(
            companyAliases.companyId,
            mergedRows.map((m) => m.id),
          ),
        )
        .orderBy(asc(companyAliases.companyId), asc(companyAliases.kind), asc(companyAliases.alias))
        .limit(500)
    : [];
  const ancestors = family ? await refs(db, family.ancestors) : [];

  const entryIds = evidence.map((e) => e.registerEntryId).filter((v): v is number => v !== null);
  const entries = entryIds.length ? await db.select().from(sponsorRegisterEntries).where(inArray(sponsorRegisterEntries.id, [...new Set(entryIds)])) : [];
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const registers: RegisterReceipt[] = [];
  const notes: NoteReceipt[] = [];
  const agencyNotes: CompanyDetail['agencyNotes'] = [];
  const otherEvidence: CompanyEvidenceRow[] = [];
  for (const e of evidence) {
    if (e.kind === 'register_match') {
      const view = parseRegisterEvidence(e.valueJson, e.source);
      if (view) {
        registers.push({
          evidenceId: e.id,
          view,
          entry: e.registerEntryId !== null ? (entryById.get(e.registerEntryId) ?? null) : null,
          matchStatus: e.matchStatus,
          method: e.method,
          confidence: e.confidence,
          checkedAt: e.checkedAt,
          logicVersion: e.logicVersion,
          source: e.source,
          evidence: e.evidence,
        });
        continue;
      }
    }
    if (e.kind === 'manual_note') {
      const note = parseSponsorNote(e.valueJson);
      if (note) {
        const url = (e.valueJson as { url?: unknown } | null)?.url;
        notes.push({ evidenceId: e.id, note, url: typeof url === 'string' ? url : null, checkedAt: e.checkedAt });
        continue;
      }
      const agency = parseAgencyNote(e.valueJson);
      if (agency !== null) {
        agencyNotes.push({ evidenceId: e.id, isAgency: agency, reason: e.evidence, checkedAt: e.checkedAt });
        continue;
      }
    }
    otherEvidence.push(e);
  }
  // The class uses the latest note by id — the same order as the SQL.
  const latest = [...notes].sort((a, b) => b.evidenceId - a.evidenceId)[0]?.note ?? null;
  const summary = parseSponsorSummary(c.sponsorSummaryJson);

  const appNames = [...new Set(names.filter((n) => n.kind === 'name' || n.kind === 'brand' || n.kind === 'legal').map((n) => n.name))].slice(0, 50);
  const companyIds = [id, ...mergedRows.map((m) => m.id)];
  const apps = await applicationsForCompany(db, companyIds, appNames);

  const dupes = dupRows.map((d) => ({
    id: d.id,
    name: d.name,
    hqCountry: d.hqCountry,
    openJobs: Number(d.openJobs),
    why: d.normalizedName === c.normalizedName ? 'Same normalised name' : c.domain && d.domain === c.domain ? `Same domain (${c.domain})` : 'One of its names matches this name',
  }));

  return {
    company: c,
    mergedInto,
    hqCountryName: row.hqCountryName,
    names,
    aliases: aliasRows,
    parent,
    ancestors,
    subsidiaries: subsidiaryRows,
    mergedRecords: mergedRows,
    mergedAliases,
    summary,
    sponsor: sponsorClass(summary, latest),
    latestNote: latest,
    registers,
    notes,
    agencyNotes,
    otherEvidence,
    jobs: jobRows,
    jobTotal: Number(jobTotal),
    applications: apps,
    duplicates: dupes,
  };
}
