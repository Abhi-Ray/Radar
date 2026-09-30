import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import Form from "next/form";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { IsoBlock } from "@/components/countries/CountryCards";
import { LiveToggle } from "@/components/countries/CountryForms";
import { ChangeLog, Conventions, RouteSection, Salaries, SitesAndLanguages, Watches } from "@/components/countries/GuidePanels";
import { MARKER_LABEL, tierLabel } from "@/components/countries/model";
import { MARKER_TONE, parseAsOf } from "@/components/countries/view";
import { Panel } from "@/components/tracker/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/components/ui/format";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { KeyValue } from "@/components/ui/KeyValue";
import { Notice } from "@/components/ui/Notice";
import { Stamp } from "@/components/ui/Stamp";
import { loadCountryGuide } from "@/lib/queries/countries";
import { appTz } from "@/lib/time";

const ISO2 = /^[a-zA-Z]{2}$/;

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (iso2: string, asOf: string | null) => (ISO2.test(iso2) ? loadCountryGuide(iso2.toUpperCase(), { asOf }) : null));

export async function generateMetadata({ params, searchParams }: PageProps<"/countries/[iso2]">): Promise<Metadata> {
  await requireSession();
  const [{ iso2 }, sp] = await Promise.all([params, searchParams]);
  const g = await load(iso2, parseAsOf(sp.asof));
  if (!g) return { title: "Country not found" };
  return { title: `${g.country.name} · Countries` };
}

const JUMPS = [
  ["routes", "Visa rules"],
  ["changes", "Change log"],
  ["pages", "Official pages"],
  ["salaries", "Salaries"],
  ["sites", "Sites & languages"],
  ["cv", "CV conventions"],
] as const;

export default async function CountryPage({ params, searchParams }: PageProps<"/countries/[iso2]">) {
  await requireSession();
  const [{ iso2: raw }, sp] = await Promise.all([params, searchParams]);
  if (!ISO2.test(raw)) notFound();
  const asOf = parseAsOf(sp.asof);
  if (raw !== raw.toLowerCase()) redirect(`/countries/${raw.toLowerCase()}${asOf ? `?asof=${asOf}` : ""}`);
  const g = await load(raw, asOf);
  if (!g) notFound();
  const tz = appTz();
  const now = new Date();
  const c = g.country;
  const iso2 = c.iso2.toLowerCase();
  const active = g.routes.filter((r) => r.route.isActive);
  const pagesToReview = g.watches.filter((w) => w.status === "changed" || w.status === "error").length;
  const reviews = active.map((r) => r.current?.nextReviewAt).filter((d): d is Date => d instanceof Date);
  const nextReview = reviews.length ? new Date(Math.min(...reviews.map((d) => d.getTime()))) : null;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/countries" className="inline-flex min-h-11 items-center gap-1 font-bold underline decoration-2 underline-offset-4 sm:min-h-0">
          <Icon name="arrow-left" size={16} />
          All countries
        </Link>
        <span aria-hidden="true" className="text-muted">
          /
        </span>
        <span className="font-mono text-xs text-muted" aria-current="page">
          {c.iso2}
        </span>
      </nav>

      <header className="border-3 border-ink bg-card shadow-lg">
        <div className="hatch-soft flex flex-wrap items-center justify-between gap-2 border-b-3 border-ink px-4 py-2 sm:px-5">
          <p className="micro text-ink">Country guide · {tierLabel(c.tier)}</p>
          <p className="font-mono text-xs text-muted">{g.asOfDay ? `rules as of ${g.asOfDay}` : `rules as of today · ${g.today}`}</p>
        </div>
        <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 items-center gap-4">
              <IsoBlock iso2={c.iso2} size="lg" />
              <h1 className="headline min-w-0 text-3xl leading-[1.05] [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">{c.name}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={MARKER_TONE[g.marker]} variant={g.marker === "verified" ? "solid" : g.marker === "none" ? "outline" : "tint"} size="md">
                {MARKER_LABEL[g.marker]}
              </Badge>
              {g.languages.map((l) => (
                <Badge key={l} tone="paper" variant="outline" size="sm">
                  {l}
                </Badge>
              ))}
            </div>
            <KeyValue
              layout="grid"
              columns={3}
              className="max-sm:grid-cols-2"
              items={[
                { label: "Region", value: c.region ?? "—" },
                { label: "Currency", value: c.currency ?? "—", mono: true },
                {
                  label: "Visa routes",
                  value: `${active.length} in use${g.routes.length > active.length ? ` · ${g.routes.length - active.length} retired` : ""}`,
                },
                { label: "Next review", value: nextReview ? formatDate(nextReview, { tz }) : "not scheduled", mono: true },
                { label: "Pages to review", value: String(pagesToReview), mono: true },
                { label: "Tier", value: tierLabel(c.tier) },
              ]}
            />
          </div>
          <div className="flex flex-row flex-wrap items-start gap-4 md:flex-col md:items-end">
            <Stamp
              label={c.isLive ? "Live" : "Off"}
              tone={c.isLive ? "radar" : "concrete"}
              size="lg"
              dashed={!c.isLive}
              kicker="Scope"
              sub={c.isLive ? "jobs in scope" : "jobs not in scope"}
              srLabel={c.isLive ? "Live: its jobs are in scope" : "Off: its jobs are not in scope"}
            />
            <LiveToggle iso2={c.iso2} name={c.name} isLive={c.isLive} blocked={g.goLive.ok ? null : g.goLive.reason} />
          </div>
        </div>
      </header>

      {c.isLive && !g.goLive.ok ? (
        <Notice kind="warn" title="Live on a rule that needs checking">
          {g.goLive.reason} Jobs stay in scope, but re-verify the rule against the official page.
        </Notice>
      ) : g.marker === "stale" || g.marker === "unverified" ? (
        <Notice kind="warn" title={g.marker === "stale" ? "A rule is stale" : "A rule is not verified"}>
          Rules older than 90 days, or never checked, are not trusted. Open the official page, compare, then mark the rule verified or add a new version.
        </Notice>
      ) : null}

      <nav aria-label="On this page" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
        {JUMPS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="micro shrink-0 border-2 border-ink bg-card px-2.5 py-1.5 text-ink hover:bg-acid focus-visible:bg-acid pointer-coarse:py-2.5"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel id="routes" code="A" kicker="Visa rules" title={g.asOfDay ? `As of ${g.asOfDay}` : "In effect today"}>
            <Form action={`/countries/${iso2}`} className="flex flex-wrap items-end gap-2 border-b-3 border-ink pb-4">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="micro text-ink">See the rules as of</span>
                <Input type="date" name="asof" defaultValue={g.asOfDay ?? g.today} mono className="w-44" />
              </label>
              <Button type="submit" variant="secondary" icon="calendar">
                Show
              </Button>
              {g.asOfDay ? (
                <Button href={`/countries/${iso2}`} variant="ghost" icon="close">
                  Back to today
                </Button>
              ) : null}
            </Form>
            {g.routes.length ? (
              <div className="flex flex-col gap-6">
                {g.routes.map((r) => (
                  <RouteSection key={r.route.id} g={r} iso2={c.iso2} today={g.today} asOfDay={g.asOfDay} now={now} tz={tz} />
                ))}
              </div>
            ) : (
              <p className="m-0 text-sm text-ink-soft">
                No visa routes are on file for {c.name}. They come from the seed data; without one the country cannot go live.
              </p>
            )}
          </Panel>
          <Panel
            id="changes"
            code="B"
            kicker="Change log"
            title={g.changes.length ? `${g.changes.length} ${g.changes.length === 1 ? "entry" : "entries"}` : "Nothing yet"}
          >
            <ChangeLog changes={g.changes} />
          </Panel>
        </div>
        <aside aria-label="Pages, salaries, sites and CV conventions" className="flex min-w-0 flex-col gap-6">
          <Panel
            id="pages"
            code="C"
            kicker="Official pages"
            title={pagesToReview ? `${pagesToReview} to review` : "Watched pages"}
            band={pagesToReview ? "signal" : undefined}
          >
            <Watches g={g} now={now} tz={tz} />
          </Panel>
          <Panel id="salaries" code="D" kicker="Salaries" title="Typical ranges">
            <Salaries g={g} />
          </Panel>
          <Panel id="sites" code="E" kicker="Where to look" title="Sites & languages">
            <SitesAndLanguages g={g} />
          </Panel>
          <Panel id="cv" code="F" kicker="CV conventions" title={`A CV for ${c.name}`}>
            <Conventions g={g} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
