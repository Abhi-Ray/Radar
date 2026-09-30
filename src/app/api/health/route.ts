/**
 * GET /api/health — public liveness/readiness probe (Docker HEALTHCHECK, uptime monitors).
 *
 * Through nginx (the request carries X-Real-IP, which our vhost always sets): only
 *   200 {ok:true, db:'up'}   /   503 {ok:false, db:'down'}
 * Direct loopback probes without X-Real-IP (Docker HEALTHCHECK inside the container, the deploy
 * scripts' radar_wait_healthy on 127.0.0.1:3100) get the full payload:
 *   200 {ok:true, db:'up', lastRunAgeHours, version}   database answered within 2 s
 *   503 {ok:false, db:'down', lastRunAgeHours:null, version}
 * The app port is bound to 127.0.0.1 only, so the internet never reaches the second form.
 *
 * No secrets, no error details, never cached. Logic lives in ./health.ts.
 */
import { connection, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { deployedVersion, getHealth, rateLimitedWarn, type HealthPayload } from './health';

export const dynamic = 'force-dynamic';

const warnProbeFailure = rateLimitedWarn();

/** What a request that came through nginx sees. */
export type PublicHealthPayload = Pick<HealthPayload, 'ok' | 'db'>;

export async function GET(request: Request): Promise<NextResponse<HealthPayload | PublicHealthPayload>> {
  await connection();
  const payload = await getHealth({ pool: getPool, version: deployedVersion(), onError: warnProbeFailure });
  const viaNginx = request.headers.has('x-real-ip');
  const body: HealthPayload | PublicHealthPayload = viaNginx ? { ok: payload.ok, db: payload.db } : payload;
  return NextResponse.json(body, {
    status: payload.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex' },
  });
}
