import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, titleReviewQueue } from '@/db/schema';
import { countUnrelatedTitles, ignoreUnrelatedTitles, looksTechnical } from '@/lib/normalize/title-tidy';
import { startTestDb, type TestDb } from '../helpers/db';

describe('looksTechnical', () => {
  it.each([
    'Forward Deployed Engineer',
    'Staff Software Engineer, Infrastructure',
    'Head of Security',
    'Werkstudent (w/m/d) Shared Network Infrastructure',
    'Senior Softwareentwickler - Subscription Management',
    'Developer Relations Engineer',
    'IT Support Specialist',
    'Platform Lead',
    'Technical Success Manager',
    'Data Analyst',
  ])('keeps “%s” for a human', (title) => expect(looksTechnical(title)).toBe(true));

  it.each([
    'Grocery Associate',
    'Account Development Representative',
    'Engagement Manager',
    'Deal Desk Analyst',
    'Senior FP&A Analyst',
    'PR Manager, Japan',
    'Bilingual Hybrid Development Representative - Mandarin',
    'Quereinsteiger Installationsbereich (m/w/d) Wärmepumpen',
    'Bauleiter (m/w/d) SHK für Wärmepumpenprojekte',
    'Recruiter, Talent Acquisition',
  ])('treats “%s” as clearly unrelated', (title) => expect(looksTechnical(title)).toBe(false));

  it('does not match inside other words (“it” in “Sitecore”, “ai” in “Mail”)', () => {
    expect(looksTechnical('Mail Room Clerk')).toBe(false);
    expect(looksTechnical('Waitress')).toBe(false);
  });
});

describe('unknown title queue tidy', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
  }, 240_000);
  afterAll(async () => {
    await t?.stop();
  });
  beforeEach(async () => {
    await t.truncateAll();
    await t.db.insert(titleReviewQueue).values([
      { titleRaw: 'Grocery Associate', normalized: 'grocery associate', count: 14 },
      { titleRaw: 'Deal Desk Analyst', normalized: 'deal desk analyst', count: 9 },
      { titleRaw: 'Forward Deployed Engineer', normalized: 'forward deployed engineer', count: 51 },
      { titleRaw: 'Old decision', normalized: 'old decision', count: 2, status: 'mapped', mappedRoleKey: 'devsecops_engineer' },
    ]);
  });

  it('counts only open titles without a technical word', async () => {
    expect(await countUnrelatedTitles(t.db)).toEqual({ unrelated: 2, total: 3 });
  });

  it('ignores them (status only), leaves technical and already-decided titles, audits once, and is idempotent', async () => {
    expect(await ignoreUnrelatedTitles(t.db)).toEqual({ ignored: 2 });
    const rows = await t.db.select().from(titleReviewQueue);
    const by = Object.fromEntries(rows.map((r) => [r.normalized, r.status]));
    expect(by).toEqual({ 'grocery associate': 'ignored', 'deal desk analyst': 'ignored', 'forward deployed engineer': 'open', 'old decision': 'mapped' });
    expect(rows.find((r) => r.normalized === 'grocery associate')?.decidedAt).not.toBeNull();
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, 'title.bulk_ignore'));
    expect(audits).toHaveLength(1);
    expect(audits[0].afterJson).toEqual({ ignored: 2 });
    expect(await ignoreUnrelatedTitles(t.db)).toEqual({ ignored: 0 });
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'title.bulk_ignore'))).toHaveLength(1);
  });
});
