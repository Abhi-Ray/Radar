// STUB(NORMALIZE): minimal but real find-or-create by normalised name (no aliases, domains or
// agency detection yet). Replace with full company identity; keep the exported signature.
import { and, asc, eq, isNull } from 'drizzle-orm';
import { companies } from '../../db/schema';
import { withTransaction, type DbOrTx } from '../db';

export const COMPANY_LOGIC_VERSION = 'company-stub-0';

const LEGAL_SUFFIXES =
  /\b(?:inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|sarl|bv|b\.v|nv|n\.v|plc|srl|spa|s\.p\.a|oy|ab|as|aps|kg|co|corp|corporation|company|pty|pte|kk)\.?$/i;

/** Lowercased name without punctuation and trailing legal suffixes (≤191 chars). */
export function normalizeCompanyName(name: string): string {
  let n = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}.\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i++) {
    const next = n.replace(LEGAL_SUFFIXES, '').replace(/[\s.]+$/, '').trim();
    if (next === n || !next) break;
    n = next;
  }
  return n.replace(/\./g, '').slice(0, 191);
}

export async function resolveCompany(
  db: DbOrTx,
  input: { name: string; domain?: string | null; countryIso2?: string | null; atsSlug?: string | null },
): Promise<{ companyId: number; isAgency: boolean; confidence: number; created: boolean }> {
  const name = (input.name ?? '').trim().slice(0, 255) || 'Unknown company';
  const normalizedName = normalizeCompanyName(name) || 'unknown company';
  return withTransaction(db, async (tx) => {
    const [existing] = await tx
      .select({ id: companies.id, isAgency: companies.isAgency, mergedIntoId: companies.mergedIntoId })
      .from(companies)
      .where(and(eq(companies.normalizedName, normalizedName), isNull(companies.mergedIntoId)))
      .orderBy(asc(companies.id))
      .limit(1);
    if (existing) return { companyId: existing.id, isAgency: existing.isAgency, confidence: 0.6, created: false };
    const [res] = await tx.insert(companies).values({
      name,
      normalizedName,
      domain: input.domain?.trim().toLowerCase().slice(0, 191) || null,
      hqCountry: input.countryIso2 && /^[A-Za-z]{2}$/.test(input.countryIso2) ? input.countryIso2.toUpperCase() : null,
    });
    return { companyId: Number(res.insertId), isAgency: false, confidence: 0.5, created: true };
  });
}
