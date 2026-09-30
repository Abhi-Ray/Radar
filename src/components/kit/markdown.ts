/**
 * A small, safe Markdown reader for the application kit (resume versions, cover letters, outreach).
 * Pure and client-safe: the editor preview and the server pages parse with the same code.
 *
 * Safety model: the text is parsed into a tree and rendered as React elements, so nothing is ever
 * handed to the browser as HTML. Raw HTML in the source (`<script>`, `<img onerror>`) stays literal
 * text. Links survive only as http(s) (through `safeExternalHref`) or `mailto:`; anything else
 * (`javascript:`, `data:`, relative paths) renders as its text without a link.
 *
 * Supported: ATX headings, paragraphs (a single newline is a line break), bullet / numbered lists
 * with `[ ]` / `[x]` task boxes and nesting, blockquotes, fenced code, horizontal rules;
 * inline **strong**, *em* / _em_ (underscore only at word boundaries), `code`, [links](https://…),
 * <https://autolinks>, bare https:// URLs, `{{slot}}` fill-in fields and backslash escapes.
 */
import { safeExternalHref } from "@/components/ui/url";

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  /** `href` is null when the target was not a safe link: render the text only. */
  | { t: "link"; href: string | null; c: Inline[] }
  | { t: "slot"; key: string }
  | { t: "br" };

export interface ListItem {
  /** null = a plain item, true / false = a ticked / unticked task box. */
  task: boolean | null;
  blocks: Block[];
}

export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "paragraph"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "code"; lang: string | null; v: string }
  | { t: "hr" };

/** Longest source parsed (a CV is a few thousand characters; anything past this is cut). */
export const MAX_MARKDOWN = 200_000;
/** Deepest nesting of lists / quotes and of inline emphasis. Deeper content is kept as text. */
export const MAX_DEPTH = 6;

/** `{{ key }}`: a letter, then letters, digits, `_`, `.` or `-` (at most 41 characters). */
export const SLOT_RE = /\{\{\s*([A-Za-z][\w.-]{0,40})\s*\}\}/g;

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^( {0,3})([-*+])([ \t]+)(.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+)(.*)$/;
const EMPTY_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])[ \t]*$/;
const TASK = /^\[([ xX])\][ \t]+/;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|<]/;

const isBlank = (line: string) => line.trim() === "";

function expandTabs(line: string): string {
  return line.includes("\t") ? line.replace(/\t/g, "    ") : line;
}

function indentOf(line: string): number {
  const m = /^ */.exec(line);
  return m ? m[0].length : 0;
}

/** Removes up to `n` leading spaces. */
function dedent(line: string, n: number): string {
  let i = 0;
  while (i < n && line[i] === " ") i++;
  return line.slice(i);
}

interface ListMarker {
  indent: number;
  ordered: boolean;
  start: number;
  /** Column where the item text starts (continuation lines indent to here). */
  contentCol: number;
  text: string;
}

function listMarker(line: string): ListMarker | null {
  const b = BULLET.exec(line);
  if (b) {
    const pad = Math.min(b[3].length, 4);
    return { indent: b[1].length, ordered: false, start: 1, contentCol: b[1].length + 1 + pad, text: b[4] };
  }
  const o = ORDERED.exec(line);
  if (o) {
    const pad = Math.min(o[4].length, 4);
    return { indent: o[1].length, ordered: true, start: Number(o[2]), contentCol: o[1].length + o[2].length + 1 + pad, text: o[5] };
  }
  const e = EMPTY_ITEM.exec(line);
  if (e) {
    const ordered = /\d/.test(e[2]);
    return { indent: e[1].length, ordered, start: ordered ? Number.parseInt(e[2], 10) : 1, contentCol: e[1].length + e[2].length + 1, text: "" };
  }
  return null;
}

/** Does this line start a block other than a paragraph (so a paragraph ends before it)? */
function interrupts(line: string): boolean {
  return HEADING.test(line) || HR.test(line) || FENCE.test(line) || QUOTE.test(line) || listMarker(line) !== null;
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Too deep: keep the rest as plain paragraphs (still escaped, nothing is lost).
    if (depth > MAX_DEPTH) {
      const para: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) para.push(lines[i++].trim());
      out.push({ t: "paragraph", c: [{ t: "text", v: para.join(" ") }] });
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const indent = fence[1].length;
      const marker = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
        if (close.test(l)) {
          i++;
          break;
        }
        body.push(dedent(l, indent));
        i++;
      }
      out.push({ t: "code", lang: fence[3] ? fence[3].slice(0, 32) : null, v: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ t: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline((heading[2] ?? "").trim(), 0) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i]);
        if (q) inner.push(q[1]);
        // Lazy continuation: a plain line right after quoted text stays in the quote.
        else if (!isBlank(lines[i]) && inner.length && !isBlank(inner[inner.length - 1]) && !interrupts(lines[i])) inner.push(lines[i]);
        else break;
        i++;
      }
      out.push({ t: "quote", blocks: parseBlocks(inner, depth + 1) });
      continue;
    }

    const first = listMarker(line);
    if (first) {
      const items: ListItem[] = [];
      const base = first.indent;
      while (i < lines.length) {
        const m = listMarker(lines[i]);
        if (!m || m.indent !== base || m.ordered !== first.ordered) break;
        const body: string[] = [m.text];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) {
            // A blank line ends the item unless indented content follows.
            const next = lines[i + 1];
            if (next !== undefined && !isBlank(next) && indentOf(next) >= m.contentCol) {
              body.push("");
              i++;
              continue;
            }
            break;
          }
          if (indentOf(l) >= m.contentCol) {
            body.push(dedent(l, m.contentCol));
            i++;
            continue;
          }
          const sibling = listMarker(l);
          if (sibling && sibling.indent <= base) break;
          if (sibling && sibling.indent > base) {
            // Under-indented nested marker: still a child of this item.
            body.push(dedent(l, base + 2));
            i++;
            continue;
          }
          if (interrupts(l)) break;
          // Lazy continuation of the item's paragraph.
          body.push(l.trim());
          i++;
        }
        let task: boolean | null = null;
        const tm = TASK.exec(body[0]);
        if (tm) {
          task = tm[1] !== " ";
          body[0] = body[0].slice(tm[0].length);
        }
        items.push({ task, blocks: parseBlocks(body, depth + 1) });
        // Blank lines between items keep the list going.
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        const again = j < lines.length ? listMarker(lines[j]) : null;
        if (again && again.indent === base && again.ordered === first.ordered) i = j;
        else break;
      }
      out.push({ t: "list", ordered: first.ordered, start: first.start, items });
      continue;
    }

    // Paragraph: up to a blank line or the start of another block.
    const para: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines[i])) para.push(lines[i++]);
    out.push({ t: "paragraph", c: parseInline(para.map((l) => l.trim()).join("\n"), 0) });
  }
  return out;
}

/** Parses Markdown source into blocks. Never throws; oversized input is cut at MAX_MARKDOWN. */
export function parseMarkdown(src: string | null | undefined): Block[] {
  if (typeof src !== "string" || !src) return [];
  const text = src.length > MAX_MARKDOWN ? src.slice(0, MAX_MARKDOWN) : src;
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(expandTabs);
  return parseBlocks(lines, 0);
}

// ---- inline ----------------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}]/u;
const isWordChar = (ch: string | undefined) => ch !== undefined && WORD.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const TRAILING_PUNCT = /[.,;:!?'")\]]+$/;

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

/** Resolves a link target: https/http through the external guard, mailto kept, the rest dropped. */
export function safeLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (/^mailto:/i.test(href)) {
    const addr = href.slice(7);
    return /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/.test(decodeSafe(addr)) ? `mailto:${addr}` : null;
  }
  return safeExternalHref(href);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Finds the closing delimiter for emphasis starting after `from`; -1 when there is none. */
function findClose(s: string, from: number, delim: string): number {
  let i = from;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      i = end === -1 ? i + run.length : end + run.length;
      continue;
    }
    if (s.startsWith(delim, i) && !isSpace(s[i - 1])) {
      if (delim.length === 1) {
        // A single * or _ must not be half of a double.
        if (s[i + 1] === delim) {
          i += 2;
          continue;
        }
        if (delim === "_" && isWordChar(s[i + 1])) {
          i++;
          continue;
        }
      } else if (delim === "__" && isWordChar(s[i + 2])) {
        i++;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/** Index of the `]` matching the `[` at `open`, or -1. */
function findBracket(s: string, open: number): number {
  let level = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") level++;
    else if (ch === "]") {
      level--;
      if (level === 0) return i;
    }
  }
  return -1;
}

export function parseInline(s: string, depth: number, inLink = false): Inline[] {
  const out: Inline[] = [];
  if (depth > MAX_DEPTH) {
    pushText(out, s);
    return out;
  }
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === "\\") {
      const next = s[i + 1];
      if (next === "\n") {
        out.push({ t: "br" });
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.test(next)) {
        pushText(out, next);
        i += 2;
        continue;
      }
      pushText(out, ch);
      i++;
      continue;
    }

    if (ch === "\n") {
      // Trailing spaces were trimmed per line already: every newline is a line break.
      out.push({ t: "br" });
      i++;
      continue;
    }

    if (ch === "`") {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end !== -1 && s[end + run.length] !== "`") {
        let code = s.slice(i + run.length, end).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
        out.push({ t: "code", v: code });
        i = end + run.length;
        continue;
      }
      pushText(out, run);
      i += run.length;
      continue;
    }

    if (ch === "{" && s[i + 1] === "{") {
      SLOT_RE.lastIndex = 0;
      const m = new RegExp(SLOT_RE.source, "y");
      m.lastIndex = i;
      const hit = m.exec(s);
      if (hit) {
        out.push({ t: "slot", key: hit[1] });
        i += hit[0].length;
        continue;
      }
    }

    if (ch === "[" && !inLink) {
      const close = findBracket(s, i);
      if (close !== -1 && s[close + 1] === "(") {
        const end = s.indexOf(")", close + 2);
        if (end !== -1) {
          const target = s.slice(close + 2, end).trim().split(/\s+/)[0] ?? "";
          const label = s.slice(i + 1, close);
          out.push({ t: "link", href: safeLinkHref(target.replace(/^<|>$/g, "")), c: parseInline(label, depth + 1, true) });
          i = end + 1;
          continue;
        }
      }
    }

    if (ch === "<" && !inLink) {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i));
      if (m) {
        out.push({ t: "link", href: safeLinkHref(m[1]), c: [{ t: "text", v: m[1].replace(/^mailto:/i, "") }] });
        i += m[0].length;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && !inLink && !isWordChar(s[i - 1])) {
      const m = /^https?:\/\/[^\s<>]+/i.exec(s.slice(i));
      if (m) {
        let url = m[0];
        const trail = TRAILING_PUNCT.exec(url);
        if (trail) url = url.slice(0, -trail[0].length);
        const href = safeLinkHref(url);
        if (href) {
          out.push({ t: "link", href, c: [{ t: "text", v: url }] });
          i += url.length;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_") {
      const double = s[i + 1] === ch;
      const delim = double ? ch + ch : ch;
      const after = s[i + delim.length];
      const before = s[i - 1];
      const opens = !isSpace(after) && after !== ch && (ch === "*" || !isWordChar(before));
      if (opens) {
        const close = findClose(s, i + delim.length, delim);
        if (close !== -1 && close > i + delim.length) {
          const inner = parseInline(s.slice(i + delim.length, close), depth + 1, inLink);
          out.push(double ? { t: "strong", c: inner } : { t: "em", c: inner });
          i = close + delim.length;
          continue;
        }
      }
      pushText(out, delim);
      i += delim.length;
      continue;
    }

    // Plain run up to the next character that might start something.
    const rest = s.slice(i);
    const m = /^[^\\\n`{[<*_hH]+/.exec(rest);
    const take = m ? m[0].length : 1;
    pushText(out, rest.slice(0, take));
    i += take;
  }
  return out;
}

// ---- plain text ------------------------------------------------------------------------------

export interface PlainOptions {
  /** Values for `{{slot}}` fields; a slot without a value stays as `{{key}}`. */
  slots?: Record<string, string | undefined>;
}

function inlinePlain(nodes: readonly Inline[], opts: PlainOptions): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
      case "code":
        out += n.v;
        break;
      case "br":
        out += "\n";
        break;
      case "strong":
      case "em":
        out += inlinePlain(n.c, opts);
        break;
      case "slot": {
        const v = opts.slots?.[n.key];
        out += v && v.trim() ? v.trim() : `{{${n.key}}}`;
        break;
      }
      case "link": {
        const label = inlinePlain(n.c, opts);
        const target = n.href?.replace(/^mailto:/i, "") ?? null;
        out += target && target !== label && `${target}/` !== label && target !== `${label}/` ? `${label} (${target})` : label;
        break;
      }
    }
  }
  return out;
}

function blocksPlain(blocks: readonly Block[], opts: PlainOptions): string[] {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "heading":
      case "paragraph":
        parts.push(inlinePlain(b.c, opts));
        break;
      case "code":
        parts.push(b.v);
        break;
      case "hr":
        parts.push("———");
        break;
      case "quote":
        parts.push(
          blocksPlain(b.blocks, opts)
            .join("\n\n")
            .split("\n")
            .map((l) => (l ? `> ${l}` : ">"))
            .join("\n"),
        );
        break;
      case "list":
        parts.push(
          b.items
            .map((item, idx) => {
              const bullet = b.ordered ? `${b.start + idx}. ` : "- ";
              const box = item.task === null ? "" : item.task ? "[x] " : "[ ] ";
              const body = blocksPlain(item.blocks, opts).join("\n");
              const [head, ...tail] = body.split("\n");
              const pad = " ".repeat(bullet.length);
              return [bullet + box + (head ?? ""), ...tail.map((l) => (l ? pad + l : l))].join("\n");
            })
            .join("\n"),
        );
        break;
    }
  }
  return parts;
}

/** Plain text for copying (into an email, a web form, a free AI chat): no markup, links as "text (url)". */
export function markdownToPlain(src: string | Block[] | null | undefined, opts: PlainOptions = {}): string {
  const blocks = Array.isArray(src) ? src : parseMarkdown(src);
  return blocksPlain(blocks, opts).join("\n\n").trim();
}

/** Word count of the rendered text (slots count as one word each). */
export function wordCount(src: string | null | undefined): number {
  const plain = markdownToPlain(src);
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’.+#/-]*/gu);
  return words ? words.length : 0;
}
