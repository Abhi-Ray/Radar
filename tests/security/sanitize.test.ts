import { describe, expect, it } from 'vitest';
import {
  htmlToPlainText,
  LINK_REL,
  safeHref,
  sanitizePostingHtml,
  unescapeIfEncodedHtml,
} from '../../src/lib/security/sanitize';

/** Nothing executable may survive, in any casing. */
function assertInert(html: string) {
  const lower = html.toLowerCase();
  for (const bad of ['<script', '<style', '<iframe', '<svg', '<math', '<img', '<object', '<embed', '<form', '<input', '<link', '<meta', '<base']) {
    expect(lower).not.toContain(bad);
  }
  expect(lower).not.toMatch(/\son[a-z]+\s*=/);
  expect(lower).not.toContain('javascript:');
  expect(lower).not.toContain('vbscript:');
  expect(lower).not.toContain('data:');
  expect(lower).not.toContain('style=');
  expect(lower).not.toContain('srcdoc');
}

describe('sanitizePostingHtml', () => {
  it('keeps the formatting allow-list', () => {
    const html =
      '<h2>Role</h2><p>We <strong>need</strong> <em>you</em>.</p><ul><li>AWS</li><li>K8s</li></ul><ol><li>one</li></ol>' +
      '<blockquote>quote</blockquote><pre><code>x = 1</code></pre><table><thead><tr><th colspan="2">A</th></tr></thead><tbody><tr><td rowspan="1">b</td><td>c</td></tr></tbody></table>';
    expect(sanitizePostingHtml(html)).toBe(html);
  });

  it('drops scripts, styles, event handlers, iframes, svg and forms (with their content)', () => {
    const vectors = [
      '<script>alert(1)</script><p>ok</p>',
      '<SCRIPT SRC=//evil/x.js></SCRIPT><p>ok</p>',
      '<p onclick="alert(1)" style="color:red" class="x" id="y">ok</p>',
      '<img src=x onerror=alert(1)><p>ok</p>',
      '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">x</a></svg><p>ok</p>',
      '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
      '<iframe src="https://evil" srcdoc="<script>alert(1)</script>"></iframe><p>ok</p>',
      '<object data="data:text/html,<script>alert(1)</script>"></object><embed src="x"><p>ok</p>',
      '<form action="https://evil"><input name=a><button>go</button></form><p>ok</p>',
      '<style>body{background:url(javascript:alert(1))}</style><p>ok</p>',
      '<link rel=stylesheet href=//evil><meta http-equiv="refresh" content="0;url=javascript:alert(1)"><base href="//evil/"><p>ok</p>',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript><p>ok</p>',
      '<template><script>alert(1)</script></template><p>ok</p>',
      '<p>ok<!-- <script>alert(1)</script> --></p>',
      '<div><p>ok</p></div><details open ontoggle=alert(1)><summary>s</summary></details>',
      '<a href="javascript:alert(1)">click</a>',
      '<a href="  JaVaScRiPt:alert(1)">click</a>',
      '<a href="java\tscript:alert(1)">click</a>',
      '<a href="java&#x09;script:alert(1)">click</a>',
      '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">click</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
      '<a href="vbscript:msgbox(1)">click</a>',
    ];
    for (const v of vectors) {
      const out = sanitizePostingHtml(v);
      assertInert(out);
    }
    expect(sanitizePostingHtml('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizePostingHtml('<p onclick="alert(1)" style="color:red" class="x">ok</p>')).toBe('<p>ok</p>');
  });

  it('unwraps unusable links but keeps their text', () => {
    expect(sanitizePostingHtml('<p><a href="javascript:alert(1)">click</a> here</p>')).toBe('<p>click here</p>');
    expect(sanitizePostingHtml('<p><a href="/relative">rel</a></p>')).toBe('<p>rel</p>');
    expect(sanitizePostingHtml('<p><a href="//evil.example/x">proto-relative</a></p>')).toBe('<p>proto-relative</p>');
    expect(sanitizePostingHtml('<p><a href="https://user:pw@evil.example/">creds</a></p>')).toBe('<p>creds</p>');
    expect(sanitizePostingHtml('<p><a>bare</a></p>')).toBe('<p>bare</p>');
    // Regression: a paragraph whose only content is an unwrapped link must not count as empty.
    expect(sanitizePostingHtml('<ul><li><a href="/apply">Apply <b>now</b></a></li></ul>')).toBe('<ul><li>Apply <b>now</b></li></ul>');
  });

  it('hardens good links', () => {
    const out = sanitizePostingHtml('<a href="https://example.com/apply?x=1&y=2" title="Apply" target="_self" rel="opener" onclick="x()">Apply</a>');
    expect(out).toBe(`<a href="https://example.com/apply?x=1&amp;y=2" rel="${LINK_REL}" target="_blank" title="Apply">Apply</a>`);
    expect(sanitizePostingHtml('<a href="mailto:jobs@example.com">mail</a>')).toContain('href="mailto:jobs@example.com"');
  });

  it('normalises headings and removes empty noise', () => {
    expect(sanitizePostingHtml('<h1>Title</h1><h5>small</h5><h6>smaller</h6>')).toBe('<h2>Title</h2><h4>small</h4><h4>smaller</h4>');
    expect(sanitizePostingHtml('<p></p><p>&nbsp;</p><li> </li><p>text</p>')).toBe('<p>text</p>');
  });

  it('keeps text of unknown containers apart', () => {
    expect(sanitizePostingHtml('<div>One</div><div>Two</div><section>Three</section>')).toBe('One<br />Two<br />Three');
    expect(sanitizePostingHtml('<span>a</span><font color=red>b</font>')).toBe('ab');
  });

  it('validates table spans', () => {
    expect(sanitizePostingHtml('<table><tr><td colspan="999" rowspan="x">a</td></tr></table>')).toBe('<table><tr><td>a</td></tr></table>');
  });

  it('decodes HTML-escaped HTML once, then sanitises it', () => {
    const escaped = '&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;';
    expect(sanitizePostingHtml(escaped)).toBe('<p>Hello &amp; welcome</p>');
    // Plain text mentioning a tag is not decoded when real markup is present.
    expect(unescapeIfEncodedHtml('<p>use &lt;div&gt;</p>')).toBe('<p>use &lt;div&gt;</p>');
    expect(unescapeIfEncodedHtml('Tom &amp; Jerry')).toBe('Tom &amp; Jerry');
  });

  it('is idempotent and safe on empty input', () => {
    const samples = [
      '<div><h1>Job</h1><p>Hi <a href="https://x.example">link</a></p><ul><li>a</li></ul></div><div>tail</div>',
      '<p>a<br><br><br><br>b</p>',
      '&lt;p&gt;escaped&lt;/p&gt;',
    ];
    for (const s of samples) {
      const once = sanitizePostingHtml(s);
      expect(sanitizePostingHtml(once)).toBe(once);
    }
    expect(sanitizePostingHtml('')).toBe('');
    expect(sanitizePostingHtml('   ')).toBe('');
    expect(sanitizePostingHtml(null)).toBe('');
    expect(sanitizePostingHtml(undefined)).toBe('');
  });

  it('bounds huge input', () => {
    const huge = `<p>${'a'.repeat(2_000_000)}</p>`;
    const out = sanitizePostingHtml(huge);
    expect(out.length).toBeLessThanOrEqual(1_000_010);
  });
});

describe('safeHref', () => {
  it('accepts absolute http(s)/mailto only', () => {
    expect(safeHref('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(safeHref(' http://example.com ')).toBe('http://example.com/');
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:x', 'data:text/html,x', 'file:///etc/passwd', 'ftp://x.example', '/rel', '//x.example', 'https://u:p@x.example', 'http://', '', null, undefined, `https://x.example/${'a'.repeat(3000)}`]) {
      expect(safeHref(bad as string)).toBeNull();
    }
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
    expect(safeHref('\u0000javascript:alert(1)')).toBeNull();
  });
});

describe('htmlToPlainText', () => {
  it('produces readable text without markup, scripts or link targets', () => {
    const html =
      '<h2>About</h2><p>We build <strong>secure</strong> clouds.</p><script>var secret=1</script><style>.x{}</style>' +
      '<ul><li>AWS</li><li>Terraform</li></ul><p>Apply <a href="https://example.com/apply">here</a>.</p>';
    const text = htmlToPlainText(html);
    expect(text).toContain('About');
    expect(text).toContain('We build secure clouds.');
    expect(text).toContain('- AWS');
    expect(text).toContain('- Terraform');
    expect(text).toContain('Apply here.');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('https://example.com');
    expect(text).not.toContain('<');
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('decodes entities and strips zero-width/control characters', () => {
    expect(htmlToPlainText('<p>Caf&eacute; &amp; b\u200bar\u0007&nbsp;x Kuber&#8203;netes Soft\u00adware</p>')).toBe('Café & bar x Kubernetes Software');
    expect(htmlToPlainText('plain text\r\nline 2')).toBe('plain text line 2');
    expect(htmlToPlainText('&lt;p&gt;escaped&lt;/p&gt;')).toBe('escaped');
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText(null)).toBe('');
  });

  it('keeps table cell text', () => {
    const text = htmlToPlainText('<table><tr><th>Level</th><th>Salary</th></tr><tr><td>Senior</td><td>90k</td></tr></table>');
    expect(text).toContain('Level');
    expect(text).toContain('Senior');
    expect(text).toContain('90k');
  });
});
