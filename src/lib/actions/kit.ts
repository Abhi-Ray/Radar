'use server';
/**
 * /kit mutations (spec §22): resume versions and templates (cover letters, outreach, checklists,
 * per-country CV conventions). Every action: requireSession → zod → write + audit row in one
 * transaction → refresh. Deleting keeps the full text in the audit row, so nothing is lost.
 */
import { count, eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { z } from 'zod';
import { applications, countries, resumeVersions, templates } from '@/db/schema';
import { RESUME_TRACKS, TEMPLATE_KINDS } from '@/db/schema/_enums';
import { MAX_MARKDOWN } from '@/components/kit/markdown';
import { MAX_FIELDS, fieldsToJson, parseFieldLines } from '@/components/kit/template';
import { audit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { sha256Hex } from '@/lib/hash';
import { actor, done, fail, firstIssue, formObject, unexpected, zFlag, zId, zOptionalId, zOptionalIso2, zOptionalText, type ActionState } from '@/lib/tracker/action-kit';

class KitError extends Error {}

function oops(what: string, err: unknown): ActionState {
  return unexpected('kit', what, err, [KitError]);
}

const markdown = (label: string) =>
  z
    .string()
    .max(MAX_MARKDOWN, `${label} is too long (max ${MAX_MARKDOWN.toLocaleString('en')} characters).`)
    .transform((v) => v.replace(/\r\n?/g, '\n'))
    .refine((v) => v.trim().length > 0, `${label} is empty.`);

function contentSummary(md: string) {
  return { chars: md.length, sha256: sha256Hex(md) };
}

// ---- resume versions -------------------------------------------------------------------------

const resumeSchema = z.object({
  id: zOptionalId,
  name: z.string().trim().min(1, 'Name the version (e.g. “Cloud security · EU · Sep 2026”).').max(191, 'Keep the name under 191 characters.'),
  track: z.enum(RESUME_TRACKS, 'Pick a track.'),
  contentMd: markdown('The resume'),
  fileNote: zOptionalText(512, 'The file note'),
  asNew: zFlag,
});

export async function saveResumeAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = resumeSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  const values = { name: d.name, track: d.track, contentMd: d.contentMd, fileNote: d.fileNote };
  let id: number;
  let created = false;
  try {
    id = await getDb().transaction(async (tx) => {
      if (d.id && !d.asNew) {
        const [before] = await tx.select().from(resumeVersions).where(eq(resumeVersions.id, d.id)).limit(1).for('update');
        if (!before) throw new KitError(`Resume version ${d.id} no longer exists.`);
        const same = before.name === d.name && before.track === d.track && before.contentMd === d.contentMd && (before.fileNote ?? null) === d.fileNote;
        if (same) throw new KitError('Nothing changed.');
        await tx.update(resumeVersions).set(values).where(eq(resumeVersions.id, d.id));
        await audit(tx, {
          action: 'resume.update',
          entityType: 'resume_version',
          entityId: d.id,
          before: { name: before.name, track: before.track, fileNote: before.fileNote, ...contentSummary(before.contentMd), contentMd: before.contentMd },
          after: { name: d.name, track: d.track, fileNote: d.fileNote, ...contentSummary(d.contentMd) },
          ip,
        });
        return d.id;
      }
      if (d.id) {
        const [src] = await tx.select({ id: resumeVersions.id }).from(resumeVersions).where(eq(resumeVersions.id, d.id)).limit(1);
        if (!src) throw new KitError(`Resume version ${d.id} no longer exists.`);
      }
      const [res] = await tx.insert(resumeVersions).values(values);
      const newId = Number(res.insertId);
      created = true;
      await audit(tx, {
        action: 'resume.create',
        entityType: 'resume_version',
        entityId: newId,
        after: { name: d.name, track: d.track, fileNote: d.fileNote, ...contentSummary(d.contentMd), ...(d.id ? { copiedFrom: d.id } : {}) },
        ip,
      });
      return newId;
    });
  } catch (err) {
    return oops('save the resume version', err);
  }
  refresh();
  return done(created ? (d.id ? `Saved as a new version: ${d.name}.` : `Resume version created: ${d.name}.`) : `Saved: ${d.name}.`, { id, href: `/kit?resume=${id}` });
}

const deleteSchema = z.object({ id: zId });

export async function deleteResumeAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = deleteSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const id = parsed.data.id;
  let name: string;
  try {
    name = await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(resumeVersions).where(eq(resumeVersions.id, id)).limit(1).for('update');
      if (!row) throw new KitError('That resume version is already gone.');
      const [{ n }] = await tx.select({ n: count() }).from(applications).where(eq(applications.resumeVersionId, id));
      if (n > 0) {
        throw new KitError(
          `“${row.name}” is recorded on ${n} application${n === 1 ? '' : 's'}; it stays so the logbook still says what you sent. Save a new version instead.`,
        );
      }
      await tx.delete(resumeVersions).where(eq(resumeVersions.id, id));
      await audit(tx, {
        action: 'resume.delete',
        entityType: 'resume_version',
        entityId: id,
        before: { name: row.name, track: row.track, fileNote: row.fileNote, ...contentSummary(row.contentMd), contentMd: row.contentMd },
        ip,
      });
      return row.name;
    });
  } catch (err) {
    return oops('delete the resume version', err);
  }
  refresh();
  return done(`Deleted “${name}”. Its text is kept in the audit log.`, { href: '/kit' });
}

// ---- templates -------------------------------------------------------------------------------

const templateSchema = z.object({
  id: zOptionalId,
  kind: z.enum(TEMPLATE_KINDS, 'Pick what kind of template it is.'),
  name: z.string().trim().min(1, 'Name the template.').max(191, 'Keep the name under 191 characters.'),
  bodyMd: markdown('The template'),
  fieldLines: zOptionalText(8000, 'The field list'),
  countryIso2: zOptionalIso2,
});

export async function saveTemplateAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = templateSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  if (d.kind === 'cv_convention' && !d.countryIso2) return fail('A CV convention belongs to one country — pick it.');
  const { fields, bad } = parseFieldLines(d.fieldLines ?? '');
  if (bad.length) return fail(`These field lines are not “key | Label | hint”: ${bad.slice(0, 3).join(', ')}. Keys start with a letter (letters, digits, _ . -).`);
  if (fields.length > MAX_FIELDS) return fail(`Keep it to ${MAX_FIELDS} fields.`);
  const values = { kind: d.kind, name: d.name, bodyMd: d.bodyMd, fieldsJson: fields.length ? fieldsToJson(fields) : null, countryIso2: d.countryIso2 };
  let id: number;
  let created = false;
  try {
    id = await getDb().transaction(async (tx) => {
      if (d.countryIso2) {
        const [c] = await tx.select({ iso2: countries.iso2 }).from(countries).where(eq(countries.iso2, d.countryIso2)).limit(1);
        if (!c) throw new KitError(`Unknown country “${d.countryIso2}”.`);
      }
      if (d.id) {
        const [before] = await tx.select().from(templates).where(eq(templates.id, d.id)).limit(1).for('update');
        if (!before) throw new KitError(`Template ${d.id} no longer exists.`);
        await tx.update(templates).set(values).where(eq(templates.id, d.id));
        await audit(tx, {
          action: 'template.update',
          entityType: 'template',
          entityId: d.id,
          before: { kind: before.kind, name: before.name, countryIso2: before.countryIso2, fieldsJson: before.fieldsJson, bodyMd: before.bodyMd },
          after: { kind: d.kind, name: d.name, countryIso2: d.countryIso2, fieldsJson: values.fieldsJson, ...contentSummary(d.bodyMd) },
          ip,
        });
        return d.id;
      }
      const [res] = await tx.insert(templates).values(values);
      const newId = Number(res.insertId);
      created = true;
      await audit(tx, {
        action: 'template.create',
        entityType: 'template',
        entityId: newId,
        after: { kind: d.kind, name: d.name, countryIso2: d.countryIso2, fieldsJson: values.fieldsJson, ...contentSummary(d.bodyMd) },
        ip,
      });
      return newId;
    });
  } catch (err) {
    return oops('save the template', err);
  }
  refresh();
  return done(created ? `Template created: ${d.name}.` : `Saved: ${d.name}.`, { id, href: `/kit?tab=templates&template=${id}` });
}

export async function deleteTemplateAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = deleteSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const id = parsed.data.id;
  let name: string;
  try {
    name = await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(templates).where(eq(templates.id, id)).limit(1).for('update');
      if (!row) throw new KitError('That template is already gone.');
      await tx.delete(templates).where(eq(templates.id, id));
      await audit(tx, {
        action: 'template.delete',
        entityType: 'template',
        entityId: id,
        before: { kind: row.kind, name: row.name, countryIso2: row.countryIso2, fieldsJson: row.fieldsJson, bodyMd: row.bodyMd },
        ip,
      });
      return row.name;
    });
  } catch (err) {
    return oops('delete the template', err);
  }
  refresh();
  return done(`Deleted “${name}”. Its text is kept in the audit log.`, { href: '/kit?tab=templates' });
}
