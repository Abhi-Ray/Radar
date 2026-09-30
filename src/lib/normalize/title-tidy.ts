/**
 * Unknown-title queue housekeeping (docs/USER_GUIDE.md → Review).
 *
 * The queue holds every title the mapper could not place. Crawling whole company boards fills it
 * with sales, HR, retail and trades titles (70% of the first crawl's 2,739 titles). Those are
 * already scored as "not a target role", so deciding them by hand changes nothing: a title with NO
 * technical word in it is marked "ignored" in one go (status only — no title_overrides entry, so
 * the mapper behaves exactly as before). Anything with a technical word stays for a human,
 * because "Forward Deployed Engineer" or "Staff Software Engineer, Infrastructure" may deserve a
 * role of their own.
 */
import { sql } from 'drizzle-orm';
import { audit, type AuditInput } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { log } from '../log';

/** Words that make an unplaced title worth a human look. Deliberately generous. */
const TECHNICAL =
  /(security|secur|sicherheit|cyber|devops|devsecops|\bsre\b|site reliability|reliab|cloud|infrastruct|platform|kubernetes|\bk8s\b|\baws\b|azure|\bgcp\b|terraform|backend|back-end|back end|frontend|front-end|front end|full[- ]?stack|fullstack|\bnode\b|next\.?js|react|typescript|javascript|python|golang|\bjava\b|software|developer|programmer|programm|entwickler|engineer|ingenieur|architect|architekt|sysadmin|system administrator|systems? admin|\bit\b|network|netzwerk|\bdata\b|machine learning|\bml\b|\bai\b|\bapi\b|integration|automation|\bqa\b|\btest|tech)/i;

/** True when the title contains at least one technical word (so a person should decide it). */
export function looksTechnical(title: string): boolean {
  return TECHNICAL.test(title);
}

export interface TitleTidyOptions {
  actor?: AuditInput['actor'];
  ip?: string | null;
}

type Row = { id?: unknown; title_raw?: unknown };

/** Ids of open queue rows whose title has no technical word. */
async function unrelatedIds(db: DbOrTx): Promise<{ ids: number[]; total: number }> {
  const res = await db.execute(sql`SELECT id, title_raw FROM title_review_queue WHERE status = 'open'`);
  const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : []) as Row[];
  const ids: number[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    if (Number.isSafeInteger(id) && id > 0 && !looksTechnical(String(r.title_raw ?? ''))) ids.push(id);
  }
  return { ids, total: rows.length };
}

export async function countUnrelatedTitles(db: DbOrTx): Promise<{ unrelated: number; total: number }> {
  const { ids, total } = await unrelatedIds(db);
  return { unrelated: ids.length, total };
}

/** Marks every open title without a technical word as "ignored". One audit row with the count. */
export async function ignoreUnrelatedTitles(db: DbOrTx, opts: TitleTidyOptions = {}): Promise<{ ignored: number }> {
  const { ids } = await unrelatedIds(db);
  if (!ids.length) return { ignored: 0 };
  const reason = 'No technical word in the title (sales, HR, retail, trades …): not a role I track';
  const ignored = await withTransaction(db, async (tx) => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const res = await tx.execute(
        sql`UPDATE title_review_queue SET status = 'ignored', decided_at = UTC_TIMESTAMP(3) WHERE status = 'open' AND id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`,
      );
      const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number };
      n += Number(header?.affectedRows ?? 0) || 0;
    }
    if (n > 0) await audit(tx, { action: 'title.bulk_ignore', entityType: 'title_review', after: { ignored: n }, reason, actor: opts.actor ?? 'admin', ip: opts.ip ?? null });
    return n;
  });
  log.info('unknown titles tidied', { ignored });
  return { ignored };
}
