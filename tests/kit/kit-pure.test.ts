/**
 * Application kit, pure parts: the safe Markdown reader, fill-in templates and the per-job
 * tailoring checklist (skills to mirror, "why this company" draft, suggested resume track).
 */
import { describe, expect, it } from 'vitest';
import { markdownToPlain, parseInline, parseMarkdown, safeLinkHref, wordCount, type Block } from '../../src/components/kit/markdown';
import {
  fieldLines,
  fieldsToJson,
  fillTemplate,
  humanizeKey,
  parseFieldLines,
  parseFieldsJson,
  prefillValues,
  slotKeys,
  templateFields,
} from '../../src/components/kit/template';
import { mentions, parseSkillsFact, planSkills, skillKey, suggestTrack, tailoringSteps, whyCompanyDraft } from '../../src/components/kit/tailoring';

describe('markdown blocks', () => {
  it('reads headings, paragraphs with line breaks, rules and fenced code', () => {
    const blocks = parseMarkdown('# Abhishek Ray\nCloud security engineer\nPune, India\n\n---\n\n```bash\n<b>not html</b>\n```');
    expect(blocks.map((b) => b.t)).toEqual(['heading', 'paragraph', 'hr', 'code']);
    expect(blocks[1]).toEqual({
      t: 'paragraph',
      c: [{ t: 'text', v: 'Cloud security engineer' }, { t: 'br' }, { t: 'text', v: 'Pune, India' }],
    });
    expect(blocks[3]).toEqual({ t: 'code', lang: 'bash', v: '<b>not html</b>' });
  });

  it('reads bullet, numbered and task lists with nesting', () => {
    const blocks = parseMarkdown('- AWS\n  - IAM\n  - KMS\n- Azure\n\n3. first\n4. second\n\n- [x] Mirror skills\n- [ ] Why company');
    const [ul, ol, tasks] = blocks as Extract<Block, { t: 'list' }>[];
    expect(ul.ordered).toBe(false);
    expect(ul.items).toHaveLength(2);
    expect(ul.items[0].blocks.map((b) => b.t)).toEqual(['paragraph', 'list']);
    expect(ol).toMatchObject({ ordered: true, start: 3 });
    expect(tasks.items.map((i) => i.task)).toEqual([true, false]);
    expect(markdownToPlain(blocks)).toContain('- AWS\n  - IAM');
  });

  it('keeps raw HTML as text and never builds unsafe links', () => {
    const blocks = parseMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.com/a) [mail](mailto:me@example.com)');
    const para = blocks[0] as Extract<Block, { t: 'paragraph' }>;
    const links = para.c.filter((n) => n.t === 'link');
    expect(links.map((l) => (l as { href: string | null }).href)).toEqual([null, 'https://example.com/a', 'mailto:me@example.com']);
    expect(markdownToPlain(blocks)).toContain('<script>alert(1)</script>');
    expect(safeLinkHref('data:text/html,hi')).toBeNull();
    expect(safeLinkHref('/relative')).toBeNull();
    expect(safeLinkHref('mailto:not-an-address')).toBeNull();
  });

  it('blockquotes nest and depth is capped', () => {
    const deep = `${'>'.repeat(20)} too deep`;
    const blocks = parseMarkdown(deep);
    expect(blocks[0].t).toBe('quote');
    expect(markdownToPlain(blocks)).toContain('too deep');
  });
});

describe('markdown inline', () => {
  it('strong, em, code, escapes and underscores inside words', () => {
    expect(parseInline('**Terraform** and *IaC*', 0)).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'Terraform' }] },
      { t: 'text', v: ' and ' },
      { t: 'em', c: [{ t: 'text', v: 'IaC' }] },
    ]);
    expect(parseInline('snake_case_name stays', 0)).toEqual([{ t: 'text', v: 'snake_case_name stays' }]);
    expect(parseInline('_word_', 0)).toEqual([{ t: 'em', c: [{ t: 'text', v: 'word' }] }]);
    expect(parseInline('`a*b*c` \\*literal\\*', 0)).toEqual([{ t: 'code', v: 'a*b*c' }, { t: 'text', v: ' *literal*' }]);
    expect(parseInline('2 * 3 * 4', 0)).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
  });

  it('slots, autolinks and bare URLs', () => {
    expect(parseInline('Dear {{ hiring_manager }},', 0)).toEqual([{ t: 'text', v: 'Dear ' }, { t: 'slot', key: 'hiring_manager' }, { t: 'text', v: ',' }]);
    expect(parseInline('{{ not a slot }}', 0)).toEqual([{ t: 'text', v: '{{ not a slot }}' }]);
    const bare = parseInline('see https://github.com/abhi. Thanks', 0);
    expect(bare[1]).toEqual({ t: 'link', href: 'https://github.com/abhi', c: [{ t: 'text', v: 'https://github.com/abhi' }] });
    expect(parseInline('<https://x.example/p>', 0)[0]).toMatchObject({ t: 'link', href: 'https://x.example/p' });
  });

  it('plain text for copying fills slots and spells out links', () => {
    const md = 'Hi {{name}},\n\nI saw the [role](https://jobs.example/1) at **{{company}}**.';
    expect(markdownToPlain(md, { slots: { name: 'Priya', company: '' } })).toBe('Hi Priya,\n\nI saw the role (https://jobs.example/1) at {{company}}.');
    expect(wordCount('# Title\nTwo words')).toBe(3);
  });
});

describe('templates', () => {
  const body = 'Dear {{hiring_manager}},\nI want to join {{company}} as {{role}}. {{company}} again.';

  it('lists declared fields first, then the rest of the slots', () => {
    expect(slotKeys(body)).toEqual(['hiring_manager', 'company', 'role']);
    const fields = templateFields(body, [{ key: 'company', label: 'Company', hint: 'Legal or brand name' }, 'unused_field', { key: 'bad key' }, 42]);
    expect(fields.map((f) => [f.key, f.label, f.declared, f.used])).toEqual([
      ['company', 'Company', true, true],
      ['unused_field', 'Unused field', true, false],
      ['hiring_manager', 'Hiring manager', false, true],
      ['role', 'Role', false, true],
    ]);
    expect(parseFieldsJson('nope')).toEqual([]);
  });

  it('fills what is given and reports what is missing', () => {
    expect(fillTemplate(body, { company: 'Initech', role: ' ' })).toEqual({
      text: 'Dear {{hiring_manager}},\nI want to join Initech as {{role}}. Initech again.',
      missing: ['hiring_manager', 'role'],
    });
  });

  it('round-trips the field editor lines', () => {
    const { fields, bad } = parseFieldLines('company | Company | Brand name\n{{role}}\n\n9bad\nhiringManager | Hiring manager');
    expect(bad).toEqual(['9bad']);
    const json = fieldsToJson(fields);
    expect(json).toEqual([{ key: 'company', hint: 'Brand name' }, { key: 'role' }, { key: 'hiringManager' }]);
    expect(fieldLines(json)).toBe('company | Company | Brand name\nrole\nhiringManager');
    expect(humanizeKey('hiringManager')).toBe('Hiring manager');
  });

  it('prefills common slots from the job', () => {
    const fields = templateFields('{{company}} {{job_title}} {{city}} {{key_skills}} {{my_name}}', null);
    expect(prefillValues(fields, { company: 'Initech', title: 'AppSec Engineer', city: 'Berlin', skills: ['AWS', 'IAM'] })).toEqual({
      company: 'Initech',
      job_title: 'AppSec Engineer',
      city: 'Berlin',
      key_skills: 'AWS, IAM',
    });
  });
});

describe('tailoring', () => {
  const profile = ['AWS', 'IAM', 'Terraform', 'Kubernetes', 'Node.js', 'Python'];

  it('uses the skills fact when present', () => {
    const plan = planSkills({ profileSkills: profile, fact: { matched: ['AWS', 'Kubernetes'], found: ['AWS', 'Kubernetes', 'Splunk'] }, text: 'ignored' });
    expect(plan).toEqual({ mirror: ['AWS', 'Kubernetes'], gaps: ['Splunk'], unused: ['IAM', 'Terraform', 'Node.js', 'Python'], basis: 'fact' });
  });

  it('falls back to scanning the posting with word boundaries and aliases', () => {
    const text = 'You know Amazon Web Services, k8s and NodeJS. Laws and javascript are not skills here. Splunk is a plus.';
    const plan = planSkills({ profileSkills: profile, fact: null, text });
    expect(plan.basis).toBe('text');
    expect(plan.mirror).toEqual(['AWS', 'Kubernetes', 'Node.js']);
    expect(plan.gaps).toEqual(['JavaScript', 'Splunk']);
    expect(mentions('java developer', 'JavaScript')).toBe(false);
    expect(mentions('laws', 'AWS')).toBe(false);
    expect(planSkills({ profileSkills: profile, fact: null, text: null }).basis).toBe('none');
  });

  it('reads the fact leniently and keys skills like the backend', () => {
    expect(parseSkillsFact({ matched: ['AWS', 3, ' '], found: 'x' })).toEqual({ matched: ['AWS'], found: undefined });
    expect(parseSkillsFact(null)).toBeNull();
    expect(skillKey('Node.js')).toBe(skillKey('node js'));
  });

  it('drafts the why-company line from stored facts only', () => {
    expect(whyCompanyDraft({ company: 'Initech', title: 'AppSec Engineer', city: 'Berlin', country: 'Germany', type: 'scaleup', sizeBand: '51-250', mirror: ['AWS', 'IAM', 'Terraform'] })).toBe(
      'Initech, a scale-up of 51-250 people, is hiring an AppSec Engineer in Berlin, Germany — the role leans on AWS and IAM, which is where my work is.',
    );
    expect(whyCompanyDraft({ company: 'Globex' })).toBe('Globex.');
    expect(whyCompanyDraft({ company: 'Globex', sponsor: 'confirmed', sponsorRegister: 'UK Home Office' })).toContain('UK Home Office sponsor record');
  });

  it('suggests a resume track from the role', () => {
    expect(suggestTrack('cloud_security_engineer')).toBe('cloud_security');
    expect(suggestTrack('appsec_engineer')).toBe('devsecops');
    expect(suggestTrack('nextjs_developer')).toBe('fullstack');
    expect(suggestTrack(null, 'Senior Full-Stack Developer')).toBe('fullstack');
    expect(suggestTrack(null, 'Barista')).toBe('other');
  });

  it('builds the checklist with the job details', () => {
    const plan = { mirror: ['AWS'], gaps: ['Splunk'], unused: [], basis: 'fact' as const };
    const steps = tailoringSteps({ plan, title: 'Cloud Security Engineer', track: 'cloud_security', trackLabel: 'Cloud security', countryName: 'Germany', hasConventions: false, visaRoute: 'EU Blue Card' });
    expect(steps.map((s) => s.id)).toEqual(['resume', 'headline', 'mirror', 'proof', 'gaps', 'why', 'conventions', 'visa', 'log']);
    expect(steps.find((s) => s.id === 'conventions')?.detail).toMatch(/No conventions/);
  });
});
