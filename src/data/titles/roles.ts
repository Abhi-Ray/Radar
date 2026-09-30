/**
 * Canonical role keys emitted by the title mapper (spec §3). The family of a role is not fixed
 * here: it comes from the profile's `targetRoles` lists (settings), so moving a role between
 * primary / secondary / fallback needs no code change. `defaultFamily` mirrors
 * DEFAULT_TARGET_ROLES and is used for display only.
 */
import type { RoleFamily } from '../../lib/contracts/jobs';

export const ROLE_KEYS = [
  'cloud_security_engineer',
  'devsecops_engineer',
  'appsec_engineer',
  'product_security_engineer',
  'cloud_security_analyst',
  'security_engineer_cloud',
  'grc_cloud',
  'cloud_engineer_security',
  'fullstack_developer',
  'nextjs_developer',
  'node_developer',
  'other_security',
  'other',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDef {
  key: RoleKey;
  label: string;
  defaultFamily: RoleFamily;
  description: string;
}

export const ROLES: readonly RoleDef[] = [
  { key: 'cloud_security_engineer', label: 'Cloud Security Engineer', defaultFamily: 'primary', description: 'Engineer whose main subject is securing cloud platforms (AWS/Azure/GCP, containers, cloud infrastructure).' },
  { key: 'devsecops_engineer', label: 'DevSecOps Engineer', defaultFamily: 'primary', description: 'Security built into CI/CD, pipelines, supply chain and automation.' },
  { key: 'appsec_engineer', label: 'Application Security Engineer', defaultFamily: 'primary', description: 'Application / software security: secure SDLC, code review, SAST/DAST.' },
  { key: 'product_security_engineer', label: 'Product Security Engineer', defaultFamily: 'primary', description: 'Security of a company’s own product(s).' },
  { key: 'cloud_security_analyst', label: 'Cloud Security Analyst', defaultFamily: 'secondary', description: 'Analyst role focused on cloud security posture, monitoring and findings.' },
  { key: 'security_engineer_cloud', label: 'Security Engineer (cloud)', defaultFamily: 'secondary', description: 'General security engineer, with cloud as a qualifier or implied.' },
  { key: 'grc_cloud', label: 'GRC / Compliance (cloud)', defaultFamily: 'secondary', description: 'Governance, risk, compliance and audit roles in IT/cloud security.' },
  { key: 'cloud_engineer_security', label: 'Cloud Engineer (security focus)', defaultFamily: 'secondary', description: 'Cloud / platform engineer with security named as a focus.' },
  { key: 'fullstack_developer', label: 'Full-stack Developer', defaultFamily: 'fallback', description: 'Full-stack web developer.' },
  { key: 'nextjs_developer', label: 'Next.js Developer', defaultFamily: 'fallback', description: 'Next.js / React developer.' },
  { key: 'node_developer', label: 'Node.js Developer', defaultFamily: 'fallback', description: 'Node.js back-end developer.' },
  { key: 'other_security', label: 'Other security role', defaultFamily: 'other', description: 'Security role outside the target set (SOC, pentest, network security, …).' },
  { key: 'other', label: 'Other role', defaultFamily: 'other', description: 'Recognised role that is not a target (other IT, sales, safety, guarding, …).' },
];

export const ROLE_BY_KEY: ReadonlyMap<string, RoleDef> = new Map(ROLES.map((r) => [r.key, r]));

export function isRoleKey(s: string): s is RoleKey {
  return ROLE_BY_KEY.has(s);
}
