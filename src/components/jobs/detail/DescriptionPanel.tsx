import { Unknown } from "@/components/ui";
import { sanitizePostingHtml } from "@/lib/security/sanitize";
import type { JobDetail } from "@/lib/queries/jobs";
import { Panel } from "./FactMeta";

/** Child-selector typography for the sanitised posting (the allow-list: p, lists, headings, links, tables, code). */
const PROSE = [
  "max-w-[72ch] text-[0.975rem] leading-relaxed [overflow-wrap:anywhere]",
  "[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li]:my-1",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-extrabold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-extrabold [&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:font-bold",
  "[&_a]:font-bold [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-extrabold [&_b]:font-extrabold",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-ink/40 [&_blockquote]:pl-3 [&_blockquote]:italic",
  "[&_code]:bg-paper [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:border-2 [&_pre]:border-ink [&_pre]:bg-paper [&_pre]:p-3",
  "[&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-ink/30 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-ink/30 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&>*:first-child]:mt-0",
].join(" ");

/**
 * The posting text. Only `description_html_sanitized` is ever rendered as HTML, and it goes through
 * sanitizePostingHtml() again here (defence in depth). Without it, the plain text is shown as-is.
 */
export function DescriptionPanel({ detail }: { detail: JobDetail }) {
  const { job } = detail;
  const html = job.descriptionHtmlSanitized ? sanitizePostingHtml(job.descriptionHtmlSanitized) : "";
  const text = job.descriptionText.trim();
  return (
    <Panel id="description" code="F" kicker="Posting" title="The ad, as posted" actions={job.lang ? <span className="font-mono text-xs font-bold uppercase">{job.lang}</span> : null}>
      {html ? (
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: html }} />
      ) : text ? (
        <div className="max-w-[72ch] whitespace-pre-wrap text-[0.975rem] leading-relaxed [overflow-wrap:anywhere]">{text}</div>
      ) : (
        <p className="text-sm">
          <Unknown>The source gave no description.</Unknown>
        </p>
      )}
      <p className="border-t-2 border-dashed border-ink/40 pt-2 font-mono text-[0.6875rem] text-muted">
        Formatting stripped to a safe subset · content v{job.contentVersion}
      </p>
    </Panel>
  );
}
