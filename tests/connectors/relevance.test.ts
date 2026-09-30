import { describe, expect, it } from 'vitest';
import { prefilterDecision, relevanceOf } from '../../src/lib/connectors/relevance';

describe('relevance pre-filter', () => {
  it.each([
    ['Senior Security Engineer', 'security'],
    ['Cloud Security Architect (w/m/d)', 'security'],
    ['DevSecOps Engineer', 'security'],
    ['Penetration Tester', 'security'],
    ['Site Reliability Engineer', 'security'],
    ['Informationssicherheitsbeauftragter (m/w/d)', 'security'],
    ['IT-säkerhetstekniker', 'security'],
    ['Rådgiver informasjonssikkerhet', 'security'],
    ['Ingeniero de ciberseguridad', 'security'],
    ['Full-Stack Entwickler Node.js / Next.js (m/w/d)', 'fullstack'],
    ['Senior .NET Full-stack Developer', 'fullstack'],
    ['TypeScript Engineer', 'fullstack'],
  ])('%s → %s', (title, bucket) => {
    expect(relevanceOf(title)).toBe(bucket);
  });

  it.each([
    'Security Guard (Night Shift)',
    'Sicherheitsmitarbeiter im Objektschutz',
    'Väktare till Securitas',
    'Sikkerhetspost A1 Sykepleier',
    'Social Security Claims Specialist',
    'Physical Security Manager',
    'Brandskyddstekniker',
    'Kitchen Staff Needed',
    'Node Manager Retail',
    'Renholdsmedarbeider',
  ])('%s → not relevant', (title) => {
    expect(relevanceOf(title)).toBeNull();
  });

  it('tags can make a vague title relevant', () => {
    expect(relevanceOf('Engineer II', ['Kubernetes'])).toBe('security');
    expect(relevanceOf('Engineer II', ['Marketing'])).toBeNull();
    expect(relevanceOf('Engineer II', ['Security'])).toBe('security');
    expect(relevanceOf('Engineer II', [' Cloud Security '])).toBe('security');
  });

  it('a department-style tag that merely contains "security" does not make a title relevant', () => {
    // Live Arbeitnow items (2026-09-30): tags are often department names.
    expect(relevanceOf('Senior Mechanical Engineer', ['Quantum Platform - Network and Security'])).toBeNull();
    expect(relevanceOf('Senior R&D Scientist', ['Quantum Platform - Network and Security'])).toBeNull();
    expect(relevanceOf('Senior Manager (Safety)', ['National Security & Safety'])).toBeNull();
    expect(relevanceOf('Senior Cryptography Engineer', ['Quantum Platform - Network and Security'])).toBe('security');
    expect(relevanceOf('Staff DevSecOps Engineer', ['Quantum Platform - Network and Security'])).toBe('security');
    expect(relevanceOf('Security Engineer II', ['Platform'])).toBe('security');
  });

  it('decision: disabled keeps all, keywords extend, empty titles pass to validation', () => {
    expect(prefilterDecision('Baker', [], { enabled: false })).toEqual({ keep: true, reason: 'prefilter_disabled' });
    expect(prefilterDecision('Baker', [], { keywords: ['bak'] })).toEqual({ keep: true, reason: 'keyword' });
    expect(prefilterDecision('Baker', [], { keywords: ['a+b(c'] })).toEqual({ keep: false, reason: 'not_relevant' });
    expect(prefilterDecision('  ', [])).toEqual({ keep: true, reason: 'no_title' });
  });
});
