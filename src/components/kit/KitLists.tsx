/**
 * The kit's side lists (server): resume versions and templates, each a link that selects it via
 * the URL (?resume= / ?template=), so the choice survives reloads and works without JavaScript.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { formatDate } from "@/components/ui/format";
import { Icon } from "@/components/ui/icons";
import type { TemplateRow } from "@/db/schema";
import type { ResumeListItem } from "@/lib/queries/kit";
import { TEMPLATE_KIND_KEYS, TEMPLATE_KIND_LABEL, TRACK_LABEL, TRACK_TONE, isResumeTrack } from "./labels";

function itemClasses(active: boolean) {
  return cn(
    "flex min-h-11 min-w-0 flex-col gap-1 border-3 border-ink px-3 py-2 no-underline",
    active ? "bg-ink text-paper on-ink shadow-none" : "bg-card text-ink shadow-xs hover:bg-acid-tint",
  );
}

export function ResumeList({ resumes, selected, tz }: { resumes: ResumeListItem[]; selected: number | "new" | null; tz: string }) {
  return (
    <nav aria-label="Resume versions" className="flex min-w-0 flex-col gap-2">
      <Link href="/kit?tab=resumes&resume=new" scroll={false} className={buttonClasses({ variant: selected === "new" ? "ink" : "primary", fullWidth: true })}>
        <Icon name="plus" size={18} />
        New version
      </Link>
      {resumes.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {resumes.map((r) => {
            const active = selected === r.id;
            return (
              <li key={r.id}>
                <Link href={`/kit?tab=resumes&resume=${r.id}`} scroll={false} aria-current={active ? "page" : undefined} className={itemClasses(active)}>
                  <span className="font-bold leading-snug [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {isResumeTrack(r.track) ? (
                      <Badge tone={TRACK_TONE[r.track]} size="sm">
                        {TRACK_LABEL[r.track]}
                      </Badge>
                    ) : null}
                    <span className={cn("font-mono text-[0.6875rem]", active ? "text-paper/80" : "text-muted")}>
                      {formatDate(r.updatedAt, { tz })} · {r.usedBy ? `sent ${r.usedBy}×` : "not sent yet"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">No versions yet. Paste your CV as Markdown to start — one version per track or market.</p>
      )}
    </nav>
  );
}

export function TemplateList({ templates, selected, countryName }: { templates: TemplateRow[]; selected: number | "new" | null; countryName: (iso2: string) => string }) {
  const groups = TEMPLATE_KIND_KEYS.map((k) => ({ kind: k, items: templates.filter((t) => t.kind === k) })).filter((g) => g.items.length);
  return (
    <nav aria-label="Templates" className="flex min-w-0 flex-col gap-3">
      <Link href="/kit?tab=templates&template=new" scroll={false} className={buttonClasses({ variant: selected === "new" ? "ink" : "primary", fullWidth: true })}>
        <Icon name="plus" size={18} />
        New template
      </Link>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.kind} className="flex flex-col gap-2">
            <p className="micro text-ink">{TEMPLATE_KIND_LABEL[g.kind]}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {g.items.map((t) => {
                const active = selected === t.id;
                return (
                  <li key={t.id}>
                    <Link href={`/kit?tab=templates&template=${t.id}`} scroll={false} aria-current={active ? "page" : undefined} className={itemClasses(active)}>
                      <span className="font-bold leading-snug [overflow-wrap:anywhere]">{t.name}</span>
                      {t.countryIso2 ? <span className={cn("font-mono text-[0.6875rem]", active ? "text-paper/80" : "text-muted")}>{countryName(t.countryIso2)}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      ) : (
        <p className="text-sm text-ink-soft">No templates yet. Write a cover letter once with {"{{fields}}"} and fill it per job.</p>
      )}
    </nav>
  );
}
