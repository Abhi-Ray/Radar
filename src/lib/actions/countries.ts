'use server';
/**
 * /countries mutations (spec §4, §13.1): verify a rule version today, add a new rule version (old
 * versions are never overwritten), switch a country live (only with a verified, fresh rule in
 * effect) and mark a changed official page as reviewed. Every action: requireSession → zod → one
 * transaction with the change-log row (visa_rule_changes) and the audit row → refresh.
 *
 * The rule writes follow src/lib/visa/rules.ts (addRuleVersion / markRuleVerified /
 * markPageReviewed) one to one — same version numbering, 90-day review, change-log wording.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { z } from 'zod';
import { countries, officialPageWatches, visaRoutes, visaRuleChanges, visaRuleVersions } from '@/db/schema';
import { REVIEW_INTERVAL_DAYS, goLiveCheck, isDay, ruleInEffect, utcDayOf } from '@/components/countries/model';
import { audit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { DAY_MS } from '@/lib/time';
import { actor, done, fail, firstIssue, formObject, unexpected, zFlag, zId, zOptionalText, zOptionalUrl, zReason, type ActionState } from '@/lib/tracker/action-kit';

const ACTOR = 'admin' as const;

class CountryActionError extends Error {}

function oops(what: string, err: unknown): ActionState {
  return unexpected('countries', what, err, [CountryActionError]);
}

function describeRule(route: { countryIso2: string; code: string }, version: number): string {
  return `${route.countryIso2} ${route.code} v${version}`;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ---- mark verified today ---------------------------------------------------------------------

const verifySchema = z.object({ ruleVersionId: zId, note: zOptionalText(1000, 'The note') });

export async function markRuleVerifiedAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = verifySchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { ruleVersionId, note } = parsed.data;
  const now = new Date();
  let label: string;
  try {
    label = await getDb().transaction(async (tx) => {
      const [rule] = await tx.select().from(visaRuleVersions).where(eq(visaRuleVersions.id, ruleVersionId)).limit(1).for('update');
      if (!rule) throw new CountryActionError('That rule version no longer exists.');
      const [route] = await tx.select().from(visaRoutes).where(eq(visaRoutes.id, rule.routeId)).limit(1);
      const before = { verificationStatus: rule.verificationStatus, lastVerifiedAt: rule.lastVerifiedAt, nextReviewAt: rule.nextReviewAt, verifiedBy: rule.verifiedBy };
      const after = {
        verificationStatus: 'verified' as const,
        lastVerifiedAt: now,
        nextReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_DAYS * DAY_MS),
        verifiedBy: ACTOR,
      };
      await tx.update(visaRuleVersions).set(after).where(eq(visaRuleVersions.id, ruleVersionId));
      const what = `${route ? describeRule(route, rule.version) : `rule ${ruleVersionId}`} verified`;
      await tx.insert(visaRuleChanges).values({
        routeId: rule.routeId,
        ruleVersionId,
        changeKind: 'verified',
        what,
        why: note,
        sourceUrl: rule.officialSourceUrl,
        beforeJson: { ...before, lastVerifiedAt: iso(before.lastVerifiedAt), nextReviewAt: iso(before.nextReviewAt) },
        afterJson: { ...after, lastVerifiedAt: iso(after.lastVerifiedAt), nextReviewAt: iso(after.nextReviewAt) },
        actor: ACTOR,
        changedAt: now,
      });
      await audit(tx, { action: 'visa_rule.verify', entityType: 'visa_rule_version', entityId: ruleVersionId, before, after, reason: note, actor: ACTOR, ip });
      return route ? `${route.name} v${rule.version}` : `Rule v${rule.version}`;
    });
  } catch (err) {
    return oops('mark the rule verified', err);
  }
  refresh();
  return done(`${label} verified today — next review ${utcDayOf(new Date(now.getTime() + REVIEW_INTERVAL_DAYS * DAY_MS))}.`, { id: ruleVersionId });
}

// ---- add rule version ------------------------------------------------------------------------

const money = z
  .union([z.literal(''), z.coerce.number({ error: 'Use a whole number.' }).int('Use a whole number.').min(0, 'Use a positive amount.').max(10_000_000, 'That amount is too large.')])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

const addSchema = z.object({
  routeId: zId,
  effectiveFrom: z.string().refine(isDay, 'Give the day the rule takes effect (YYYY-MM-DD).'),
  effectiveTo: z
    .union([z.literal(''), z.string().refine(isDay, 'The end day must be a real date (YYYY-MM-DD).')])
    .optional()
    .transform((v) => (v ? v : null)),
  salaryThresholdEur: money,
  salaryThresholdLocal: money,
  currency: z
    .union([z.literal(''), z.string().trim().regex(/^[A-Za-z]{3}$/, 'Currency is a 3-letter code (EUR, GBP…).')])
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  degreeRule: zOptionalText(4000, 'The degree rule'),
  experienceRule: zOptionalText(4000, 'The experience rule'),
  ruleText: zOptionalText(20_000, 'The rule text'),
  officialSourceUrl: zOptionalUrl,
  changeReason: zReason,
  verified: zFlag,
});

export async function addRuleVersionAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = addSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  if (d.effectiveTo && d.effectiveTo < d.effectiveFrom) return fail('The end day is before the start day.');
  const now = new Date();
  let result: { id: number; version: number; label: string };
  try {
    result = await getDb().transaction(async (tx) => {
      const [route] = await tx.select().from(visaRoutes).where(eq(visaRoutes.id, d.routeId)).limit(1).for('update');
      if (!route) throw new CountryActionError('That visa route no longer exists.');
      const [last] = await tx
        .select({ version: visaRuleVersions.version })
        .from(visaRuleVersions)
        .where(eq(visaRuleVersions.routeId, d.routeId))
        .orderBy(desc(visaRuleVersions.version))
        .limit(1);
      const version = (last?.version ?? 0) + 1;
      const row = {
        routeId: d.routeId,
        version,
        effectiveFrom: d.effectiveFrom,
        effectiveTo: d.effectiveTo,
        salaryThresholdEur: d.salaryThresholdEur,
        salaryThresholdLocal: d.salaryThresholdLocal,
        currency: d.currency,
        degreeRule: d.degreeRule,
        experienceRule: d.experienceRule,
        otherRulesJson: null,
        ruleText: d.ruleText,
        officialSourceUrl: d.officialSourceUrl ?? route.officialUrl ?? null,
        verificationStatus: d.verified ? ('verified' as const) : ('unverified' as const),
        lastVerifiedAt: d.verified ? now : null,
        nextReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_DAYS * DAY_MS),
        verifiedBy: d.verified ? ACTOR : null,
        changeReason: d.changeReason,
      };
      const [res] = await tx.insert(visaRuleVersions).values(row);
      const id = Number(res.insertId);
      await tx.insert(visaRuleChanges).values({
        routeId: d.routeId,
        ruleVersionId: id,
        changeKind: 'created',
        what: `${describeRule(route, version)} added (effective ${d.effectiveFrom})`,
        why: d.changeReason,
        sourceUrl: row.officialSourceUrl,
        beforeJson: null,
        afterJson: { ...row, lastVerifiedAt: iso(row.lastVerifiedAt), nextReviewAt: iso(row.nextReviewAt) },
        actor: ACTOR,
        changedAt: now,
      });
      await audit(tx, { action: 'visa_rule.create', entityType: 'visa_rule_version', entityId: id, after: row, reason: d.changeReason, actor: ACTOR, ip });
      return { id, version, label: route.name };
    });
  } catch (err) {
    return oops('add the rule version', err);
  }
  refresh();
  return done(`${result.label} v${result.version} added (effective ${d.effectiveFrom}). Earlier versions are unchanged.`, { id: result.id });
}

// ---- country live ----------------------------------------------------------------------------

const liveSchema = z.object({
  iso2: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Pick a country.').transform((v) => v.toUpperCase()),
  live: zFlag,
  reason: zOptionalText(500, 'The reason'),
});

export async function setCountryLiveAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = liveSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let name: string;
  try {
    name = await getDb().transaction(async (tx) => {
      const [c] = await tx.select().from(countries).where(eq(countries.iso2, d.iso2)).limit(1).for('update');
      if (!c) throw new CountryActionError(`Unknown country “${d.iso2}”.`);
      if (c.isLive === d.live) throw new CountryActionError(`${c.name} is already ${d.live ? 'live' : 'off'}.`);
      let check: Record<string, unknown> | null = null;
      if (d.live) {
        const routes = await tx
          .select({ id: visaRoutes.id })
          .from(visaRoutes)
          .where(and(eq(visaRoutes.countryIso2, c.iso2), eq(visaRoutes.isActive, true)));
        const versions = routes.length ? await tx.select().from(visaRuleVersions).where(inArray(visaRuleVersions.routeId, routes.map((r) => r.id))) : [];
        const today = utcDayOf(now);
        const current = routes
          .map((r) => ruleInEffect(versions.filter((v) => v.routeId === r.id), today))
          .filter((v): v is NonNullable<typeof v> => v !== null);
        const verdict = goLiveCheck(current, now);
        if (!verdict.ok) throw new CountryActionError(`${c.name} stays off: ${verdict.reason}`);
        check = { rulesInEffect: current.map((v) => ({ id: v.id, version: v.version, lastVerifiedAt: iso(v.lastVerifiedAt) })) };
      }
      await tx.update(countries).set({ isLive: d.live }).where(eq(countries.iso2, c.iso2));
      await audit(tx, {
        action: d.live ? 'country.go_live' : 'country.go_off',
        entityType: 'country',
        entityId: c.iso2,
        before: { isLive: c.isLive },
        after: { isLive: d.live, ...(check ?? {}) },
        reason: d.reason,
        actor: ACTOR,
        ip,
      });
      return c.name;
    });
  } catch (err) {
    return oops(d.live ? 'switch the country live' : 'switch the country off', err);
  }
  refresh();
  return done(d.live ? `${name} is live — its jobs are in scope.` : `${name} is off — its jobs leave the scope.`);
}

// ---- official page reviewed ------------------------------------------------------------------

const pageSchema = z.object({ watchId: zId, note: zOptionalText(1000, 'The note') });

export async function markPageReviewedAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = pageSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { watchId, note } = parsed.data;
  try {
    await getDb().transaction(async (tx) => {
      const [w] = await tx.select().from(officialPageWatches).where(eq(officialPageWatches.id, watchId)).limit(1).for('update');
      if (!w) throw new CountryActionError('That page watch no longer exists.');
      if (w.status === 'ok') throw new CountryActionError('That page is already marked reviewed.');
      await tx.update(officialPageWatches).set({ status: 'ok' }).where(eq(officialPageWatches.id, watchId));
      await audit(tx, {
        action: 'visa_page.reviewed',
        entityType: 'official_page_watch',
        entityId: watchId,
        before: { status: w.status },
        after: { status: 'ok' },
        reason: note,
        actor: ACTOR,
        ip,
      });
    });
  } catch (err) {
    return oops('mark the page reviewed', err);
  }
  refresh();
  return done('Page marked reviewed. If the rule changed, add a new rule version.');
}
