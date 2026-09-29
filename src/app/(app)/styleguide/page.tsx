import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  AsOf,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ClientTabs,
  ConfidenceMeter,
  DataTable,
  DrawerButton,
  ELIGIBILITY_META,
  ELIGIBILITY_RESULTS,
  EmptyState,
  EstimateTag,
  FilterChip,
  FilterChipRow,
  FitGauge,
  Icon,
  ICON_NAMES,
  InfoTip,
  KeyValue,
  LinkTabs,
  LowConfTag,
  METHOD_META,
  METHOD_ORDER,
  MethodTag,
  MiniBars,
  ModalButton,
  Notice,
  Pagination,
  ProgressBlocks,
  RadarSweep,
  Receipt,
  SectionHeader,
  Skeleton,
  SkeletonCard,
  Sparkline,
  Stamp,
  StatBlock,
  Sticker,
  Ticker,
  Timeline,
  Tooltip,
  Unknown,
  VISA_META,
  VISA_STATUSES,
  Wordmark,
  formatDateTime,
  formatRelative,
  hrefToggle,
  hrefWith,
  pageFromParams,
  paramList,
  paramValue,
  type Column,
  type RadarBlip,
} from "@/components/ui";
import { FormDemo, ToastDemo } from "./demos";
import { SPECIMEN_AI_CALLS, SPECIMEN_RECEIPT, SPECIMEN_RUNS, specimenJobs, specimenLog, type SpecimenJob } from "./specimens";

export const metadata: Metadata = { title: "Styleguide" };

const PATH = "/styleguide";

const SECTIONS = [
  { id: "tokens", code: "A", title: "Tokens" },
  { id: "type", code: "B", title: "Type" },
  { id: "surfaces", code: "C", title: "Surfaces & motion" },
  { id: "buttons", code: "D", title: "Buttons" },
  { id: "labels", code: "E", title: "Stamps, badges, stickers" },
  { id: "provenance", code: "F", title: "Provenance" },
  { id: "scores", code: "G", title: "Scores & meters" },
  { id: "scope", code: "H", title: "Radar & ticker" },
  { id: "forms", code: "I", title: "Forms" },
  { id: "navigation", code: "J", title: "Tabs, filters, paging" },
  { id: "tables", code: "K", title: "Tables" },
  { id: "overlays", code: "L", title: "Overlays & toasts" },
  { id: "feedback", code: "M", title: "Notices & empty states" },
  { id: "layout", code: "N", title: "Cards & headers" },
] as const;

/* Literal class names so Tailwind can see them. */
const PALETTE: { family: string; swatches: { name: string; hex: string; cls: string; note: string }[] }[] = [
  {
    family: "Base",
    swatches: [
      { name: "paper", hex: "#F3EEE3", cls: "bg-paper", note: "Page" },
      { name: "paper-deep", hex: "#E7DFCD", cls: "bg-paper-deep", note: "Wells, insets" },
      { name: "card", hex: "#FFFCF4", cls: "bg-card", note: "Surfaces" },
      { name: "ink", hex: "#111111", cls: "bg-ink", note: "Text, borders, shadows" },
      { name: "ink-soft", hex: "#2B2A27", cls: "bg-ink-soft", note: "Body copy" },
      { name: "muted", hex: "#57534A", cls: "bg-muted", note: "Secondary text (AA)" },
    ],
  },
  {
    family: "Acid · action",
    swatches: [
      { name: "acid", hex: "#FFE14D", cls: "bg-acid", note: "Primary, focus, current" },
      { name: "acid-tint", hex: "#FFF3AD", cls: "bg-acid-tint", note: "Hover" },
      { name: "acid-deep", hex: "#6B5700", cls: "bg-acid-deep", note: "Text on paper" },
    ],
  },
  {
    family: "Signal · attention",
    swatches: [
      { name: "signal", hex: "#FF6B1A", cls: "bg-signal", note: "New, warn, stale" },
      { name: "signal-tint", hex: "#FFD9C2", cls: "bg-signal-tint", note: "Warn wells" },
      { name: "signal-deep", hex: "#A83E00", cls: "bg-signal-deep", note: "Text on paper" },
    ],
  },
  {
    family: "Radar · confirmed",
    swatches: [
      { name: "radar", hex: "#1FD18B", cls: "bg-radar", note: "OK, confirmed, meets" },
      { name: "radar-tint", hex: "#C2F2DC", cls: "bg-radar-tint", note: "OK wells" },
      { name: "radar-deep", hex: "#07693F", cls: "bg-radar-deep", note: "Text on paper" },
    ],
  },
  {
    family: "Cobalt · info",
    swatches: [
      { name: "cobalt", hex: "#2F5BFF", cls: "bg-cobalt", note: "Info, likely (white text)" },
      { name: "cobalt-tint", hex: "#D3DCFF", cls: "bg-cobalt-tint", note: "Info wells" },
      { name: "cobalt-deep", hex: "#1C3BCC", cls: "bg-cobalt-deep", note: "Links, text" },
    ],
  },
  {
    family: "Stamp · danger",
    swatches: [
      { name: "stamp", hex: "#E5383B", cls: "bg-stamp", note: "Fill only, never text" },
      { name: "stamp-tint", hex: "#FAD0D0", cls: "bg-stamp-tint", note: "Error wells" },
      { name: "stamp-deep", hex: "#B3161B", cls: "bg-stamp-deep", note: "Danger fills, text" },
    ],
  },
  {
    family: "Lilac · AI-derived",
    swatches: [
      { name: "lilac", hex: "#B9A6FF", cls: "bg-lilac", note: "AI output" },
      { name: "lilac-tint", hex: "#E9E2FF", cls: "bg-lilac-tint", note: "AI wells" },
      { name: "lilac-deep", hex: "#5A3FC0", cls: "bg-lilac-deep", note: "Text on paper" },
    ],
  },
  {
    family: "Concrete · unknown",
    swatches: [
      { name: "concrete", hex: "#D9D3C7", cls: "bg-concrete", note: "Unknown, muted" },
      { name: "concrete-deep", hex: "#A59E90", cls: "bg-concrete-deep", note: "Dashed outlines" },
    ],
  },
];

const PAIRS: { fg: string; bg: string; label: string }[] = [
  { bg: "bg-acid", fg: "text-ink", label: "ink / acid" },
  { bg: "bg-signal", fg: "text-ink", label: "ink / signal" },
  { bg: "bg-radar", fg: "text-ink", label: "ink / radar" },
  { bg: "bg-lilac", fg: "text-ink", label: "ink / lilac" },
  { bg: "bg-concrete", fg: "text-ink", label: "ink / concrete" },
  { bg: "bg-cobalt", fg: "text-white", label: "white / cobalt" },
  { bg: "bg-stamp-deep", fg: "text-white", label: "white / stamp-deep" },
  { bg: "bg-ink", fg: "text-paper", label: "paper / ink" },
  { bg: "bg-ink", fg: "text-acid", label: "acid / ink" },
  { bg: "bg-paper", fg: "text-radar-deep", label: "radar-deep / paper" },
  { bg: "bg-paper", fg: "text-signal-deep", label: "signal-deep / paper" },
  { bg: "bg-paper", fg: "text-cobalt-deep", label: "cobalt-deep / paper" },
  { bg: "bg-paper", fg: "text-stamp-deep", label: "stamp-deep / paper" },
  { bg: "bg-paper", fg: "text-lilac-deep", label: "lilac-deep / paper" },
  { bg: "bg-paper", fg: "text-acid-deep", label: "acid-deep / paper" },
  { bg: "bg-paper", fg: "text-muted", label: "muted / paper" },
];

const SHADOWS = [
  { name: "xs", cls: "shadow-xs", px: "2px" },
  { name: "sm", cls: "shadow-sm", px: "3px" },
  { name: "md", cls: "shadow-md", px: "4px" },
  { name: "lg", cls: "shadow-lg", px: "6px" },
  { name: "xl", cls: "shadow-xl", px: "10px" },
];

const PATTERNS: { name: string; cls: string; use: string }[] = [
  { name: "hatch", cls: "hatch bg-card", use: "Medium confidence, estimates" },
  { name: "hatch-dense", cls: "hatch-dense bg-acid", use: "Hazard tape, restricted" },
  { name: "hatch-soft", cls: "hatch-soft bg-card", use: "Empty states, skeletons" },
  { name: "hatch-ink-signal-deep", cls: "hatch hatch-ink-signal-deep bg-signal-tint", use: "Recoloured hatch" },
  { name: "dotgrid", cls: "dotgrid bg-card", use: "Panels on card" },
  { name: "scanlines", cls: "scanlines bg-ink text-radar", use: "Console screens" },
  { name: "outline-dashed-ink", cls: "outline-dashed-ink bg-card", use: "Low confidence, unknown" },
  { name: "ink-texture", cls: "ink-texture bg-stamp-deep", use: "Rubber-stamp speckle" },
];

const BLIPS: RadarBlip[] = [
  { id: 1, angle: 32, distance: 0.3, label: "Senior Cloud Security Engineer · Nordlicht Cloud · 86", href: `${PATH}#scope`, tone: "acid", ping: true },
  { id: 2, angle: 118, distance: 0.55, label: "Platform Engineer · Grachtwerk · 71", href: `${PATH}#scope`, tone: "radar" },
  { id: 3, angle: 205, distance: 0.72, label: "DevSecOps Engineer · Fjordpay · 64", href: `${PATH}#scope`, tone: "signal" },
  { id: 4, angle: 290, distance: 0.88, label: "Security Analyst · Castellum · 31", href: `${PATH}#scope`, tone: "concrete" },
];

function Specimen({ id, code, title, description, children }: { id: string; code: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t-3 border-ink pt-6 md:pt-8">
      <SectionHeader as="h2" id={`${id}-title`} index={code} title={title} description={description} />
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <h3 className="micro mb-3 flex items-center gap-2 text-ink before:h-[3px] before:w-4 before:bg-ink">{children}</h3>;
}

export default async function StyleguidePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const now = new Date();
  const jobs = specimenJobs(now);
  const log = specimenLog(now);
  const tab = paramValue(sp, "tab") ?? "open";
  const countries = paramList(sp, "country");
  const page = pageFromParams(sp);
  const sort = paramValue(sp, "sort") ?? "fit";
  const dir = paramValue(sp, "dir") === "asc" ? "asc" : "desc";
  const sorted = [...jobs].sort((a, b) => {
    const k = sort === "seen" ? a.seenAt.getTime() - b.seenAt.getTime() : (a.fit ?? -1) - (b.fit ?? -1);
    return dir === "asc" ? k : -k;
  });
  const filtered = countries.length ? sorted.filter((j) => countries.includes(j.country)) : sorted;

  const columns: Column<SpecimenJob>[] = [
    {
      key: "title",
      header: "Job",
      mobile: "primary",
      cell: (j) => (
        <span className="flex flex-col">
          <span className="font-extrabold leading-snug">{j.title}</span>
        </span>
      ),
    },
    { key: "company", header: "Company", mobile: "secondary", cell: (j) => j.company },
    {
      key: "where",
      header: "Where",
      width: "w-32",
      cell: (j) => (
        <span className="font-mono text-xs font-bold">
          {j.country}
          {j.city ? ` · ${j.city}` : <span className="text-muted"> · city unknown</span>}
        </span>
      ),
    },
    { key: "visa", header: "Visa", mobile: "badge", width: "w-36", cell: (j) => <Stamp kind="visa" status={j.visa} size="sm" /> },
    {
      key: "salary",
      header: "Salary",
      width: "w-40",
      cell: (j) => (j.salary ? j.salaryEstimated ? <EstimateTag size="sm" basis="NL · platform · mid · 2026 table">{j.salary}</EstimateTag> : <span className="font-mono font-bold">{j.salary}</span> : <Unknown>Not stated</Unknown>),
    },
    {
      key: "seen",
      header: "Seen",
      sortKey: "seen",
      width: "w-24",
      cell: (j) => (
        <time dateTime={j.seenAt.toISOString()} title={formatDateTime(j.seenAt)} className="font-mono text-xs font-bold tabular">
          {formatRelative(j.seenAt, now)}
        </time>
      ),
    },
    { key: "fit", header: "Fit", sortKey: "fit", align: "right", numeric: true, width: "w-24", mobile: "badge", cell: (j) => <FitGauge score={j.fit} variant="inline" /> },
  ];

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        as="h1"
        index="UI"
        kicker="Field manual · styleguide"
        title="UI kit"
        description="Every token and component of the Field Station kit, with specimen content. Nothing on this page is live data."
        actions={
          <>
            <Sticker tone="signal" size="lg" icon="flag">
              Specimen
            </Sticker>
            <AsOf at={now} label="Rendered" now={now} />
          </>
        }
      />

      <nav aria-label="Styleguide sections" className="border-3 border-ink bg-card p-3 shadow-sm md:p-4">
        <p className="micro mb-2 text-muted">Contents</p>
        <ol className="m-0 grid list-none grid-cols-1 gap-x-4 gap-y-1 p-0 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex min-h-11 items-center gap-2 font-bold no-underline hover:underline">
                <span className="w-6 bg-ink text-center font-mono text-xs text-paper">{s.code}</span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* A — Tokens */}
      <Specimen id="tokens" code="A" title="Tokens" description="Semantic palette only — the default Tailwind colours, radii and blur shadows are switched off.">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {PALETTE.map((fam) => (
            <div key={fam.family}>
              <Label>{fam.family}</Label>
              <ul className="m-0 flex list-none flex-col border-3 border-ink p-0 shadow-sm">
                {fam.swatches.map((s) => (
                  <li key={s.name} className="flex items-stretch border-b-3 border-ink bg-card last:border-b-0">
                    <span aria-hidden="true" className={`w-14 shrink-0 border-r-3 border-ink ${s.cls}`} />
                    <span className="min-w-0 flex-1 px-2.5 py-1.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-xs font-bold">{s.name}</span>
                        <span className="font-mono text-[0.6875rem] text-muted">{s.hex}</span>
                      </span>
                      <span className="block text-xs text-ink-soft">{s.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <Label>Approved text pairs (WCAG AA)</Label>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 xl:grid-cols-8">
            {PAIRS.map((p) => (
              <li key={p.label} className={`flex min-h-16 flex-col justify-between border-3 border-ink px-2 py-1.5 ${p.bg} ${p.fg}`}>
                <span className="headline text-2xl">Aa</span>
                <span className="font-mono text-[0.625rem] font-bold uppercase">{p.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-prose text-sm text-muted">
            Plain stamp, cobalt, signal and radar are fills and borders; for text on paper use the <code className="whitespace-nowrap">-deep</code> variant.
            White text only sits on ink, cobalt, cobalt-deep and stamp-deep.
          </p>
        </div>
      </Specimen>

      {/* B — Type */}
      <Specimen id="type" code="B" title="Type" description="Archivo (variable weight + width) for display and body; JetBrains Mono for data, receipts and codes.">
        <div className="overflow-hidden border-3 border-ink bg-card p-4 shadow-md md:p-6">
          <p className="micro text-muted">text-giga · headline wider</p>
          <p className="headline wider text-giga uppercase">Radar</p>
          <p className="micro mt-6 text-muted">text-mega · headline wide</p>
          <p className="headline wide text-mega uppercase">Control desk</p>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <div>
              <p className="micro text-muted">headline wider</p>
              <p className="headline wider text-3xl uppercase">Blue Card</p>
            </div>
            <div>
              <p className="micro text-muted">headline (normal width)</p>
              <p className="headline text-3xl uppercase">Follow-up due</p>
            </div>
            <div>
              <p className="micro text-muted">headline narrow</p>
              <p className="headline narrow text-3xl uppercase">Conflicting evidence</p>
            </div>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              <p className="micro text-muted">Body · 16px / 1.5</p>
              <p className="mt-1 max-w-prose text-base text-ink-soft">
                The posting says sponsorship is available, but the company is not on the register. Both sides are shown; the
                verdict stays <strong>conflicting</strong> until you decide.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="micro text-muted">micro label</p>
              <p className="micro">3 blips need review</p>
              <p className="micro text-muted">mono · tabular</p>
              <p className="font-mono text-sm tabular">€72k–€88k · 29 Sep 2026, 14:02 IST · 0012 / 1204</p>
            </div>
          </div>
        </div>
      </Specimen>

      {/* C — Surfaces & motion */}
      <Specimen id="surfaces" code="C" title="Surfaces & motion" description="3px ink borders, hard offset shadows, patterns instead of gradients. Motion is small, stepped and switched off under reduced motion.">
        <div>
          <Label>Hard shadows</Label>
          <div className="flex flex-wrap gap-5">
            {SHADOWS.map((s) => (
              <div key={s.name} className={`flex size-24 flex-col justify-end border-3 border-ink bg-card p-2 ${s.cls}`}>
                <span className="font-mono text-xs font-bold">shadow-{s.name}</span>
                <span className="font-mono text-[0.625rem] text-muted">{s.px} 0 blur</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Label>Patterns</Label>
          <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-4">
            {PATTERNS.map((p) => (
              <li key={p.name}>
                <div aria-hidden="true" className={`h-20 border-3 border-ink ${p.cls}`} />
                <p className="mt-1.5 font-mono text-xs font-bold [overflow-wrap:anywhere]">{p.name}</p>
                <p className="text-xs text-muted">{p.use}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Label>Zig-zag &amp; perforation</Label>
            <div className="receipt-frame">
              <div className="zigzag bg-card px-4 py-6 font-mono text-sm">
                <p className="font-bold">RECEIPT EDGE</p>
                <p className="text-muted">zigzag + receipt-frame</p>
                <hr className="perforation my-3" />
                <p>perforation line above</p>
              </div>
            </div>
          </div>
          <div>
            <Label>Motion</Label>
            <div className="flex flex-wrap items-center gap-4 border-3 border-ink bg-card p-4">
              <Button variant="primary">Press me</Button>
              <a href="#surfaces" className="lift border-3 border-ink bg-card px-3 py-2 font-bold no-underline shadow-md">
                Lift on hover
              </a>
              <Stamp label="Thunk" tone="cobalt" animate />
              <span className="micro flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 animate-blink bg-radar" /> Blink
              </span>
              <span className="micro flex items-center gap-2">
                <span aria-hidden="true" className="inline-flex animate-pending gap-[3px]">
                  <span className="size-2.5 bg-ink" />
                  <span className="size-2.5 bg-ink" />
                  <span className="size-2.5 bg-ink" />
                </span>
                Pending
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">All of it stops under prefers-reduced-motion; the ticker becomes a scrollable strip.</p>
          </div>
        </div>
        <div>
          <Label>Icons ({ICON_NAMES.length})</Label>
          <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-8 lg:grid-cols-12">
            {ICON_NAMES.map((name) => (
              <li key={name} className="flex flex-col items-center gap-1 border-2 border-ink bg-card px-1 py-2">
                <Icon name={name} size={22} />
                <span className="max-w-full truncate font-mono text-[0.5625rem]">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      </Specimen>

      {/* D — Buttons */}
      <Specimen id="buttons" code="D" title="Buttons" description="Uppercase, heavy, 44px minimum. Hover lifts, press slams flat. Links that look like buttons are real links.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon="bookmark">
              Save job
            </Button>
            <Button variant="secondary" icon="external">
              Open posting
            </Button>
            <Button variant="ink" icon="refresh">
              Run now
            </Button>
            <Button variant="signal" icon="alert">
              Review 3
            </Button>
            <Button variant="danger" icon="trash">
              Archive
            </Button>
            <Button variant="ghost">Cancel</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="primary">
              Small
            </Button>
            <Button size="md" variant="primary">
              Medium
            </Button>
            <Button size="lg" variant="primary" iconRight="arrow-right">
              Large
            </Button>
            <Button variant="secondary" square icon="edit" aria-label="Edit note" />
            <Button variant="secondary" pending pendingLabel="Saving">
              Save
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button href="/jobs" variant="secondary" iconRight="arrow-right">
              Link button
            </Button>
          </div>
        </div>
      </Specimen>

      {/* E — Labels */}
      <Specimen id="labels" code="E" title="Stamps, badges, stickers" description="Visa verdicts are passport stamps; eligibility too. Unknown is a first-class state with a dashed border.">
        <div>
          <Label>Visa stamps</Label>
          <div className="flex flex-wrap items-center gap-5 border-3 border-ink bg-card p-5 dotgrid">
            {VISA_STATUSES.map((s) => (
              <Stamp key={s} kind="visa" status={s} sub={s === "confirmed" ? "EU Blue Card · DE" : s === "likely" ? "Sponsor history · NL" : undefined} />
            ))}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            {VISA_STATUSES.map((s) => (
              <div key={s} className="flex gap-2">
                <dt className="w-28 shrink-0 font-bold">{VISA_META[s].label}</dt>
                <dd className="m-0 text-ink-soft">{VISA_META[s].blurb}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <Label>Eligibility stamps</Label>
            <div className="flex flex-wrap items-center gap-4 border-3 border-ink bg-card p-5">
              {ELIGIBILITY_RESULTS.map((r) => (
                <Stamp key={r} kind="eligibility" result={r} />
              ))}
            </div>
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              {ELIGIBILITY_RESULTS.map((r) => (
                <div key={r} className="flex gap-2">
                  <dt className="w-28 shrink-0 font-bold">{ELIGIBILITY_META[r].label}</dt>
                  <dd className="m-0 text-ink-soft">{ELIGIBILITY_META[r].blurb}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <Label>Sizes &amp; generic</Label>
            <div className="flex flex-wrap items-center gap-4 border-3 border-ink bg-card p-5">
              <Stamp kind="visa" status="confirmed" size="lg" sub="Register match" />
              <Stamp label="Merged" tone="cobalt" />
              <Stamp label="Ghost?" tone="signal" dashed />
              <Stamp kind="visa" status="likely" size="sm" />
              <Stamp kind="visa" status="unknown" size="sm" />
            </div>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <Label>Badges</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="signal" srLabel="3 new jobs">
                3 new
              </Badge>
              <Badge tone="radar">Open</Badge>
              <Badge tone="cobalt">Interview</Badge>
              <Badge tone="stamp">Rejected</Badge>
              <Badge tone="lilac" icon="ai">
                AI
              </Badge>
              <Badge tone="acid" variant="tint">
                Saved
              </Badge>
              <Badge tone="ink" variant="outline">
                Draft
              </Badge>
              <Badge tone="concrete" size="md">
                Archived
              </Badge>
              <Badge tone="ink" size="md" icon="remote">
                Remote · EU
              </Badge>
            </div>
          </div>
          <div>
            <Label>Stickers</Label>
            <div className="flex flex-wrap items-center gap-4 py-2">
              <Sticker tone="signal">New</Sticker>
              <Sticker tone="acid" icon="bolt">
                Stretch
              </Sticker>
              <Sticker tone="concrete" icon="ghost">
                Ghost risk
              </Sticker>
              <Sticker tone="lilac" size="sm">
                Agency
              </Sticker>
              <Sticker tone="radar" size="lg" tilt="right">
                Top fit
              </Sticker>
            </div>
          </div>
        </div>
      </Specimen>

      {/* F — Provenance */}
      <Specimen id="provenance" code="F" title="Provenance" description="Every fact carries a receipt: value, exact quote, source, method, confidence, when it was checked and which logic version produced it.">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Receipt
            title={SPECIMEN_RECEIPT.title}
            value={SPECIMEN_RECEIPT.value}
            serial={SPECIMEN_RECEIPT.serial}
            quote={SPECIMEN_RECEIPT.quote}
            source={SPECIMEN_RECEIPT.source}
            sourceHref="https://example.com/careers/4102"
            method={SPECIMEN_RECEIPT.method}
            confidence={SPECIMEN_RECEIPT.confidence}
            checkedAt={new Date(now.getTime() - 3 * 3_600_000)}
            logicVersion={SPECIMEN_RECEIPT.logicVersion}
            rows={[
              { label: "Register", value: "Not checked (DE has none)" },
              { label: "Route", value: "EU Blue Card" },
              { label: "Verdict", value: "Confirmed", strong: true },
            ]}
            footnote="A manual note would override this receipt."
          >
            <Stamp kind="visa" status="confirmed" sub="EU Blue Card · DE" />
          </Receipt>
          <div className="flex flex-col gap-6">
            <div>
              <Label>Method (trust order)</Label>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {METHOD_ORDER.map((m) => (
                  <li key={m} className="flex flex-wrap items-center gap-3">
                    <MethodTag method={m} variant="long" />
                    <span className="text-sm text-ink-soft">{METHOD_META[m].description}</span>
                  </li>
                ))}
                <li className="flex flex-wrap items-center gap-3">
                  <MethodTag method={null} />
                  <span className="text-sm text-ink-soft">Shown when the method is missing — never hidden.</span>
                </li>
              </ul>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <Label>Confidence</Label>
                <div className="flex flex-col gap-2">
                  <ConfidenceMeter level="high" />
                  <ConfidenceMeter level="medium" />
                  <span className="flex items-center gap-2">
                    <ConfidenceMeter level="low" /> <LowConfTag />
                  </span>
                  <ConfidenceMeter level={null} />
                </div>
              </div>
              <div>
                <Label>Estimates &amp; as-of</Label>
                <div className="flex flex-col items-start gap-2">
                  <EstimateTag basis="DE · DevSecOps · mid · 2026 table">€52k–€64k</EstimateTag>
                  <EstimateTag size="sm" />
                  <AsOf at={new Date(now.getTime() - 40 * 60_000)} now={now} />
                  <AsOf at={new Date(now.getTime() - 50 * 3_600_000)} label="Checked" staleAfterHours={24} now={now} />
                  <p className="text-sm">
                    Inline: <AsOf at={new Date(now.getTime() - 5 * 3_600_000)} variant="inline" label="seen" now={now} />
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <Label>Key–value · rows</Label>
            <KeyValue
              items={[
                { label: "Salary", value: "€72k–€88k", hint: "Stated in posting" },
                { label: "Remote", value: "Hybrid · 2 days", mono: false },
                { label: "Relocation", value: <Unknown /> },
                { label: "Language", value: "English (German a plus)", mono: false },
              ]}
            />
          </div>
          <div>
            <Label>Key–value · grid</Label>
            <KeyValue
              layout="grid"
              items={[
                { label: "Threshold", value: "€48,300", hint: "Blue Card DE 2026" },
                { label: "Your floor", value: "€60,000" },
                { label: "Margin", value: "+24%" },
                { label: "Processing", value: <Unknown>No data</Unknown> },
              ]}
            />
          </div>
        </div>
      </Specimen>

      {/* G — Scores */}
      <Specimen id="scores" code="G" title="Scores & meters" description="Big numerals, chunky blocks. Small samples are hatched and say so instead of pretending to be precise.">
        <div className="flex flex-wrap items-end gap-8">
          <FitGauge score={86} size="lg" />
          <FitGauge score={71} />
          <FitGauge score={44} size="sm" />
          <FitGauge score={null} size="sm" />
          <FitGauge score={64} variant="block" />
          <div className="flex flex-col gap-2">
            <FitGauge score={86} variant="inline" />
            <FitGauge score={52} variant="inline" />
            <FitGauge score={null} variant="inline" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatBlock label="New blips" value="37" detail="+12 since yesterday" tone="acid">
            <Sparkline values={SPECIMEN_RUNS} label="Jobs per run, last 14 runs: 212 to 271, one run returned 0" band={{ low: 180, high: 280 }} width={200} height={36} />
          </StatBlock>
          <StatBlock label="Response rate" value="18" unit="%" detail="4 replies / 22 applications" />
          <StatBlock label="Interview rate" value="1/3" detail="n = 3" caveat />
          <StatBlock label="Open alerts" value="2" tone="signal" href={`${PATH}#feedback`} detail="1 critical" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Label>Progress blocks</Label>
            <ProgressBlocks value={37} max={50} label="AI calls used today" warnAt={0.7} dangerAt={1} />
            <ProgressBlocks value={50} max={50} label="AI budget" warnAt={0.7} dangerAt={1} />
            <ProgressBlocks value={3} max={10} label="Profile completeness" tone="radar" size="sm" readout="3/10 fields" />
          </div>
          <div className="flex flex-col gap-3">
            <Label>Mini bars</Label>
            <MiniBars values={SPECIMEN_AI_CALLS} label="AI calls per day, last 7 days, limit 40" limit={40} width={220} height={48} tone="lilac" />
            <MiniBars values={[4, 6, 3, 8, 5, 9, 7, 11, 6]} label="Applications per week" width={220} height={40} />
          </div>
        </div>
      </Specimen>

      {/* H — Scope */}
      <Specimen id="scope" code="H" title="Radar & ticker" description="Jobs are blips. Linked blips are keyboard reachable; the sweep and pings stop under reduced motion.">
        <div className="grid gap-6 md:grid-cols-2">
          <figure className="m-0">
            <div className="border-3 border-ink shadow-lg">
              <RadarSweep blips={BLIPS} label="Specimen scope" />
            </div>
            <figcaption className="micro mt-2 text-muted">surface=console · 4 linked blips</figcaption>
          </figure>
          <figure className="m-0">
            <div className="border-3 border-ink shadow-lg">
              <RadarSweep blips={BLIPS.map((b) => ({ ...b, href: undefined }))} surface="paper" static label="Specimen printed chart" />
            </div>
            <figcaption className="micro mt-2 text-muted">surface=paper · static</figcaption>
          </figure>
        </div>
        <div className="flex flex-col gap-3">
          <Ticker
            kicker="New today"
            items={jobs.map((j) => ({ id: j.id, label: `${j.title} · ${j.company}`, meta: `${j.country} · ${j.fit ?? "—"}`, href: `${PATH}#tables`, fresh: j.fresh }))}
          />
          <Ticker items={[]} kicker="New" />
        </div>
      </Specimen>

      {/* I — Forms */}
      <Specimen id="forms" code="I" title="Forms" description="16px inputs (no iOS zoom), 44px targets, visible labels, errors tied to fields and announced.">
        <FormDemo />
      </Specimen>

      {/* J — Navigation */}
      <Specimen id="navigation" code="J" title="Tabs, filters, paging" description="URL-driven: every tab, filter and page is a real link, so it works without JS and survives reloads.">
        <div>
          <Label>Link tabs (URL)</Label>
          <LinkTabs
            label="Specimen application stages"
            tabs={[
              { href: hrefWith(PATH, sp, { tab: "open" }) + "#navigation", label: "Open", count: 12, active: tab === "open" },
              { href: hrefWith(PATH, sp, { tab: "interview" }) + "#navigation", label: "Interview", count: 2, active: tab === "interview" },
              { href: hrefWith(PATH, sp, { tab: "offer" }) + "#navigation", label: "Offer", count: 0, active: tab === "offer" },
              { href: hrefWith(PATH, sp, { tab: "closed" }) + "#navigation", label: "Closed", count: 31, active: tab === "closed" },
            ]}
          />
        </div>
        <div>
          <Label>Client tabs (in-page)</Label>
          <ClientTabs
            label="Specimen job detail"
            tabs={[
              { id: "evidence", label: "Evidence", count: 4, content: <p className="text-sm">Four receipts back the verdicts on this job.</p> },
              { id: "company", label: "Company", content: <p className="text-sm">Sponsor-register status and hiring history.</p> },
              { id: "notes", label: "Notes", count: 0, content: <p className="text-sm">No notes yet.</p> },
            ]}
          />
        </div>
        <div className="flex flex-col gap-3">
          <Label>Filter chips</Label>
          <FilterChipRow label="Country">
            {["DE", "NL", "IE", "NO", "ES"].map((c) => (
              <FilterChip key={c} href={hrefToggle(PATH, sp, "country", c) + "#navigation"} active={countries.includes(c)} count={jobs.filter((j) => j.country === c).length}>
                {c}
              </FilterChip>
            ))}
          </FilterChipRow>
          <p className="font-mono text-xs text-muted">
            {countries.length ? `${jobs.length - filtered.length} hidden by filters (country ∉ ${countries.join(", ")})` : "No filters · nothing hidden"}
          </p>
        </div>
        <div>
          <Label>Pagination</Label>
          <Pagination pathname={PATH} searchParams={sp} page={page} pageSize={20} total={1204} noun="jobs" />
        </div>
      </Specimen>

      {/* K — Tables */}
      <Specimen id="tables" code="K" title="Tables" description="A real table on desktop with sort links; stacked cards under 768px. Resize to see it collapse.">
        <DataTable
          caption="Specimen jobs"
          rows={filtered}
          columns={columns}
          rowKey={(j) => j.id}
          rowHref={() => `${PATH}#tables`}
          sort={{ pathname: PATH, searchParams: sp, sort, dir }}
          empty={
            <EmptyState icon="filter" code="0 BLIPS" title="Filters hide everything" size="sm" note={`${jobs.length} hidden by: country ∈ ${countries.join(", ")}`} />
          }
        />
      </Specimen>

      {/* L — Overlays */}
      <Specimen id="overlays" code="L" title="Overlays & toasts" description="Native <dialog> with a focus trap. Drawers are bottom sheets on phones and side panels on desktop.">
        <div className="flex flex-wrap items-center gap-3">
          <ModalButton
            label="Archive job…"
            icon="trash"
            variant="danger"
            tone="stamp"
            kicker="Confirm"
            title="Archive this job?"
            description="It leaves the scope and the tracker. The receipts and audit trail stay."
            footer={
              <>
                <Button variant="secondary" data-dialog-close>
                  Keep it
                </Button>
                <Button variant="danger" data-dialog-close icon="trash">
                  Archive
                </Button>
              </>
            }
          >
            <p className="font-mono text-sm">Senior Cloud Security Engineer · Nordlicht Cloud GmbH</p>
          </ModalButton>
          <DrawerButton
            label="Filters"
            badge={countries.length || null}
            title="Filter jobs"
            kicker="Scope"
            footer={
              <Button variant="primary" fullWidth data-dialog-close>
                Show {filtered.length} jobs
              </Button>
            }
          >
            <p className="text-sm">Filter controls live here on phones. The chips in section J drive the same URL state.</p>
          </DrawerButton>
          <Tooltip content="Register match on 12 Sep 2026">
            <button type="button" className="min-h-11 border-3 border-ink bg-card px-3 font-bold shadow-xs">
              Hover or focus me
            </button>
          </Tooltip>
          <span className="flex items-center gap-1 font-bold">
            Threshold <InfoTip content="EU Blue Card DE 2026: €48,300 gross/yr (shortage occupations lower)." />
          </span>
        </div>
        <ToastDemo />
      </Specimen>

      {/* M — Feedback */}
      <Specimen id="feedback" code="M" title="Notices & empty states" description="Terse field-manual voice. Say what happened, what it means and what to do.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Notice kind="info" title="Run scheduled">Next pipeline run at 14:30 IST.</Notice>
          <Notice kind="ok" title="All sources healthy">9 of 9 connectors returned jobs in the last run.</Notice>
          <Notice kind="warn" title="Signal lost: arbeitnow">0 jobs this run — keeping yesterday&apos;s 212.</Notice>
          <Notice kind="danger" title="Backup failed" actions={<Button size="sm" variant="secondary" href={`${PATH}#feedback`}>Open System</Button>}>
            Last good backup 2 days ago.
          </Notice>
          <Notice kind="ai" title="AI-derived">Extracted by AI with a verified quote. A rule or record always wins.</Notice>
          <Notice kind="neutral">5 hidden by filters: visa=confirmed.</Notice>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState icon="radar" code="0 BLIPS" title="Nothing on the scope" actions={<Button variant="primary" href={`${PATH}#navigation`}>Clear filters</Button>} note="Filters: visa=confirmed · country=NO · 14 hidden">
            No jobs match these filters. The last run finished 40 minutes ago.
          </EmptyState>
          <EmptyState icon="tracker" code="IDLE" tone="cobalt" size="sm" title="No applications yet">
            Save a job, then move it to Applied when you send it.
          </EmptyState>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <Label>Timeline (logbook)</Label>
            <Timeline entries={log} footer="Append-only. Corrections are new entries." />
          </div>
          <div>
            <Label>Skeletons</Label>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton lines={3} />
              <SkeletonCard />
            </div>
          </div>
        </div>
      </Specimen>

      {/* N — Layout */}
      <Specimen id="layout" code="N" title="Cards & headers" description="Flat slabs with thick borders. Dashed means pending or unknown.">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Card pad="none" as="article">
            <CardHeader kicker="04 · Visa & criteria" title="Blue Card DE" band="acid" actions={<Badge tone="radar">Meets</Badge>} />
            <CardBody>
              <p className="text-sm">Salary floor clears the 2026 threshold by 24%. Degree recognition: confirmed on anabin.</p>
            </CardBody>
            <CardFooter>
              <AsOf at={new Date(now.getTime() - 6 * 86_400_000)} label="Rule checked" staleAfterHours={24 * 30} now={now} />
              <Button size="sm" variant="ghost" href={`${PATH}#provenance`}>
                Receipts
              </Button>
            </CardFooter>
          </Card>
          <Card pad="none">
            <CardHeader kicker="System" title="Last run" band="ink" />
            <CardBody className="flex flex-col gap-3">
              <KeyValue
                items={[
                  { label: "Finished", value: "14:02 IST" },
                  { label: "Jobs", value: "248" },
                  { label: "Errors", value: "0" },
                ]}
              />
            </CardBody>
          </Card>
          <Card dashed tone="paper" shadow="none">
            <p className="micro text-muted">Dashed card</p>
            <p className="mt-1 font-bold">Pending verification</p>
            <p className="mt-1 text-sm text-ink-soft">Shown while a source is being re-checked.</p>
          </Card>
          <Card href={`${PATH}#layout`} tone="acid" shadow="md">
            <p className="micro">Linked card</p>
            <p className="headline wide mt-1 text-2xl uppercase">Open tracker</p>
          </Card>
          <Card tone="lilac" shadow="sm">
            <p className="micro">Tone lilac</p>
            <p className="mt-1 text-sm">AI-derived summaries sit on lilac so they never pass for facts.</p>
          </Card>
          <Card tone="ink" shadow="lg" className="on-ink">
            <Wordmark size="md" onInk tagline />
          </Card>
        </div>
        <div className="flex flex-col gap-6 border-3 border-ink bg-card p-4 md:p-6">
          <SectionHeader as="h3" kicker="h3 section header" title="Follow-ups due" actions={<Badge tone="signal">2 today</Badge>} />
          <SectionHeader as="h3" index="07" title="With an index block" description="Index blocks carry the section code from the rail." />
          <div className="flex flex-wrap items-end gap-6">
            <Wordmark size="sm" />
            <Wordmark size="md" />
            <Wordmark size="lg" tagline />
          </div>
        </div>
      </Specimen>
    </div>
  );
}
