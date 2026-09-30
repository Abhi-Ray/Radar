/**
 * Tracker stats (spec §20): response rate, time to first reply, interviews and offers — overall
 * and by country / source / role. A line with fewer than MIN_SAMPLE applications is printed but
 * hatched and marked "Too few to conclude" (the numbers are real, the conclusion is not).
 */
import { ClientTabs } from "@/components/ui/ClientTabs";
import { StatBlock } from "@/components/ui/StatBlock";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { formatNumber, formatPercent } from "@/components/ui/format";
import { TOO_FEW_LABEL, type StatLine, type TrackerStats } from "@/lib/tracker/stats";
import { Panel } from "./Panel";

function rate(line: StatLine): string {
  return line.responseRate === null ? "—" : formatPercent(line.responseRate);
}

function avgReply(line: StatLine): string {
  return line.avgDaysToFirstReply === null ? "—" : `${formatNumber(line.avgDaysToFirstReply, { decimals: 1 })}d`;
}

function Breakdown({ lines, noun, minSample }: { lines: StatLine[]; noun: string; minSample: number }) {
  if (!lines.length) return <p className="font-mono text-sm text-muted">No applications with a {noun} yet.</p>;
  return (
    <Table caption={`Response by ${noun}`}>
      <THead>
        <tr>
          <TH>{noun}</TH>
          <TH className="text-right">Applied</TH>
          <TH className="text-right">Replied</TH>
          <TH className="text-right">Rate</TH>
          <TH className="text-right">Interviews</TH>
          <TH className="text-right">Offers</TH>
          <TH className="text-right">1st reply</TH>
        </tr>
      </THead>
      <TBody>
        {lines.map((l) => (
          <TR key={l.key} className={cn(!l.conclusive && "hatch-soft")}>
            <TD className="font-bold">
              <span className="block max-w-[14rem] truncate">{l.label}</span>
              {!l.conclusive ? (
                <span className="font-mono text-[0.625rem] font-bold uppercase text-muted">
                  {TOO_FEW_LABEL} · n&lt;{minSample}
                </span>
              ) : null}
            </TD>
            <TD className="text-right font-mono tabular">{l.applied}</TD>
            <TD className="text-right font-mono tabular">{l.responded}</TD>
            <TD className={cn("text-right font-mono font-bold tabular", !l.conclusive && "opacity-60")}>{rate(l)}</TD>
            <TD className="text-right font-mono tabular">{l.interviews}</TD>
            <TD className="text-right font-mono tabular">{l.offers}</TD>
            <TD className={cn("text-right font-mono tabular", !l.replyConclusive && "opacity-60")}>{avgReply(l)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function StatsPanel({ stats, filtered }: { stats: TrackerStats; filtered: boolean }) {
  const o = stats.overall;
  const caveat = !o.conclusive ? `${TOO_FEW_LABEL} (n<${stats.minSample})` : undefined;
  return (
    <Panel
      id="stats"
      code="S"
      kicker={filtered ? "Stats · this view" : "Stats"}
      title="What the replies say"
      actions={
        <span className="font-mono text-xs">
          {formatNumber(stats.total)} tracked · {formatNumber(stats.saved)} saved
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <StatBlock size="sm" label="Applied" value={formatNumber(o.applied)} detail={`${o.active} still open`} />
        <StatBlock
          size="sm"
          label="Response rate"
          value={rate(o)}
          tone={o.conclusive ? "acid" : "card"}
          caveat={caveat}
          detail={`${o.responded} of ${o.applied} replied`}
        />
        <StatBlock
          size="sm"
          label="1st reply"
          value={avgReply(o)}
          caveat={!o.replyConclusive ? `${TOO_FEW_LABEL} (${o.replies} ${o.replies === 1 ? "reply" : "replies"})` : undefined}
          detail="average, days after applying"
        />
        <StatBlock size="sm" label="Interviews" value={formatNumber(o.interviews)} tone="cobalt" detail={`${o.offers} offer${o.offers === 1 ? "" : "s"}`} />
        <StatBlock size="sm" label="No reply / no" value={`${o.noResponse} / ${o.rejected}`} tone="concrete" detail="no response · rejected" />
      </div>
      <ClientTabs
        label="Break the stats down by"
        tabs={[
          {
            id: "country",
            label: "Country",
            count: stats.byCountry.length,
            content: <Breakdown lines={stats.byCountry} noun="country" minSample={stats.minSample} />,
          },
          {
            id: "source",
            label: "Source",
            count: stats.bySource.length,
            content: <Breakdown lines={stats.bySource} noun="source" minSample={stats.minSample} />,
          },
          { id: "role", label: "Role", count: stats.byRole.length, content: <Breakdown lines={stats.byRole} noun="role" minSample={stats.minSample} /> },
        ]}
      />
      <p className="text-xs text-muted">
        A reply is any move to screening or later, or a rejection. Rows with fewer than {stats.minSample} applications are hatched: the numbers are real, the
        pattern is not.
      </p>
    </Panel>
  );
}
