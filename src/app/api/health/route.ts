/**
 * GET /api/health — public liveness/readiness probe (Docker HEALTHCHECK, uptime monitors).
 *
 * 200 {ok:true, db:'up', lastRunAgeHours, version}   database answered within 2 s
 * 503 {ok:false, db:'down', lastRunAgeHours:null, version}
 *
 * No secrets, no error details, never cached. Logic lives in ./health.ts.
 */
import { connection, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { deployedVersion, getHealth, rateLimitedWarn, type HealthPayload } from './health';

export const dynamic = 'force-dynamic';

const warnProbeFailure = rateLimitedWarn();

export async function GET(): Promise<NextResponse<HealthPayload>> {
  await connection();
  const payload = await getHealth({ pool: getPool, version: deployedVersion(), onError: warnProbeFailure });
  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex' },
  });
}
