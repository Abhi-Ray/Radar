/**
 * Untrusted posting/source HTML → safe display HTML and plain text (spec §4 / brief §4).
 *
 * `sanitizePostingHtml()` is the ONLY way HTML reaches `jobs.description_html_sanitized` and the
 * only HTML the UI may render. Allow-list only: a small set of formatting tags, links limited to
 * http/https/mailto (always rel="nofollow noopener noreferrer" target="_blank"), no attributes
 * besides href/title/colspan/rowspan. Scripts, styles, iframes, images, SVG/MathML, forms and every
 * event handler / style attribute are dropped — dangerous containers together with their content.
 */
import { convert, type HtmlToTextOptions } from 'html-to-text';
import sanitizeHtml from 'sanitize-html';

export const ALLOWED_TAGS = [
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'h2',
  'h3',
  'h4',
  'a',
  'blockquote',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
] as const;

export const LINK_REL = 'nofollow noopener noreferrer';
export const ALLOWED_LINK_SCHEMES = ['http', 'https', 'mailto'] as const;

/** Elements removed together with everything inside them. */
const DROP_WITH_CONTENT = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'picture',
  'form',
  'button',
  'select',
  'option',
  'textarea',
  'input',
  'head',
  'title',
  'xmp',
  'noembed',
  'noframes',
  'plaintext',
] as const;

/** Block containers that are not allowed themselves; a line break keeps their text apart. */
const BLOCK_CONTAINERS = /<\/(?:div|section|article|header|footer|main|aside|nav|dl|dt|dd|figure|figcaption|address|center|details|summary|hr)\s*>|<hr\b[^>]*>/gi;

/** Hard cap on input size (bounds CPU); postings are far smaller in practice. */
export const MAX_HTML_INPUT = 1_000_000;
const MAX_HREF = 2048;

/**
 * Some APIs return HTML-escaped HTML (`&lt;p&gt;…`). When the input has no real tags but
 * escaped ones, unescape once so it is sanitised as markup instead of shown as literal tags.
 */
export function unescapeIfEncodedHtml(input: string): string {
  if (input.includes('<') || !/&lt;\/?[a-z][a-z0-9]*[\s\S]*?&gt;/i.test(input)) return input;
  return input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&#x0*27;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** Absolute http(s)/mailto URL or null. Relative links are dropped (no meaningful base). */
export function safeHref(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  // Same normalisation as browsers (WHATWG URL): tabs/newlines removed, C0/space trimmed.
  const cleaned = raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  if (!cleaned || cleaned.length > MAX_HREF) return null;
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!(ALLOWED_LINK_SCHEMES as readonly string[]).includes(scheme)) return null;
  if ((scheme === 'http' || scheme === 'https') && !url.hostname) return null;
  if (url.username || url.password) return null;
  return url.href;
}

const SPAN_CELL = /^[1-9]\d?$/;
const EMPTY_DROPPABLE = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: [...ALLOWED_LINK_SCHEMES],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  allowedClasses: {},
  allowedStyles: {},
  allowVulnerableTags: false,
  disallowedTagsMode: 'discard',
  nonTextTags: [...DROP_WITH_CONTENT],
  parser: { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
  transformTags: {
    h1: 'h2',
    h5: 'h4',
    h6: 'h4',
    a: (_tag, attribs) => {
      const href = safeHref(attribs.href);
      // An unusable link loses its attributes and is unwrapped by exclusiveFilter (text kept).
      // (Transforming to a disallowed tag instead would trip a sanitize-html close-tag bug.)
      if (!href) return { tagName: 'a', attribs: {} };
      const out: Record<string, string> = { href, rel: LINK_REL, target: '_blank' };
      const title = attribs.title?.trim();
      if (title) out.title = title.slice(0, 256);
      return { tagName: 'a', attribs: out };
    },
    th: (_tag, attribs) => ({ tagName: 'th', attribs: spanAttribs(attribs) }),
    td: (_tag, attribs) => ({ tagName: 'td', attribs: spanAttribs(attribs) }),
  },
  // Drop empty paragraphs / list items / headings (common ATS noise). frame.text includes children.
  exclusiveFilter: (frame) => {
    if (frame.tag === 'a' && !frame.attribs.href) {
      // sanitize-html skips the parent-text update for 'excludeTag'; without it the link text
      // would not count towards the parent, and `<p><a href="/x">Apply</a></p>` would be dropped
      // as an "empty" paragraph. The frame is already popped, so this updates the parent.
      (frame as sanitizeHtml.IFrame & { updateParentNodeText?: () => void }).updateParentNodeText?.();
      return 'excludeTag';
    }
    return EMPTY_DROPPABLE.has(frame.tag) && !frame.text.replace(/[\s\u00a0\u200b-\u200d\u2060\ufeff\u00ad]+/g, '');
  },
};

function spanAttribs(attribs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (attribs.colspan && SPAN_CELL.test(attribs.colspan.trim())) out.colspan = attribs.colspan.trim();
  if (attribs.rowspan && SPAN_CELL.test(attribs.rowspan.trim())) out.rowspan = attribs.rowspan.trim();
  return out;
}

/** Tidies whitespace/line breaks left over from removed containers. */
function tidy(html: string): string {
  return html
    .replace(/(?:<br \/>\s*){3,}/g, '<br /><br />')
    .replace(/^(?:\s*<br \/>)+/, '')
    .replace(/(?:<br \/>\s*)+$/, '')
    .replace(/(<(?:p|li|h[234]|td|th|blockquote)>)(?:\s*<br \/>)+/g, '$1')
    .replace(/(?:<br \/>\s*)+(<\/(?:p|li|h[234]|td|th|blockquote)>)/g, '$1')
    .replace(/(?:<br \/>\s*)+(<(?:p|ul|ol|h[234]|table|blockquote|pre)>)/g, '$1')
    .trim();
}

/**
 * Sanitises untrusted posting HTML for display. Safe on any input (null → '').
 * The result is idempotent: sanitising it again yields the same string.
 */
export function sanitizePostingHtml(html: string | null | undefined): string {
  if (typeof html !== 'string' || !html.trim()) return '';
  let input = html.length > MAX_HTML_INPUT ? html.slice(0, MAX_HTML_INPUT) : html;
  input = unescapeIfEncodedHtml(input);
  input = input.replace(BLOCK_CONTAINERS, (m) => `${m}<br>`);
  return tidy(sanitizeHtml(input, SANITIZE_OPTIONS));
}

const TEXT_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  preserveNewlines: false,
  decodeEntities: true,
  // Default includes U+200B, which would turn an invisible break inside a word into a space.
  whitespaceCharacters: ' \t\r\n\f',
  limits: { maxInputLength: MAX_HTML_INPUT, ellipsis: '…' },
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'h1', options: { uppercase: false } },
    { selector: 'h2', options: { uppercase: false } },
    { selector: 'h3', options: { uppercase: false } },
    { selector: 'h4', options: { uppercase: false } },
    { selector: 'h5', options: { uppercase: false } },
    { selector: 'h6', options: { uppercase: false } },
    { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false, maxColumnWidth: 200 } },
    { selector: 'ul', options: { itemPrefix: '- ' } },
    ...DROP_WITH_CONTENT.map((selector) => ({ selector, format: 'skip' as const })),
  ],
};

/**
 * HTML (or plain text) → readable plain text for matching, dedup hashes and AI input.
 * Scripts/styles/forms are skipped, entities decoded, links reduced to their text, whitespace
 * normalised (max one blank line), control and zero-width characters removed.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (typeof html !== 'string' || !html.trim()) return '';
  const input = unescapeIfEncodedHtml(html.length > MAX_HTML_INPUT ? html.slice(0, MAX_HTML_INPUT) : html);
  const text = convert(input, TEXT_OPTIONS);
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
