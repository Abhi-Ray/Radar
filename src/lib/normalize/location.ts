// STUB(NORMALIZE): minimal safe implementation — trusts only explicit hints, never guesses from
// the raw string. Replace with the real gazetteer-based parser; keep the exported signature.
import type { LocationResult, WorkplaceType } from '../contracts/jobs';

export const LOCATION_LOGIC_VERSION = 'location-stub-0';

const ISO2 = /^[A-Za-z]{2}$/;

export function normalizeLocation(raw: string, hints?: { country?: string | null; city?: string | null }): LocationResult {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const country = hints?.country && ISO2.test(hints.country.trim()) ? hints.country.trim().toUpperCase() : null;
  const city = hints?.city?.trim() ? hints.city.trim().slice(0, 128) : null;
  const workplaceType: WorkplaceType | null = /\bremote\b/i.test(text) ? 'remote' : /\bhybrid\b/i.test(text) ? 'hybrid' : null;
  return {
    countryIso2: country,
    city,
    region: null,
    workplaceType,
    remoteScopeRaw: workplaceType === 'remote' ? text.slice(0, 255) || null : null,
    confidence: 'low',
    evidence: country ? `country from source hint "${country}"` : 'no location parser yet (stub)',
  };
}
