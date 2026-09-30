/**
 * Cheap relevance pre-filter for broad feeds (aggregators, national job feeds): keeps security /
 * cloud / DevSecOps / AppSec roles and, as the fallback track, full-stack / Next.js / Node roles.
 * Works on the title plus tags/categories only (descriptions mention "cloud" everywhere).
 * Multilingual for the countries the government feeds cover (DE, SE, NO) plus FR/ES/IT/NL.
 * The pipeline counts every item this drops in the source run stats.
 */
import type { PrefilterResult } from './types';

export const RELEVANCE_VERSION = 'relevance@2026-09-30.2';

/** The bare word "security": relevant in a title, too vague in a department-style tag. */
const BARE_SECURITY_RE = /\bsecurity\b/i;

/**
 * A tag that is itself a security category ("Security", "IT Security", "Cloud Security"), as
 * opposed to a department name that merely contains the word ("Quantum Platform - Network and
 * Security", "National Security & Safety").
 */
const SECURITY_TAG_RE = /^(?:(?:it|information|cyber|cloud|application|network|product|infrastructure|data)[\s-])?security(?:[\s-](?:engineering|operations))?$/i;

const SECURITY_RES: readonly RegExp[] = [
  /\b(?:cyber[\s-]?security|cybersec|infosec|appsec|devsecops|secops|netsec|sec[\s-]?eng)/i,
  /\b(?:penetration test|pen[\s-]?test|red[\s-]team|blue[\s-]team|purple[\s-]team|threat (?:hunt|intel|detect)|incident respon|vulnerabilit|soc analyst|security operations|siem|iam engineer|identity (?:and|&) access|zero[\s-]trust|ciso|grc\b|cryptograph)/i,
  // Cloud / platform / infrastructure track.
  /\b(?:cloud (?:engineer|architect|platform|infrastructure|ops|operations|developer|consultant|specialist)|cloud[\s-]native|aws|azure|gcp|google cloud|kubernetes|k8s|devops|site reliability|\bsre\b|platform engineer|infrastructure engineer)/i,
  // German
  /(?:it[\s-]?sicherheit|informationssicherheit|cybersicherheit|cyber[\s-]sicherheit|sicherheitsarchitekt|security[\s-]?(?:analyst|engineer|berater|consultant|spezialist)|pentester|informationssicherheitsbeauftragte)/i,
  // Swedish
  /(?:it[\s-]?säkerhet|informationssäkerhet|cybersäkerhet|säkerhetsarkitekt|säkerhetstekniker|säkerhetsspecialist inom it)/i,
  // Norwegian / Danish
  /(?:it[\s-]?sikkerhet|informasjonssikkerhet|cybersikkerhet|datasikkerhet|sikkerhetsarkitekt|it[\s-]?sikkerhed|informationssikkerhed)/i,
  // French / Spanish / Italian / Dutch
  /(?:cybersécurité|sécurité (?:informatique|des systèmes|cloud)|ciberseguridad|seguridad (?:informática|de la información)|sicurezza informatica|informatiebeveiliging|cybersecurity)/i,
];

const FULLSTACK_RES: readonly RegExp[] = [
  /\bfull[\s-]?stack/i,
  /\bnext\.?js\b/i,
  /\bnode(?:\.?js)?\b(?![\s-]?(?:manager|technician))/i,
  /\btypescript\b/i,
  /(?:fullstack[\s-]?(?:utvikler|udvikler|utvecklare|entwickler|ontwikkelaar)|full[\s-]stack[\s-]entwickler)/i,
];

/** Titles that contain a relevant word but are clearly not the target (physical security etc.). */
const EXCLUDE_RES: readonly RegExp[] = [
  /\bsecurity (?:guard|officer \(?(?:site|night|patrol)|patrol)|\bsocial security\b|\bphysical security\b|\bsecurity (?:and|&) safety\b|\bsafety (?:and|&) security\b/i,
  /(?:sicherheitsdienst|wachschutz|wachmann|objektschutz|sicherheitsmitarbeiter|fachkraft für arbeitssicherheit|väktare|ordningsvakt|vekter|sikkerhetsvakt|elsikkerhet|sikkerhetspost|fysisk (?:säkerhet|sikkerhet|sikkerhed)|brandskydd|brannsikkerhet)/i,
];

export type RelevanceBucket = 'security' | 'fullstack';

/** Relevance bucket of a title (+ tags/categories), or null when neither track matches. */
export function relevanceOf(title: string, tags: readonly string[] = []): RelevanceBucket | null {
  const t = title.normalize('NFC');
  if (EXCLUDE_RES.some((re) => re.test(t))) return null;
  const cleanTags = tags.map((x) => x.normalize('NFC').trim());
  const hay = [t, ...cleanTags].join(' | ');
  if (BARE_SECURITY_RE.test(t) || cleanTags.some((x) => SECURITY_TAG_RE.test(x))) return 'security';
  if (SECURITY_RES.some((re) => re.test(hay))) return 'security';
  if (FULLSTACK_RES.some((re) => re.test(hay))) return 'fullstack';
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pre-filter decision. `keywords` (from the source config) are extra case-insensitive words that
 * also keep an item; `enabled: false` keeps everything.
 */
export function prefilterDecision(
  title: string,
  tags: readonly string[],
  opts: { enabled?: boolean; keywords?: readonly string[] } = {},
): PrefilterResult {
  if (opts.enabled === false) return { keep: true, reason: 'prefilter_disabled' };
  if (!title.trim()) return { keep: true, reason: 'no_title' }; // let validation dead-letter it
  const bucket = relevanceOf(title, tags);
  if (bucket) return { keep: true, reason: bucket };
  const kw = (opts.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (kw.length) {
    const re = new RegExp(`(?:${kw.map(escapeRe).join('|')})`, 'i');
    if (re.test([title, ...tags].join(' | '))) return { keep: true, reason: 'keyword' };
  }
  return { keep: false, reason: 'not_relevant' };
}
