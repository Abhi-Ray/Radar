/**
 * Skill matching (pure): which of my profile skills a posting mentions (`matched`) and which known
 * tech/security skills it mentions at all (`found`). Word-boundary matching on lowercased text
 * with a small alias table ("k8s" → Kubernetes, "Amazon Web Services" → AWS, "DSGVO" → GDPR).
 */
import type { SkillsValue } from '../../contracts/jobs';
import type { Fact } from '../../contracts/provenance';

export const SKILLS_LOGIC_VERSION = 'skills@2026-09-30.1';

/** Canonical skill → extra spellings (the canonical name itself always matches). */
export const SKILL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  AWS: ['amazon web services'],
  Azure: ['microsoft azure'],
  GCP: ['google cloud', 'google cloud platform'],
  IAM: ['identity and access management', 'identity & access management'],
  Kubernetes: ['k8s'],
  'CI/CD': ['ci-cd', 'cicd', 'ci / cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  SAST: ['static application security testing'],
  DAST: ['dynamic application security testing'],
  SIEM: [],
  GDPR: ['dsgvo', 'rgpd', 'avg (gdpr)'],
  'ISO 27001': ['iso/iec 27001', 'iso27001', 'iso-27001', 'iso 27k'],
  'SOC 2': ['soc2', 'soc ii', 'soc-2'],
  'Node.js': ['nodejs', 'node js'],
  'Next.js': ['nextjs', 'next js'],
  JavaScript: ['ecmascript'],
  TypeScript: [],
  Python: [],
  Linux: [],
  Terraform: [],
  Docker: [],
  Ansible: [],
  Helm: [],
  Vault: ['hashicorp vault'],
  Splunk: [],
  Okta: [],
  OWASP: [],
  NIST: ['nist csf', 'nist 800-53'],
  'PCI DSS': ['pci-dss', 'pci'],
  CSPM: ['cloud security posture management'],
  CNAPP: [],
  'Zero Trust': ['zero-trust'],
  'GitHub Actions': [],
  'GitLab CI': ['gitlab-ci'],
  Jenkins: [],
  React: ['react.js', 'reactjs'],
  Java: [],
  SOAR: [],
  EDR: [],
  'Threat Modeling': ['threat modelling'],
  'Penetration Testing': ['pentesting', 'pen testing', 'penetration test'],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const cache = new Map<string, RegExp>();

/** Case-insensitive whole-token matcher for one spelling ("node.js" must not match "node.jsx"). */
function matcher(spelling: string): RegExp {
  const key = normalise(spelling);
  let re = cache.get(key);
  if (!re) {
    // Boundaries: not preceded/followed by a letter or digit ("aws" ≠ "laws", "java" ≠ "javascript").
    re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(key).replace(/ /g, '\\s+')}(?![a-z0-9])`, 'i');
    if (cache.size > 2000) cache.clear();
    cache.set(key, re);
  }
  return re;
}

function spellingsFor(skill: string): string[] {
  const exact = SKILL_ALIASES[skill];
  if (exact) return [skill, ...exact];
  const k = Object.keys(SKILL_ALIASES).find((s) => normalise(s) === normalise(skill));
  return k ? [skill, k, ...SKILL_ALIASES[k]] : [skill];
}

export function mentionsSkill(text: string, skill: string): boolean {
  return spellingsFor(skill).some((s) => s.trim().length > 0 && matcher(s).test(text));
}

/**
 * `matched` = profile skills the posting mentions (in profile order); `found` = every known skill
 * (profile ∪ built-in table) the posting mentions, sorted.
 */
export function matchSkills(text: string, profileSkills: readonly string[]): SkillsValue {
  const body = normalise(text).slice(0, 200_000);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const s of profileSkills) {
    const k = normalise(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (mentionsSkill(body, s)) matched.push(s);
  }
  const found = new Set<string>(matched);
  for (const s of Object.keys(SKILL_ALIASES)) {
    if ([...found].some((f) => normalise(f) === normalise(s))) continue;
    if (mentionsSkill(body, s)) found.add(s);
  }
  return { matched, found: [...found].sort((a, b) => a.localeCompare(b)) };
}

export function skillsFact(text: string, title: string, profileSkills: readonly string[], now: Date): Fact<SkillsValue> {
  const value = matchSkills(`${title}\n${text}`, profileSkills);
  return {
    value,
    evidence: value.found.length ? `Mentions: ${value.found.join(', ')}`.slice(0, 1000) : null,
    source: 'posting text',
    method: 'rule',
    confidence: 'medium',
    checkedAt: now,
    logicVersion: SKILLS_LOGIC_VERSION,
  };
}
