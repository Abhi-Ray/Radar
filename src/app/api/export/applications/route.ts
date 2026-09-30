/**
 * GET /api/export/applications?format=json|csv&part=applications|events|snapshots
 *
 * Downloads the whole tracker (spec §20: "export to CSV/JSON"): JSON is one file with every
 * application, its append-only events, its posting snapshots and its reminders; CSV is one file per
 * part. Session-checked against the DB (requireSession — the proxy only verified the JWT), sent as
 * an attachment, never cached.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { log } from '@/lib/log';
import { appTz, localDay } from '@/lib/time';
import { EXPORT_FORMATS, EXPORT_PARTS, buildTrackerExport, exportCsv, exportFilename, type ExportFormat, type ExportPart } from '@/lib/tracker/export';

export const dynamic = 'force-dynamic';

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T | null {
  if (value === null || value === '') return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  await requireSession();
  const params = request.nextUrl.searchParams;
  const format = pick<ExportFormat>(params.get('format'), EXPORT_FORMATS, 'json');
  const part = pick<ExportPart>(params.get('part'), EXPORT_PARTS, 'applications');
  if (!format || !part) {
    return NextResponse.json({ ok: false, error: 'format must be json|csv and part applications|events|snapshots' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const tz = appTz();
  const now = new Date();
  let body: string;
  try {
    const data = await buildTrackerExport(getDb(), { now, timeZone: tz });
    body = format === 'json' ? JSON.stringify(data, null, 2) : exportCsv(data, part);
  } catch (err) {
    log.error('export: applications failed', { err, format, part });
    return NextResponse.json({ ok: false, error: 'export failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  const filename = exportFilename(format, part, localDay(now, tz));
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
