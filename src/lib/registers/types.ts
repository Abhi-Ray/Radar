/** Shared shapes of the register importers (see ./index.ts). */
import type { SafeFetchResponse } from '../security/safe-fetch';

/** One published register row, cleaned. */
export interface RegisterEntryInput {
  /** Organisation name exactly as published (whitespace trimmed). */
  orgName: string;
  town: string | null;
  /** Visa route / scheme / permit year the entry is about. */
  route: string | null;
  /** Licence rating (UK A/B), a permit count, … */
  rating: string | null;
  /**
   * The row as published (trimmed). Its canonical hash is the entry identity, so re-importing
   * an unchanged row keeps its database id (evidence links survive).
   */
  raw: Record<string, string | number | null>;
}

export interface RegisterFile {
  url: string;
  bytes: number;
  sha256: string;
  label?: string;
}

/** What a source hands to the importer. */
export interface RegisterSnapshot {
  /** Publisher's own date of the data ('YYYY-MM-DD') when it states one. */
  publishedAt: string | null;
  /** Downloaded files (their hashes detect an unchanged register). */
  files: RegisterFile[];
  /** Entries, iterated exactly once (parsers stream them). */
  entries: AsyncIterable<RegisterEntryInput> | Iterable<RegisterEntryInput>;
}

/** Fetch contract of the importers: the SSRF-safe fetcher (tests inject a fake). */
export type RegisterFetch = (
  url: string,
  opts: { timeoutMs: number; maxBytes: number; headers?: Record<string, string> },
) => Promise<Pick<SafeFetchResponse, 'status' | 'ok' | 'body' | 'text' | 'finalUrl'>>;

export interface RegisterSourceContext {
  fetch: RegisterFetch;
  now: Date;
}

/** A download / format problem. The import is abandoned and the previous version kept. */
export class RegisterError extends Error {
  constructor(
    message: string,
    readonly code: 'http' | 'format' | 'too_few' | 'shrunk' | 'host',
    readonly url?: string,
    /** HTTP status for code 'http'. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RegisterError';
  }
}
