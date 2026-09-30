import { Notice, ProgressBlocks, StatBlock, formatDateTime, formatNumber, formatRelative, type Tone } from "@/components/ui";
import type { DeskData, Section } from "@/lib/queries/dashboard";

const RUN_TONE: Record<string, Tone> = { ok: "radar", partial: "signal", failed: "stamp", running: "cobalt", queued: "cobalt", skipped: "concrete" };
const BACKUP_TONE: Record<string, Tone> = { ok: "radar", failed: "stamp", running: "cobalt" };

function when(at: Date | null | undefined, now: Date): string {
  return at ? `${formatDateTime(at)} · ${formatRelative(at, now)}` : "never";
}

/** A health cell whose query failed: says so instead of pretending all is well. */
function Broken({ label, section }: { label: string; section: Section<unknown> }) {
  return (
    <StatBlock label={label} value="—" tone="card" size="sm" caveat="Could not load" detail={section.ok ? undefined : section.error} />
  );
}

/** Station health (spec §19.1): sources, last run, AI budget, last backup, open alerts. */
export function HealthStrip({ health, now }: { health: DeskData["health"]; now: Date }) {
  const { sources, lastRun, ai, backup, alerts } = health;
  return (
    <section aria-labelledby="desk-health" className="flex flex-col gap-3">
      <h2 id="desk-health" className="micro text-ink">
        Station health
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {sources.ok ? (
          <StatBlock
            href="/sources"
            size="sm"
            label="Sources"
            value={formatNumber(sources.data.ok)}
            unit="ok"
            tone={sources.data.warn > 0 ? "signal" : sources.data.ok > 0 ? "radar" : "card"}
            detail={`${sources.data.warn} warn · ${sources.data.paused} paused${sources.data.draft ? ` · ${sources.data.draft} draft` : ""}`}
          />
        ) : (
          <Broken label="Sources" section={sources} />
        )}

        {lastRun.ok ? (
          lastRun.data ? (
            <StatBlock
              href="/system"
              size="sm"
              label={`Last run · ${lastRun.data.kind}${lastRun.data.dryRun ? " (dry)" : ""}`}
              value={lastRun.data.status.toUpperCase()}
              tone={RUN_TONE[lastRun.data.status] ?? "card"}
              detail={when(lastRun.data.finishedAt ?? lastRun.data.startedAt ?? lastRun.data.createdAt, now)}
            />
          ) : (
            <StatBlock href="/system" size="sm" label="Last run" value="NONE" tone="card" caveat="No run yet" detail="The daily run has never started." />
          )
        ) : (
          <Broken label="Last run" section={lastRun} />
        )}

        {ai.ok ? (
          <StatBlock
            href="/system"
            size="sm"
            label="AI budget today"
            value={`${ai.data.used}/${ai.data.limit}`}
            tone={ai.data.enabled ? (ai.data.remaining <= 0 ? "stamp" : "lilac") : "card"}
            detail={ai.data.enabled ? `${ai.data.remaining} left · UTC day` : "AI switched off"}
          >
            <ProgressBlocks value={ai.data.used} max={Math.max(1, ai.data.limit)} label="AI calls used today" tone="lilac" warnAt={0.8} dangerAt={1} size="sm" />
          </StatBlock>
        ) : (
          <Broken label="AI budget" section={ai} />
        )}

        {backup.ok ? (
          backup.data ? (
            <StatBlock
              href="/system"
              size="sm"
              label="Last backup"
              value={backup.data.status.toUpperCase()}
              tone={BACKUP_TONE[backup.data.status] ?? "card"}
              detail={backup.data.status === "failed" && backup.data.error ? `${when(backup.data.startedAt, now)} · failed` : when(backup.data.finishedAt ?? backup.data.startedAt, now)}
            />
          ) : (
            <StatBlock href="/system" size="sm" label="Last backup" value="NONE" tone="signal" detail="No backup has run yet." />
          )
        ) : (
          <Broken label="Last backup" section={backup} />
        )}

        {alerts.ok ? (
          <StatBlock
            href="/system"
            size="sm"
            label="Open alerts"
            value={formatNumber(alerts.data.open)}
            unit={alerts.data.critical ? `${alerts.data.critical} crit` : undefined}
            tone={alerts.data.critical ? "stamp" : alerts.data.open ? "signal" : "card"}
            detail={alerts.data.newest ? alerts.data.newest.title : "All quiet."}
            className="col-span-2 md:col-span-1"
          />
        ) : (
          <Broken label="Open alerts" section={alerts} />
        )}
      </div>
      {!sources.ok || !lastRun.ok || !ai.ok || !backup.ok || !alerts.ok ? (
        <Notice kind="warn" title="Part of the health strip is blind">
          Some numbers could not be read. The server log has the details; the rest of the desk is current.
        </Notice>
      ) : null}
    </section>
  );
}
