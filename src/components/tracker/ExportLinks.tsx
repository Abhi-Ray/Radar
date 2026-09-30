/**
 * Download links for the whole tracker (GET /api/export/applications). Plain anchors with
 * `download`, so the browser saves the file instead of navigating.
 */
import { buttonClasses } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";

const EXPORTS = [
  { href: "/api/export/applications?format=json", label: "Everything · JSON", hint: "applications + events + snapshots + reminders" },
  { href: "/api/export/applications?format=csv&part=applications", label: "Applications · CSV", hint: "one row per application" },
  { href: "/api/export/applications?format=csv&part=events", label: "Logbook · CSV", hint: "one row per timeline entry" },
  { href: "/api/export/applications?format=csv&part=snapshots", label: "Snapshots · CSV", hint: "the posting copies" },
] as const;

export function ExportLinks() {
  return (
    <div className="flex flex-col gap-2">
      <p className="micro text-ink">Export</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {EXPORTS.map((e) => (
          <li key={e.href}>
            <a href={e.href} download className={buttonClasses({ variant: "secondary", size: "sm", fullWidth: true, className: "justify-start py-1.5" })}>
              <Icon name="download" size={16} />
              <span className="flex min-w-0 flex-col items-start whitespace-normal text-left leading-tight">
                <span>{e.label}</span>
                <span className="font-mono text-[0.625rem] font-normal normal-case leading-snug tracking-normal text-muted [overflow-wrap:anywhere]">
                  {e.hint}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">The export is the whole tracker, not just this view.</p>
    </div>
  );
}
