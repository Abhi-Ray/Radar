/** Small DB helpers shared by the pipeline stages. */
import { withTransaction, type Db, type Tx } from '../../db';

/** MySQL errnos that mean "retry the whole transaction". */
export const ER_LOCK_DEADLOCK = 1213;
export const ER_LOCK_WAIT_TIMEOUT = 1205;
export const ER_DUP_ENTRY = 1062;

/** errno of a mysql2 error, also when wrapped by drizzle (`cause` chain). */
export function mysqlErrno(err: unknown): number | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === 'object'; i++) {
    const errno = (e as { errno?: unknown }).errno;
    if (typeof errno === 'number') return errno;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export function isRetryableTxError(err: unknown): boolean {
  const n = mysqlErrno(err);
  return n === ER_LOCK_DEADLOCK || n === ER_LOCK_WAIT_TIMEOUT;
}

export function isDuplicateEntry(err: unknown): boolean {
  return mysqlErrno(err) === ER_DUP_ENTRY;
}

/**
 * Runs `fn` in a transaction and retries it (fresh transaction) on deadlock / lock-wait timeout.
 * Three sources are processed concurrently and `addFact` locks fact rows, so an occasional
 * deadlock is expected; InnoDB rolls the victim back and the retry succeeds.
 */
export async function withTxRetry<T>(db: Db, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await withTransaction(db, fn);
    } catch (err) {
      if (i >= attempts || !isRetryableTxError(err)) throw err;
      await new Promise((r) => setTimeout(r, 25 * i + Math.floor(Math.random() * 50)));
    }
  }
}

/** Same retry for a single non-transactional call (e.g. enqueueAi opens its own transaction). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isRetryableTxError(err)) throw err;
      await new Promise((r) => setTimeout(r, 25 * i + Math.floor(Math.random() * 50)));
    }
  }
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function errorText(err: unknown, max = 2000): string {
  const msg = err instanceof Error ? `${err.name === 'Error' ? '' : `${err.name}: `}${err.message}` : String(err);
  return msg.slice(0, max);
}
