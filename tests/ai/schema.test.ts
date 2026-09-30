/** The model's answer is validated with zod; anything else is thrown away (spec §15.1). */
import { describe, expect, it } from 'vitest';
import {
  extractFactsItemSchema,
  summaryRedflagsItemSchema,
  suspiciousCheckItemSchema,
  TASK_SPECS,
  EXTRACT_FACTS_PARAMETERS,
} from '../../src/lib/ai/prompts';
import { parseBatchOutput } from '../../src/lib/ai/validate';

const good = {
  id: 'j1',
  visa_signals: [{ signal: 'offered', quote: 'We offer visa sponsorship' }],
  experience: { min_years: 3, max_years: 5, quote: '3-5 years of experience' },
  skills: [{ name: 'AWS', quote: 'experience with AWS' }],
  language: { requirement: 'english_ok', languages: ['en'], quote: 'Fluent English required' },
  remote: null,
  salary: { min: '60000', max: 75000, currency: 'eur', period: 'year', quote: '60.000 – 75.000 €' },
};

describe('extract_facts item schema', () => {
  it('accepts a well-formed item (numeric strings and lower-case currency are normalised)', () => {
    const r = extractFactsItemSchema.safeParse(good);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.salary?.min).toBe(60000);
      expect(r.data.salary?.currency).toBe('EUR');
    }
  });

  it('fills missing optional parts with empty values', () => {
    const r = extractFactsItemSchema.safeParse({ id: 'j2' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.visa_signals).toEqual([]);
      expect(r.data.skills).toEqual([]);
      expect(r.data.experience).toBeNull();
      expect(r.data.salary).toBeNull();
    }
  });

  it.each([
    ['unknown visa signal', { ...good, visa_signals: [{ signal: 'maybe', quote: 'We offer visa sponsorship' }] }],
    ['invented remote class', { ...good, remote: { class: 'anywhere', regions: [], quote: 'fully remote anywhere' } }],
    ['years out of range', { ...good, experience: { min_years: 99, max_years: null, quote: '99 years' } }],
    ['negative salary', { ...good, salary: { ...good.salary, min: -5 } }],
    ['bad currency', { ...good, salary: { ...good.salary, currency: 'euros' } }],
    ['bad period', { ...good, salary: { ...good.salary, period: 'fortnight' } }],
    ['no id', { ...good, id: '' }],
    ['a string instead of a list', { ...good, skills: 'AWS, Azure' }],
    ['a fact without a quote', { ...good, experience: { min_years: 3, max_years: 5 } }],
    ['bad language code', { ...good, language: { requirement: 'local_required', languages: ['german'], quote: 'Deutsch fließend' } }],
  ])('rejects %s', (_label, item) => {
    expect(extractFactsItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects junk of every kind', () => {
    for (const junk of [null, 42, 'text', [], { id: 5 }, { id: 'j1', visa_signals: [{}] }]) {
      expect(extractFactsItemSchema.safeParse(junk).success).toBe(false);
    }
  });
});

describe('summary / suspicious item schemas', () => {
  it('summary needs real text', () => {
    expect(summaryRedflagsItemSchema.safeParse({ id: 'j1', summary: 'short', summary_quotes: [] }).success).toBe(false);
    expect(summaryRedflagsItemSchema.safeParse({ id: 'j1', summary: 'A cloud security role in Berlin with AWS.', summary_quotes: ['cloud security'] }).success).toBe(true);
  });
  it('suspicious must be a boolean', () => {
    expect(suspiciousCheckItemSchema.safeParse({ id: 'j1', suspicious: 'yes' }).success).toBe(false);
    expect(suspiciousCheckItemSchema.safeParse({ id: 'j1', suspicious: false }).success).toBe(true);
  });
});

describe('parseBatchOutput', () => {
  const schema = TASK_SPECS.extract_facts.itemSchema;

  it('keeps only valid results for ids of the batch', () => {
    const r = parseBatchOutput(schema, { results: [good, { ...good, id: 'j9' }, { id: 'j2', skills: 'x' }, good] }, ['j1', 'j2']);
    expect([...r.items.keys()]).toEqual(['j1']);
    expect(r.unknownIds).toBe(1);
    expect(r.invalidItems).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.error).toBeNull();
  });

  it('whole answer unusable', () => {
    expect(parseBatchOutput(schema, null, ['j1']).error).toBe('no structured answer');
    expect(parseBatchOutput(schema, { answer: 'sure!' }, ['j1']).error).toMatch(/results/);
    expect(parseBatchOutput(schema, { results: [{ id: 'j1', experience: 'lots' }] }, ['j1']).error).toMatch(/failed validation/);
    expect(parseBatchOutput(schema, { results: [] }, ['j1']).error).toMatch(/no result/);
  });

  it('tolerates a bare array or a single item', () => {
    expect(parseBatchOutput(schema, [good], ['j1']).items.size).toBe(1);
    expect(parseBatchOutput(schema, good, ['j1']).items.size).toBe(1);
  });

  it('a flood of results is capped', () => {
    const flood = Array.from({ length: 500 }, (_, i) => ({ ...good, id: `x${i}` }));
    const r = parseBatchOutput(schema, { results: flood }, ['j1']);
    expect(r.unknownIds + r.invalidItems).toBe(500);
  });

  it('the JSON schema sent as tool parameters forbids extra properties', () => {
    const results = (EXTRACT_FACTS_PARAMETERS.properties as Record<string, { items: { additionalProperties: boolean } }>).results;
    expect(results.items.additionalProperties).toBe(false);
  });
});
