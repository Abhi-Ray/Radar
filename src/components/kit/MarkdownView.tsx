/**
 * Renders kit Markdown (see ./markdown.ts) as React elements: never HTML, so a pasted `<script>` is
 * just text. Works in server and client components (no hooks). `{{slot}}` fields render as the
 * value from `slots` (literal text, never re-parsed) or as a dashed "fill me in" chip.
 */
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { parseMarkdown, type Block, type Inline } from "./markdown";

export interface MarkdownProps {
  source: string | null | undefined;
  /** Pre-parsed blocks (skips parsing `source`). */
  blocks?: Block[];
  slots?: Record<string, string | undefined>;
  /** Labels for slot chips ("{{company}}" → "Company"). */
  slotLabels?: Record<string, string>;
  className?: string;
  /** Tighter type for small previews. */
  compact?: boolean;
  /** Shown when there is nothing to render. */
  emptyText?: ReactNode;
}

function renderInline(nodes: readonly Inline[], p: MarkdownProps, key = "i"): ReactNode[] {
  return nodes.map((n, idx) => {
    const k = `${key}.${idx}`;
    switch (n.t) {
      case "text":
        return n.v;
      case "br":
        return <br key={k} />;
      case "code":
        return (
          <code key={k} className="border border-ink/30 bg-paper-deep px-1 font-mono text-[0.9em]">
            {n.v}
          </code>
        );
      case "strong":
        return (
          <strong key={k} className="font-extrabold">
            {renderInline(n.c, p, k)}
          </strong>
        );
      case "em":
        return <em key={k}>{renderInline(n.c, p, k)}</em>;
      case "link":
        return n.href ? (
          <a
            key={k}
            href={n.href}
            className="font-bold text-cobalt-deep underline decoration-2 underline-offset-2 break-words"
            {...(n.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer nofollow" })}
          >
            {renderInline(n.c, p, k)}
          </a>
        ) : (
          <span key={k} title="Link removed: only https and mailto links are kept">
            {renderInline(n.c, p, k)}
          </span>
        );
      case "slot": {
        const v = p.slots?.[n.key];
        if (v && v.trim()) {
          return (
            <mark key={k} className="bg-acid-tint px-0.5 text-ink" data-slot={n.key}>
              {v.trim()}
            </mark>
          );
        }
        return (
          <span
            key={k}
            data-slot={n.key}
            className="inline-block border-2 border-dashed border-signal-deep bg-signal-tint px-1 font-mono text-[0.85em] font-bold text-signal-deep"
          >
            {p.slotLabels?.[n.key] ?? n.key}
          </span>
        );
      }
    }
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "headline text-2xl sm:text-3xl",
  2: "text-xl font-extrabold",
  3: "text-lg font-extrabold",
  4: "text-base font-extrabold",
  5: "micro text-ink",
  6: "micro text-muted",
};

function renderBlocks(blocks: readonly Block[], p: MarkdownProps, key = "b"): ReactNode[] {
  return blocks.map((b, idx) => {
    const k = `${key}.${idx}`;
    switch (b.t) {
      case "heading": {
        const Tag = `h${Math.min(6, b.level + 1)}` as "h2";
        return (
          <Tag key={k} className={cn(HEADING_CLASS[b.level], "break-words")}>
            {renderInline(b.c, p, k)}
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={k} className="break-words">
            {renderInline(b.c, p, k)}
          </p>
        );
      case "hr":
        return <hr key={k} className="perforation my-1" />;
      case "code":
        return (
          <pre key={k} className="overflow-x-auto border-2 border-ink bg-ink p-3 font-mono text-xs text-paper" data-lang={b.lang ?? undefined}>
            <code>{b.v}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote key={k} className="flex flex-col gap-2 border-l-4 border-ink bg-paper-deep/60 py-1 pr-2 pl-3 italic">
            {renderBlocks(b.blocks, p, k)}
          </blockquote>
        );
      case "list": {
        const tasks = b.items.some((i) => i.task !== null);
        const items = b.items.map((item, j) => {
          const only = item.blocks.length === 1 && item.blocks[0].t === "paragraph" ? item.blocks[0] : null;
          const body = only ? renderInline(only.c, p, `${k}.${j}`) : <div className="flex flex-col gap-2">{renderBlocks(item.blocks, p, `${k}.${j}`)}</div>;
          if (item.task === null) return <li key={`${k}.${j}`}>{body}</li>;
          return (
            <li key={`${k}.${j}`} className="flex list-none items-start gap-2">
              <span
                aria-hidden
                className={cn(
                  "mt-1 inline-flex size-4 shrink-0 items-center justify-center border-2 border-ink font-mono text-[10px] leading-none font-black",
                  item.task ? "bg-radar" : "bg-card",
                )}
              >
                {item.task ? "✓" : ""}
              </span>
              <span className="sr-only">{item.task ? "Done: " : "To do: "}</span>
              <div className="min-w-0 flex-1">{body}</div>
            </li>
          );
        });
        const cls = cn("flex flex-col gap-1", tasks ? "pl-0" : "pl-6", b.ordered ? "list-decimal" : "list-[square]");
        return b.ordered ? (
          <ol key={k} className={cls} start={b.start === 1 ? undefined : b.start}>
            {items}
          </ol>
        ) : (
          <ul key={k} className={cls}>
            {items}
          </ul>
        );
      }
    }
  });
}

export function Markdown(props: MarkdownProps) {
  const blocks = props.blocks ?? parseMarkdown(props.source);
  if (!blocks.length) {
    return props.emptyText ? <p className="text-sm text-muted italic">{props.emptyText}</p> : null;
  }
  return (
    <div className={cn("flex min-w-0 flex-col text-ink", props.compact ? "gap-2 text-sm" : "gap-3 text-[0.95rem] leading-relaxed", props.className)}>
      {renderBlocks(blocks, props)}
    </div>
  );
}
