import { AsOf, ConfidenceMeter, EmptyState, FitGauge, fitBand, TONE_SOLID, cn } from "@/components/ui";
import type { JobDetail } from "@/lib/queries/jobs";
import { Panel } from "./FactMeta";
import { fitBars } from "./detail-model";

/** Fit "why" (spec §14): each component's share of the score, what it earned and why. */
export function FitPanel({ detail }: { detail: JobDetail }) {
  const { score, now } = detail;
  if (!score) {
    return (
      <Panel id="fit" code="C" kicker="Fit" title="Why this score">
        <EmptyState icon="radar" code="UNSCORED" size="sm" title="Not scored yet" note="Scores are written by the daily run">
          <p>This job has no current score, so it sorts last by fit. It gets one on the next scoring pass.</p>
        </EmptyState>
      </Panel>
    );
  }
  const bars = fitBars(score.components);
  const band = fitBand(score.score);
  return (
    <Panel id="fit" code="C" kicker="Fit" title="Why this score" actions={<AsOf at={score.computedAt} label="Scored" now={now} variant="inline" />}>
      <div className="flex flex-wrap items-center gap-4">
        <FitGauge score={score.score} variant="block" size="sm" />
        <p className="min-w-0 flex-1 text-sm">
          <strong>{band.label}.</strong> The score adds up the points below. Each part can give up to its share of the 100 (the number
          after the slash); the fill is how much of that share this job earned. Weak evidence counts for less.
          <span className="mt-1 block font-mono text-xs text-muted">logic {score.version}</span>
        </p>
      </div>
      {bars.length ? (
        <ol className="flex list-none flex-col gap-3 p-0">
          {bars.map((b) => (
            <li key={b.key} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-bold">{b.label}</span>
                <span className="flex items-center gap-2">
                  <ConfidenceMeter level={b.confidence} size="sm" />
                  <span className="font-mono text-sm font-bold tabular">
                    {b.points}
                    <span className="font-normal text-muted"> / {b.maxPoints}</span>
                  </span>
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${b.label}: ${b.points} of ${b.maxPoints} points`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(b.fill * 100)}
                className="h-4 border-2 border-ink bg-card"
              >
                <div className={cn("h-full border-r-2 border-ink", TONE_SOLID[fitBand(b.fill * 100).tone], b.fill === 0 && "border-r-0")} style={{ width: `${b.fill * 100}%` }} />
              </div>
              {b.discounted ? (
                <p className="font-mono text-xs text-muted tabular">
                  Matched {Math.round(b.match * 100)}%, counted at {Math.round(b.fill * 100)}% — {b.confidence} confidence.
                </p>
              ) : null}
              {b.reason ? <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{b.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">The stored score has no component breakdown.</p>
      )}
    </Panel>
  );
}
