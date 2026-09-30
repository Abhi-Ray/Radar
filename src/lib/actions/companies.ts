'use server';
/**
 * /companies mutations (spec §11.2, §13.2): merge / split (src/lib/company/manual.ts, which runs
 * the transaction and writes the audit row), the agency flag, the parent link and my own sponsor
 * note. Every action: requireSession → zod → write + audit → refresh.
 *
 * The sponsor note is a `company_evidence` row: kind `manual_note`, method `manual`, confidence
 * high, value `{field:'sponsors', sponsors, note, url?}` — the shape the visa engine reads
 * (`parseSponsorsFlag`: `sponsors` + `note`). Notes are never edited: a newer note supersedes.
 */
import { eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { z } from 'zod';
import { companies, companyEvidence } from '@/db/schema';
import { audit } from '@/lib/audit';
import { mergeCompanies, setCompanyAgency, setParentCompany, splitCompany, type ManualCompanyResult } from '@/lib/company/manual';
import { getDb } from '@/lib/db';
import { actor, done, fail, firstIssue, formList, formObject, unexpected, zId, zOptionalId, zOptionalText, zOptionalUrl, zReason, type ActionState } from '@/lib/tracker/action-kit';

/** logic_version of my own sponsor notes (no algorithm involved). */
const SPONSOR_NOTE_LOGIC = 'manual';

class CompanyActionError extends Error {}

function oops(what: string, err: unknown): ActionState {
  return unexpected('companies', what, err, [CompanyActionError]);
}

function fromManual(r: ManualCompanyResult, href?: string): ActionState {
  if (!r.ok) return fail(r.message);
  return done(r.message, { id: r.newCompanyId ?? r.companyId, href });
}

const ids = (formData: FormData, key: string) =>
  z.array(zId).max(500, 'Pick fewer items (≤ 500).').safeParse(formList(formData, key).filter((v) => v !== ''));

// ---- merge / split ---------------------------------------------------------------------------

const mergeSchema = z.object({ keepId: zId, dropId: z.coerce.number({ error: 'Give the company number to merge in.' }).int().positive('Give the company number to merge in.'), reason: zReason });

export async function mergeCompaniesAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = mergeSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  let r: ManualCompanyResult;
  try {
    r = await mergeCompanies(getDb(), d.keepId, d.dropId, d.reason, { ip });
  } catch (err) {
    return oops('merge the companies', err);
  }
  if (r.ok && !r.noop) refresh();
  return fromManual(r, `/companies/${d.keepId}`);
}

const splitSchema = z.object({ companyId: zId, name: zOptionalText(255, 'The new name'), reason: zReason });

export async function splitCompanyAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = splitSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const aliasIds = ids(formData, 'aliasId');
  const jobIds = ids(formData, 'jobId');
  if (!aliasIds.success || !jobIds.success) return fail('Some of the picked items are not valid.');
  if (!aliasIds.data.length) return fail('Tick the names that belong to the other company.');
  const d = parsed.data;
  let r: ManualCompanyResult;
  try {
    r = await splitCompany(getDb(), d.companyId, aliasIds.data, d.reason, { ip, name: d.name, jobIds: jobIds.data });
  } catch (err) {
    return oops('split the company', err);
  }
  if (r.ok && !r.noop) refresh();
  const other = r.newCompanyId ?? null;
  return fromManual(r, other ? `/companies/${other}` : undefined);
}

// ---- agency / parent -------------------------------------------------------------------------

const agencySchema = z.object({ companyId: zId, isAgency: z.enum(['yes', 'no'], 'Say whether it is an agency.'), reason: zReason });

export async function setAgencyAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = agencySchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  let r: ManualCompanyResult;
  try {
    r = await setCompanyAgency(getDb(), d.companyId, d.isAgency === 'yes', d.reason, { ip });
  } catch (err) {
    return oops('change the agency flag', err);
  }
  if (r.ok && !r.noop) refresh();
  return fromManual(r);
}

const parentSchema = z.object({ companyId: zId, parentId: zOptionalId, reason: zReason });

export async function setParentAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = parentSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  let r: ManualCompanyResult;
  try {
    r = await setParentCompany(getDb(), d.companyId, d.parentId, d.reason, { ip });
  } catch (err) {
    return oops('change the parent company', err);
  }
  if (r.ok && !r.noop) refresh();
  return fromManual(r);
}

// ---- my sponsor note -------------------------------------------------------------------------

const noteSchema = z.object({
  companyId: zId,
  sponsors: z.enum(['yes', 'no'], 'Say whether they sponsor visas.'),
  note: z.string().trim().min(3, 'Say how you know (3+ characters): who said it, where, when.').max(2000, 'Keep the note under 2000 characters.'),
  url: zOptionalUrl,
});

export async function addSponsorNoteAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = noteSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  const sponsors = d.sponsors === 'yes';
  let name: string;
  try {
    name = await getDb().transaction(async (tx) => {
      const [c] = await tx
        .select({ id: companies.id, name: companies.name, mergedIntoId: companies.mergedIntoId })
        .from(companies)
        .where(eq(companies.id, d.companyId))
        .limit(1)
        .for('update');
      if (!c) throw new CompanyActionError(`Company #${d.companyId} does not exist.`);
      if (c.mergedIntoId !== null) throw new CompanyActionError(`Company #${c.id} was merged into #${c.mergedIntoId}; add the note there.`);
      const valueJson = { field: 'sponsors', sponsors, note: d.note, ...(d.url ? { url: d.url } : {}) };
      const [res] = await tx.insert(companyEvidence).values({
        companyId: c.id,
        kind: 'manual_note',
        valueJson,
        evidence: d.note,
        source: d.url ?? 'manual',
        method: 'manual',
        confidence: 'high',
        matchStatus: 'confirmed',
        logicVersion: SPONSOR_NOTE_LOGIC,
      });
      await audit(tx, {
        action: 'company.sponsor_note',
        entityType: 'company',
        entityId: c.id,
        after: { evidenceId: Number(res.insertId), ...valueJson },
        reason: d.note,
        ip,
      });
      return c.name;
    });
  } catch (err) {
    return oops('save the sponsor note', err);
  }
  refresh();
  return done(sponsors ? `Noted: ${name} sponsors visas (your evidence).` : `Noted: ${name} does not sponsor visas (your evidence).`, { id: d.companyId });
}
