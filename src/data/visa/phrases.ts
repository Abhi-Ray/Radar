/**
 * Visa phrase lists (spec §13.3): what a posting says about sponsorship, relocation and the right
 * to work, in EN, DE, FR, NL, ES, PT, IT, SV, DA, NO, FI, PL and CS.
 *
 * Patterns run against FOLDED text (see `fold()` in src/lib/normalize/text.ts): lowercase, no
 * diacritics (ä→a, ß→ss, ø→o, å→a, ł→l, ž→z), typographic apostrophes → "'", dashes → "-".
 * A literal space in a pattern matches any run of whitespace. Word boundaries are added by the
 * compiler in src/lib/visa/signals.ts, so patterns never need \b.
 *
 * Rule kinds:
 * - `statement`: a positive statement (offered / relocation / right-to-work required). It is
 *   checked for negation in its clause ("we can't offer … visa sponsorship" → not offered) and,
 *   for right-to-work, for conditions ("if you don't have the right to work …" → dropped).
 * - `bare`: a noun-phrase mention ("visa sponsorship", "Visa-Sponsoring"). Negation applies; it is
 *   dropped after "require/need/if" and in job-duty context ("you will manage visa sponsorship",
 *   "experience with immigration support", a "Responsibilities" section). It keeps its confidence
 *   only in a benefit context (a "Benefits" / "What we offer" section or label, an offer verb
 *   before it, "… included" after it); anywhere else it is a low-confidence mention (`#mention`),
 *   which the decision engine reads as "likely" at most, never "confirmed".
 * - `negative`: an explicit refusal or restriction that already contains its negation ("no visa
 *   sponsorship", "EU citizens only"). Never negation-checked.
 * - `form`: an application-form question ("Will you now or in the future require sponsorship?").
 *   Not a company statement: at most a low-confidence right_to_work_required.
 * - `labelled`: a "field: value" line ("Visa sponsorship: No"). The `v` group decides the polarity.
 *
 * Rule ids are stable (they are stored with each signal) — never renumber, only add.
 */
import type { Confidence } from '../../lib/contracts/provenance';
import type { VisaSignalKind } from '../../lib/contracts/jobs';

export const VISA_PHRASES_VERSION = 'visa-phrases@2026-09-30.3';

export const VISA_SIGNAL_LANGS = ['en', 'de', 'fr', 'nl', 'es', 'pt', 'it', 'sv', 'da', 'no', 'fi', 'pl', 'cs'] as const;
export type VisaSignalLang = (typeof VISA_SIGNAL_LANGS)[number];

export type VisaRuleKind = 'statement' | 'bare' | 'negative' | 'form' | 'labelled';

export interface VisaPhraseRule {
  id: string;
  lang: VisaSignalLang;
  kind: VisaRuleKind;
  /** For `labelled` rules: the signal of a positive value ("yes"); a negative value flips offered → not_offered. */
  signal: VisaSignalKind;
  pattern: string;
  confidence: Confidence;
}

const r = (
  id: string,
  lang: VisaSignalLang,
  kind: VisaRuleKind,
  signal: VisaSignalKind,
  confidence: Confidence,
  pattern: string,
): VisaPhraseRule => ({ id, lang, kind, signal, confidence, pattern });

// Shared fragments (folded).
const EN_VISA_OBJ =
  '(?:visas?|work visas?|work permits?|employment visas?|skilled worker visas?|(?:eu )?blue cards?|h-?1b(?: visas?)?|visa applications?|immigration|work authori[sz]ations?|residence permits?|employment pass(?:es)?|critical skills employment permits?|employment permits?)';
const EN_NEG_AUX =
  "(?:(?:unfortunately|currently|presently|sadly|regrettably|regretfully|still) )?(?:do not|don't|does not|doesn't|cannot|can't|can not|will not|won't|would not|wouldn't|will never|never|do not ever|are unable to|is unable to|am unable to|are not able to|aren't able to|is not able to|isn't able to|unable to|not able to|are not in a position to|is not in a position to|not in a position to|no longer|are not currently able to|is not currently able to)(?: (?:currently|presently|yet|normally|usually|generally|typically|ever|always|unfortunately))?";
const EN_RTW_OBJ =
  '(?:right to work|work permit|work authori[sz]ation|work visa|working visa|work rights|working rights|residence permit|permission to work|authori[sz]ation to work)';
const EN_PLACES =
  "(?:the )?(?:uk|u\\.k\\.|united kingdom|great britain|britain|us|u\\.s\\.|usa|united states|eu|e\\.u\\.|eea|european union|europe|[a-z][a-z'-]+(?: [a-z][a-z'-]+)?)";

export const VISA_PHRASE_RULES: readonly VisaPhraseRule[] = [
  // ── English ─────────────────────────────────────────────────────────────────────────────────
  // Labelled fields.
  r('en.label.sponsorship', 'en', 'labelled', 'offered', 'high',
    '(?:visa |work permit |immigration |employer )?sponsorship(?: available| offered| provided| possible| support| supported)?\\s*(?::|=|\\s-)\\s*(?<v>yes|no|none|n/?a|available|not available|unavailable|provided|not provided|possible|not possible|offered|not offered|supported|not supported|included|not included|true|false)'),
  r('en.label.visa_support', 'en', 'labelled', 'offered', 'high',
    '(?:visa|work permit|immigration) (?:support|assistance|help)\\s*(?::|=|\\s-)\\s*(?<v>yes|no|none|n/?a|available|not available|provided|not provided|possible|not possible|offered|not offered|included|not included)'),
  r('en.label.relocation', 'en', 'labelled', 'relocation', 'high',
    '(?:relocation|relocation support|relocation assistance|relocation package)\\s*(?::|=|\\s-)\\s*(?<v>yes|no|none|n/?a|available|not available|provided|not provided|possible|not possible|offered|not offered|included|not included)'),
  // Form questions (never a company statement).
  r('en.form.require_sponsorship', 'en', 'form', 'right_to_work_required', 'low',
    '(?:will|do|would|are|have|does|did) you[^?.\\n]{0,100}(?:require|need|requiring|needing)[^?.\\n]{0,60}(?:sponsorship|visa|work permit)'),
  r('en.form.authorized', 'en', 'form', 'right_to_work_required', 'low',
    '(?:are|will|would) you[^?.\\n]{0,40}(?:legally )?(?:authori[sz]ed|eligible|entitled|permitted|allowed) to work'),
  r('en.form.have_rtw', 'en', 'form', 'right_to_work_required', 'low',
    '(?:do|does) you (?:currently )?(?:have|hold|possess)[^?.\\n]{0,40}' + EN_RTW_OBJ),
  r('en.form.field_requires', 'en', 'form', 'right_to_work_required', 'low',
    '(?:requires?|need|needs|required) (?:visa |work permit |immigration )?sponsorship\\s*(?::|\\?)'),
  // Explicit refusals.
  r('en.neg.no_sponsorship', 'en', 'negative', 'not_offered', 'high',
    "(?:no|zero) (?:visa |work permit |immigration |employer |work visa |h-?1b |relocation or visa |relocation and visa |relocation/visa )?sponsorships?(?! (?:is |are |will be )?(?:needed|required|necessary))"),
  r('en.neg.aux_sponsor', 'en', 'negative', 'not_offered', 'high',
    '(?:we |company |employer |client |the company |the client |[a-z]+ )?' + EN_NEG_AUX + ' (?:offer |provide |support |consider |accept )?(?:any )?(?:visa |work permit |immigration )?(?:sponsor(?:ship|ing)?|to sponsor)'),
  r('en.neg.sponsorship_not_available', 'en', 'negative', 'not_offered', 'high',
    "(?:visa |work permit |immigration |employer )?sponsorship (?:of (?:visas?|work permits?) )?(?:for this (?:role|position|job|vacancy) |for these roles |in this case |at this time |currently |unfortunately )?(?:(?:is |are |will |would |can )?(?:not|no longer|unfortunately not|currently not)|isn't|aren't|won't|wouldn't|can't|cannot) (?:be )?(?:currently |presently )?(?:available|offered|provided|possible|supported|an option|given|considered|granted)"),
  r('en.neg.sponsorship_unavailable', 'en', 'negative', 'not_offered', 'high',
    '(?:visa |work permit |immigration )?sponsorship (?:is |are )?(?:unavailable|not on offer|off the table)'),
  r('en.neg.not_eligible', 'en', 'negative', 'not_offered', 'high',
    "(?:this (?:role|position|job|vacancy) )?(?:(?:is not|isn't|are not|aren't|not) (?:eligible|open)|(?:is |are )?ineligible|(?:does not|doesn't|do not|don't|will not|won't) qualify) (?:for|to) (?:visa |work permit )?sponsorship"),
  r('en.neg.requiring_not_considered', 'en', 'negative', 'not_offered', 'high',
    "(?:require|requiring|requires|need|needing|needs) (?:a |any )?(?:current or future )?(?:visa |work permit |employer |immigration |h-?1b )?sponsorship[^.\\n]{0,60}(?:will not|won't|cannot|can't|can not|will be unable to|are not|is not|will be not) (?:be )?(?:considered|eligible|accepted|welcome|able to be considered|progressed)"),
  r('en.neg.cannot_consider', 'en', 'negative', 'not_offered', 'high',
    EN_NEG_AUX + ' (?:consider|accept|progress|proceed with|move forward with|hire|employ) (?:any )?(?:candidates|applicants|applications|people|those|anyone|individuals|applications from candidates)(?: who| that)? (?:will )?(?:now or in the future )?(?:require|requiring|need|needing)[^.\\n]{0,30}sponsorship'),
  r('en.neg.if_no_rtw', 'en', 'negative', 'right_to_work_required', 'high',
    "if you (?:do not|don't|are not|aren't|cannot|can't|lack|have no|do not already|don't already)[^.\\n]{0,40}(?:right to work|work permit|work authori[sz]ation|eligible to work|authori[sz]ed to work|permission to work|work visa)[^.\\n]{0,80}(?:cannot|can't|unable|will not|won't|not be able|not able|regret|not be considered)"),
  r('en.neg.cannot_sponsor_obj', 'en', 'negative', 'not_offered', 'high',
    EN_NEG_AUX + ' (?:offer|provide|support|arrange|process|assist with|help with|facilitate|cover) (?:any )?(?:relocation (?:or|and|/) )?' + EN_VISA_OBJ + '(?: (?:sponsorship|support|assistance|applications?|processes))?'),
  r('en.neg.without_sponsorship', 'en', 'negative', 'right_to_work_required', 'medium',
    '(?:work|working|employment|employed|live and work|to work)[^.\\n]{0,60}without (?:the need for |needing |requiring |requirement for |any )?(?:current or future )?(?:visa |work permit |employer |immigration )?sponsorship'),
  r('en.neg.not_require_sponsorship', 'en', 'negative', 'right_to_work_required', 'high',
    "(?:must|should|will) not (?:now or in the future )?(?:require|need) (?:current or future |any )?(?:visa |work permit |employer |immigration )?sponsorship"),
  r('en.neg.eu_only', 'en', 'negative', 'right_to_work_required', 'high',
    '(?:eu|eea|eu/eea|eu/eea/swiss|eu/efta|uk|us|u\\.s\\.|usa|swiss|european|british|american|canadian|australian) (?:citizens?|nationals?|passport holders?|residents?)(?: or (?:permanent residents?|green card holders?|[a-z]+ (?:citizens|nationals)))? only'),
  r('en.neg.only_eu', 'en', 'negative', 'right_to_work_required', 'high',
    '(?:only|exclusively) (?:open to |accepting |considering |for |hiring )?(?:applicants from |candidates from )?(?:eu|eea|eu/eea|uk|us|u\\.s\\.|usa|european|british|american) (?:citizens|nationals|passport holders|residents|applicants|candidates)'),
  r('en.neg.must_be_citizen', 'en', 'negative', 'right_to_work_required', 'high',
    '(?:must|need to|required to|have to) (?:be|hold) (?:an? )?(?:eu|eea|uk|us|u\\.s\\.|british|american|european|german|french|dutch|irish|swiss|canadian|australian|[a-z]+) (?:citizen|national|citizenship|passport holder|permanent resident|green card holder)'),
  r('en.neg.not_sponsoring', 'en', 'negative', 'not_offered', 'high',
    "(?:we are not|we're not|are not|is not|am not|aren't|isn't)(?: currently| presently| yet| able to| in a position to)? (?:sponsoring|(?:offering|providing|supporting|considering|accepting) (?:any )?(?:visa |work permit |immigration |employer )?sponsorships?|(?:offering|providing|supporting) (?:any )?(?:relocation (?:or|and|/) )?" + EN_VISA_OBJ + " (?:sponsorship|support|assistance))"),
  r('en.neg.not_licensed_sponsor', 'en', 'negative', 'not_offered', 'high',
    "(?:(?:are not|aren't|is not|isn't|not) (?:an? )?(?:uk |home office )?(?:(?:licensed|registered|approved|recogni[sz]ed|ind[- ]recogni[sz]ed) (?:visa |immigration )?|(?:visa|immigration|skilled worker) )sponsors?|(?:do not|don't|does not|doesn't) (?:hold|have) (?:an? |the )?(?:uk |home office )?(?:visa )?sponsor(?:ship)? licen[cs]e)"),
  r('en.neg.do_not_apply_if_sponsorship', 'en', 'negative', 'not_offered', 'high',
    "(?:do not|don't|please don't|please do not) apply if you (?:will )?(?:now or in the future )?(?:require|need)[^.\\n]{0,30}(?:sponsorship|visa|work permit)"),
  r('en.neg.no_h1b_transfer', 'en', 'negative', 'not_offered', 'high', 'no h-?1b (?:transfers?|visas?)'),
  r('en.neg.only_apply_with_rtw', 'en', 'negative', 'right_to_work_required', 'high',
    '(?:only apply|apply only) if you (?:already )?(?:have|hold|possess) (?:the |a |an |full |valid |existing |current |unrestricted |permanent |legal )*(?:[a-z]+ )?' + EN_RTW_OBJ),
  r('en.neg.citizenship_required', 'en', 'negative', 'right_to_work_required', 'high',
    '(?!(?:no|not|without|any) )(?:eu|eea|uk|us|u\\.s\\.|british|american|european|german|french|dutch|irish|swiss|canadian|australian|[a-z]+) citizenship (?:is )?(?:required|mandatory|essential|a must|a requirement|needed)'),
  // "We have sponsored visas in the past but cannot do so for this role": the refusal points back
  // at the sponsorship named earlier in the sentence. Medium: it is read through the anaphora.
  r('en.neg.cannot_do_so', 'en', 'negative', 'not_offered', 'medium',
    "sponsor(?:ed|s|ing|ship|ships)?[^.\\n;?!]{0,80}?(?:,|,? (?:but|however|though|yet))(?: (?:we|we're|unfortunately|sadly|currently))* " + EN_NEG_AUX +
      ' (?:do so|do this|do that|do the same|offer (?:it|this|that)|provide (?:it|this|that)|sponsor (?:for )?(?:this|these) (?:roles?|positions?|jobs?|vacanc(?:y|ies)))'),
  // Positive statements.
  r('en.offer.sponsorship_available', 'en', 'statement', 'offered', 'high',
    '(?:visa |work permit |immigration |employer |skilled worker |h-?1b |work visa |tier 2 |tier-2 |skilled worker visa )sponsorships? (?:is |are |will be |can be |may be )?(?:available|offered|provided|possible|supported|included|an option|on offer)'),
  r('en.offer.sponsorship_available_generic', 'en', 'statement', 'offered', 'medium',
    'sponsorships? (?:is |are |will be |can be )?(?:available|offered|provided|possible|on offer)(?: for (?:the right|qualified|suitable|strong|exceptional|successful) (?:candidates?|applicants?))?'),
  r('en.offer.we_sponsor', 'en', 'statement', 'offered', 'high',
    "(?:we|we'll|we will|we can|we do|we are able to|we're able to|we are happy to|we're happy to|we are glad to|we're glad to|we are willing to|we're willing to|we are open to|we're open to|company will|employer will|they will|we'd be happy to|we would be happy to|happy to|willing to|able to|can) (?:also )?(?:fully )?sponsor (?:your |the |a |an |their |all |any |eligible |successful )?(?:candidates? |applicants? )?(?:for )?(?:the |a |an |your )?" + EN_VISA_OBJ),
  r('en.offer.offer_sponsorship', 'en', 'statement', 'offered', 'high',
    '(?:offer|offers|offering|offered|provide|provides|providing|provided|include|includes|including|support|supports|supporting|arrange|arranges|handle|handles|cover|covers) (?:full |complete |end-to-end |comprehensive )?(?:relocation (?:and|&) )?(?:visa|work permit|immigration|work visa|blue card|skilled worker visa|h-?1b)(?: (?:and|&) relocation)? (?:sponsorship|support|assistance|processing|applications?|costs|fees|process)'),
  r('en.offer.sponsorship_for', 'en', 'statement', 'offered', 'high',
    '(?:offer|offers|offering|provide|provides|providing) sponsorship (?:for|of) (?:a |an |the |your )?' + EN_VISA_OBJ),
  r('en.offer.visa_support_available', 'en', 'statement', 'offered', 'high',
    '(?:visa|work permit|immigration|blue card) (?:support|assistance|help|sponsorship) (?:is |are |will be )?(?:available|offered|provided|included|possible)'),
  r('en.offer.help_with_visa', 'en', 'statement', 'offered', 'medium',
    "(?:we(?:'ll| will)? |we can |we're happy to |we are happy to )?(?:help|support|assist|guide) (?:you )?(?:with|through|in|during) (?:the |your |all )?(?:visa|work permit|immigration|blue card|relocation and visa|visa and relocation)(?: application| process| paperwork| requirements| formalities| procedures?)?"),
  r('en.offer.blue_card_support', 'en', 'statement', 'offered', 'high',
    '(?:eu )?blue card (?:support|sponsorship|assistance|application support|processing|application)'),
  r('en.offer.support_blue_card', 'en', 'statement', 'offered', 'high',
    '(?:support|assistance|help|sponsorship) (?:with|for|in obtaining|obtaining|in applying for) (?:the |an |your |a )?(?:eu )?blue card'),
  r('en.offer.licensed_sponsor', 'en', 'statement', 'offered', 'high',
    '(?:we are|we\'re|is|are) (?:an? )?(?:uk visa |home office |licensed |registered |approved |recognised |recognized |ind[- ]recognised |ind[- ]recognized )(?:licensed |registered )?(?:visa )?sponsors?'),
  r('en.offer.requiring_welcome', 'en', 'statement', 'offered', 'high',
    '(?:candidates|applicants|those|people|you) (?:who )?(?:require|requiring|need|needing) (?:visa |work permit )?sponsorship[^.\\n]{0,40}(?:are (?:also )?welcome|are encouraged|can (?:still )?apply|may (?:still )?apply|should (?:still )?apply|will be considered|are considered)'),
  r('en.offer.welcome_requiring', 'en', 'statement', 'offered', 'high',
    '(?:welcome|encourage|consider) (?:applications from )?(?:candidates|applicants|those|people|anyone) (?:who )?(?:require|requiring|need|needing) (?:visa |work permit )?sponsorship'),
  r('en.offer.open_to_sponsoring', 'en', 'statement', 'offered', 'high',
    '(?:open to|happy to|able to|willing to) (?:consider(?:ing)? )?(?:candidates |applicants )?(?:who )?(?:require|requiring|need|needing) (?:visa |work permit )?sponsorship'),
  r('en.offer.bare_visa_sponsorship', 'en', 'bare', 'offered', 'medium',
    '(?:visa|work permit|immigration|work visa|skilled worker visa|h-?1b|blue card) sponsorship'),
  r('en.offer.bare_visa_support', 'en', 'bare', 'offered', 'medium',
    '(?:relocation (?:and|&|/) )?(?:visa|work permit|immigration)(?: (?:and|&|/) relocation)? (?:support|assistance)'),
  // Relocation.
  r('en.reloc.package', 'en', 'statement', 'relocation', 'high',
    '(?:paid |full |generous |competitive |comprehensive )?relocation(?: (?:and|&|/) (?:visa|immigration))? (?:package|support|assistance|allowance|bonus|budget|help|stipend|grant|services?|costs? (?:are )?covered|expenses (?:are )?covered|reimbursement|lump sum|benefits?)'),
  r('en.reloc.help_relocate', 'en', 'statement', 'relocation', 'high',
    "(?:we(?:'ll| will)? |we can |we're happy to |we are happy to )?(?:help|support|assist) (?:you )?(?:with |to |in )?(?:your |the )?(?:relocation|relocating|relocate)(?: (?:to|process|costs|expenses))?"),
  r('en.reloc.offer_relocation', 'en', 'statement', 'relocation', 'medium',
    '(?:offer|offers|offering|provide|provides|providing|cover|covers|covering|pay for|pays for|include|includes) (?:full |paid |generous )?relocation'),
  r('en.reloc.paid_relocation', 'en', 'statement', 'relocation', 'high', '(?:paid|sponsored|funded|assisted) relocation'),
  r('en.reloc.30_ruling', 'en', 'statement', 'relocation', 'medium', '30 ?% (?:tax )?(?:ruling|rule|regulation)'),
  // Right to work required.
  r('en.rtw.must_have', 'en', 'statement', 'right_to_work_required', 'high',
    '(?:must|will need to|need to|needs to|required to|have to|should) (?:already |currently )?(?:have|hold|possess|be in possession of|be able to provide|provide proof of|demonstrate) (?:the |a |an |full |valid |existing |current |unrestricted |permanent |existing and |legal |your own |own )*(?:(?:uk|us|u\\.s\\.|eu|eea|swiss|german|dutch|irish|canadian|australian|british|american|european|[a-z]+) )?' + EN_RTW_OBJ),
  r('en.rtw.required', 'en', 'statement', 'right_to_work_required', 'high',
    '(?:existing |current |valid |full |unrestricted |permanent |legal )?' + EN_RTW_OBJ + '(?: (?:in|for|within) ' + EN_PLACES + ')? (?:is |are )?(?:required|mandatory|essential|a must|necessary|a requirement|compulsory|needed)'),
  r('en.rtw.must_be_authorised', 'en', 'statement', 'right_to_work_required', 'high',
    '(?:must|need to|needs to|required to|have to|will need to) (?:already )?be (?:legally |fully )?(?:authori[sz]ed|eligible|entitled|permitted|allowed|able) to (?:legally )?(?:live and )?work (?:in|within|for|from)'),
  r('en.rtw.should_be_authorised', 'en', 'statement', 'right_to_work_required', 'medium',
    '(?:should|ideally) (?:already )?be (?:legally )?(?:authori[sz]ed|eligible|entitled|permitted|able) to (?:legally )?work (?:in|within|for)'),
  r('en.rtw.existing_right', 'en', 'statement', 'right_to_work_required', 'high',
    '(?:existing|current|valid|full|unrestricted|permanent) (?:uk |eu |us |eea |swiss )?(?:right to work|work authori[sz]ation|work permit|working rights|work rights)'),
  r('en.rtw.only_with_rtw', 'en', 'statement', 'right_to_work_required', 'high',
    '(?:only )?(?:candidates|applicants|those|people|individuals) (?:with|who have|holding|who hold|who already have|who already hold) (?:the |a |an |full |valid |existing |current |unrestricted |permanent |legal )*' + EN_RTW_OBJ + '[^.\\n]{0,60}(?:will be considered|can be considered|may apply|should apply|need apply|are eligible|will be eligible)'),
  r('en.rtw.need_right_to_work', 'en', 'statement', 'right_to_work_required', 'high',
    "(?:you(?:'ll| will)? need|you need) (?:to have )?(?:the |an? )?(?:existing |valid |full |current |unrestricted )?(?:legal )?right to work"),
  r('en.rtw.eligible_to_work', 'en', 'bare', 'right_to_work_required', 'medium',
    '(?:legally )?(?:authori[sz]ed|eligible|entitled) to work in ' + EN_PLACES),

  // ── German ──────────────────────────────────────────────────────────────────────────────────
  r('de.label.sponsoring', 'de', 'labelled', 'offered', 'high',
    '(?:visa|visum|visums)[- ]?(?:sponsoring|sponsorship|unterstutzung)\\s*(?::|=|\\s-)\\s*(?<v>ja|nein|moglich|nicht moglich|vorhanden|nicht vorhanden|keine?|yes|no)'),
  r('de.label.relocation', 'de', 'labelled', 'relocation', 'high',
    '(?:umzugshilfe|umzugsunterstutzung|relocation(?:[- ]unterstutzung)?)\\s*(?::|=|\\s-)\\s*(?<v>ja|nein|moglich|nicht moglich|vorhanden|nicht vorhanden|keine?)'),
  r('de.form.benotigen', 'de', 'form', 'right_to_work_required', 'low',
    '(?:benotigen|brauchen|benotigst|brauchst) (?:sie|du)[^?.\\n]{0,60}(?:visum|visa|arbeitserlaubnis|aufenthaltstitel|sponsoring|arbeitsgenehmigung)'),
  r('de.form.haben', 'de', 'form', 'right_to_work_required', 'low',
    '(?:haben|besitzen|hast|besitzt) (?:sie|du) (?:eine |bereits eine )?(?:gultige )?(?:arbeitserlaubnis|arbeitsgenehmigung|aufenthaltserlaubnis)[^.\\n]{0,40}\\?'),
  r('de.neg.kein_sponsoring', 'de', 'negative', 'not_offered', 'high',
    '(?:kein|keine|keinen|keinerlei) (?:visa|visum|visums|visa-?|visum-?)?[- ]?(?:sponsoring|sponsorship|sponsorings|unterstutzung beim visum|visa-unterstutzung|visumsunterstutzung|visaunterstutzung)'),
  r('de.neg.kein_visum', 'de', 'negative', 'not_offered', 'high',
    '(?:kein|keine|keinen) (?:visum|visa|arbeitsvisum|aufenthaltstitel)(?! (?:erforderlich|notwendig|notig|benotigt|brauchen|brauchst|braucht))(?= (?:sponsern|sponsoren|stellen|anbieten|ubernehmen|beantragen|bereitstellen|finanzieren|unterstutzen))'),
  r('de.neg.nicht_sponsern', 'de', 'negative', 'not_offered', 'high',
    '(?:konnen|werden|durfen|wollen) (?:leider |derzeit |aktuell |momentan )?(?:kein|keine|keinen|nicht) (?:visa|visum|visa-sponsoring|visasponsoring|visumsponsoring|sponsoring|arbeitsvisum)?[^.\\n]{0,30}(?:sponsern|sponsoren|anbieten|ubernehmen|unterstutzen|ermoglichen|bereitstellen)'),
  r('de.neg.sponsoring_nicht_moglich', 'de', 'negative', 'not_offered', 'high',
    '(?:visa|visum|visums)[- ]?(?:sponsoring|sponsorship|unterstutzung) (?:ist |wird )?(?:leider |derzeit |aktuell |momentan |bei dieser stelle |fur diese stelle )?(?:nicht|kein) (?:moglich|verfugbar|vorgesehen|angeboten|gegeben|vorhanden|moglich)'),
  r('de.neg.nur_eu', 'de', 'negative', 'right_to_work_required', 'high',
    '(?:nur|ausschliesslich|lediglich) (?:fur )?(?:(?:bewerber(?:innen)?|bewerbungen|kandidat(?:inn)?en) (?:aus der |aus dem |mit )?(?:eu|ewr|europaischen union|eu-staatsburgerschaft|eu-staatsangehorigkeit)|(?:eu|ewr)[- ]?(?:burger(?:innen)?|staatsburger(?:innen)?|staatsangehorige|staatsangehorigkeit|burgerschaft))'),
  r('de.offer.visa_unterstutzung', 'de', 'bare', 'offered', 'medium',
    '(?:visa|visum|visums|aufenthaltstitel|arbeitserlaubnis|einwanderungs|blue[- ]card|blaue[- ]karte)[- ]?(?:unterstutzung|hilfe|begleitung)|(?:visa|visum|visums)-?service'),
  r('de.offer.unterstutzung_beim_visum', 'de', 'statement', 'offered', 'high',
    '(?:unterstutzung|hilfe|begleitung|beratung) (?:bei|beim|mit|fur|im|in) (?:dem |der |deinem |ihrem |deiner |ihrer |allen |den )?(?:visum|visa|visumsantrag|visumsprozess|visaprozess|visa-prozess|visaverfahren|visumsverfahren|aufenthaltstitel|aufenthaltserlaubnis|arbeitserlaubnis|arbeitsgenehmigung|blue card|blauen karte|einwanderung|einwanderungsprozess|behordengangen|formalitaten rund um (?:das |dein |ihr )?visum)'),
  r('de.offer.wir_unterstutzen', 'de', 'statement', 'offered', 'high',
    '(?:wir )?(?:unterstutzen|helfen|begleiten) (?:dich|sie|euch|ihnen|dir)? ?(?:gerne )?(?:bei|beim|mit|im) (?:dem |der |deinem |ihrem |deiner |ihrer )?(?:visum|visa|visumsantrag|visaprozess|aufenthaltstitel|arbeitserlaubnis|blue card|blauen karte|einwanderungsprozess)'),
  r('de.offer.wir_sponsern', 'de', 'statement', 'offered', 'high',
    '(?:wir )?(?:sponsern|sponsoren|ubernehmen|bieten|ermoglichen|finanzieren) (?:dir |ihnen )?(?:das |ein |dein |ihr |die |eine )?(?:visum|visa|visa-sponsoring|visasponsoring|visumsponsoring|visa-unterstutzung|visumsunterstutzung|arbeitsvisum|blue card|blaue karte)'),
  r('de.offer.sponsoring_moglich', 'de', 'statement', 'offered', 'high',
    '(?:visa|visum|visums)[- ]?(?:sponsoring|sponsorship) (?:ist |wird )?(?:moglich|verfugbar|vorhanden|inklusive|angeboten|gegeben)'),
  r('de.offer.bare_sponsoring', 'de', 'bare', 'offered', 'medium', '(?:visa|visum|visums)[- ]?(?:sponsoring|sponsorship)'),
  r('de.reloc.umzug', 'de', 'statement', 'relocation', 'high',
    '(?:umzugs(?:hilfe|unterstutzung|pauschale|kostenzuschuss|zuschuss|paket|kosten(?:ubernahme|erstattung)|budget|bonus|service)|relocation[- ]?(?:paket|unterstutzung|support|package|hilfe|budget|pauschale|service|bonus))'),
  r('de.reloc.unterstutzung_umzug', 'de', 'statement', 'relocation', 'high',
    '(?:unterstutzung|hilfe) (?:bei|beim|fur|mit) (?:dem |deinem |ihrem |der )?(?:umzug|relocation|wohnungssuche und umzug)'),
  r('de.reloc.und_umzug', 'de', 'statement', 'relocation', 'high',
    '(?:unterstutzung|hilfe|unterstutzen|helfen|begleiten)[^.\\n]{0,50} (?:und|sowie) (?:beim |bei dem |bei der |mit dem )?(?:umzug|relocation)'),
  r('de.reloc.umzugskosten', 'de', 'statement', 'relocation', 'high',
    '(?:ubernahme|erstattung|ubernehmen|erstatten|bezuschussen) (?:der |die |deine |ihre )?umzugskosten'),
  r('de.reloc.wir_helfen', 'de', 'statement', 'relocation', 'high',
    '(?:wir )?(?:helfen|unterstutzen) (?:dir|dich|ihnen|sie) (?:gerne )?(?:bei|beim) (?:dem |deinem |ihrem )?umzug'),
  r('de.rtw.erforderlich', 'de', 'statement', 'right_to_work_required', 'high',
    '(?:gultige |bestehende |vorhandene |uneingeschrankte |unbefristete )?(?:arbeitserlaubnis|arbeitsgenehmigung|aufenthalts- und arbeitserlaubnis|arbeitsberechtigung)(?: (?:fur|in) (?:deutschland|der eu|die eu|osterreich|der schweiz|die schweiz|den ewr))? (?:ist |wird )?(?:zwingend |unbedingt )?(?:erforderlich|notwendig|vorausgesetzt|voraussetzung|pflicht|benotigt|ein muss)'),
  r('de.rtw.gultige', 'de', 'statement', 'right_to_work_required', 'high',
    '(?:gultige|bestehende|vorhandene|uneingeschrankte|unbefristete) (?:arbeitserlaubnis|arbeitsgenehmigung|aufenthalts- und arbeitserlaubnis|arbeitsberechtigung)'),
  r('de.rtw.eu_staatsburgerschaft', 'de', 'statement', 'right_to_work_required', 'high',
    '(?:eu|ewr)[- ]?(?:staatsburgerschaft|staatsangehorigkeit|burgerschaft|pass) (?:ist )?(?:erforderlich|voraussetzung|notwendig|pflicht)'),
  r('de.rtw.berechtigt', 'de', 'statement', 'right_to_work_required', 'medium',
    '(?:berechtigt|befugt|erlaubnis|berechtigung) (?:sein )?,? ?(?:in|fur) (?:deutschland|der eu|osterreich|der schweiz) (?:zu )?(?:arbeiten|zu arbeiten)'),

  // ── French ──────────────────────────────────────────────────────────────────────────────────
  r('fr.label.sponsoring', 'fr', 'labelled', 'offered', 'high',
    '(?:sponsoring|parrainage|sponsorisation)(?: (?:de |du )?visa)?\\s*(?::|=|\\s-)\\s*(?<v>oui|non|possible|impossible|disponible|non disponible|aucun)'),
  r('fr.form.besoin', 'fr', 'form', 'right_to_work_required', 'low',
    '(?:avez-vous|aurez-vous|auriez-vous|avez vous|as-tu) (?:besoin|actuellement besoin)[^?.\\n]{0,60}(?:visa|parrainage|sponsoring|sponsorisation|permis de travail|autorisation de travail)'),
  r('fr.neg.pas_de_sponsoring', 'fr', 'negative', 'not_offered', 'high',
    "(?:pas de|aucun|aucune|sans possibilite de) (?:sponsoring|parrainage|sponsorisation|sponsorship|prise en charge (?:du |de )?visa|visa sponsoring|accompagnement (?:pour le |au )?visa|aide au visa)"),
  r('fr.neg.ne_pouvons_pas', 'fr', 'negative', 'not_offered', 'high',
    "(?:ne|n') ?(?:pouvons|pourrons|sommes|proposons|offrons|sponsorisons|parrainons|prenons|fournissons|assurons|peut|pourra|propose|offre)[^.\\n]{0,40}(?:pas|aucun|aucune|plus)[^.\\n]{0,40}(?:visa|sponsoring|parrainage|sponsoris|permis de travail)"),
  r('fr.neg.sponsoring_impossible', 'fr', 'negative', 'not_offered', 'high',
    "(?:sponsoring|parrainage|sponsorisation)(?: (?:de |du )?visa)? (?:n'est pas|ne sera pas|non|impossible|indisponible)(?: possible| propose| disponible| offert| envisageable)?"),
  r('fr.neg.uniquement_ue', 'fr', 'negative', 'right_to_work_required', 'high',
    "(?:uniquement|seulement|exclusivement|reserve aux?) (?:les |aux |pour les |des )?(?:ressortissants|citoyens|candidats|nationaux) (?:de l'ue|europeens|de l'union europeenne|de l'eee|ue|communautaires)"),
  r('fr.neg.ue_uniquement', 'fr', 'negative', 'right_to_work_required', 'high',
    "(?:ressortissants?|citoyens?|candidats?) (?:de l'ue|europeens?|de l'union europeenne|ue|communautaires?) (?:uniquement|seulement|exclusivement)"),
  r('fr.offer.aide_visa', 'fr', 'statement', 'offered', 'high',
    "(?:aide|accompagnement|soutien|assistance|prise en charge|appui|support) (?:complet |personnalise )?(?:a l'obtention |pour l'obtention |dans l'obtention |dans les demarches |aux demarches |pour les demarches |administratif |dans vos demarches )?(?:du |de |d'|de votre |de ton |au |aux |a votre |pour le |pour votre |de la )?(?:visa|visas|titre de sejour|permis de travail|autorisation de travail|demarches d'immigration|immigration|carte bleue europeenne|passeport talent|carte de sejour)"),
  r('fr.offer.nous_sponsorisons', 'fr', 'statement', 'offered', 'high',
    '(?:nous )?(?:sponsorisons|parrainons|prenons en charge|finan[cs]ons|accompagnons|facilitons|gerons|assurons) (?:les |le |votre |ton |vos |la |l\'obtention du |l\'obtention de votre )?(?:visa|visas|demarches de visa|titre de sejour|permis de travail|passeport talent)'),
  r('fr.offer.sponsoring_possible', 'fr', 'statement', 'offered', 'high',
    '(?:sponsoring|parrainage|sponsorisation)(?: (?:de |du )?visa)? (?:est |sera )?(?:possible|disponible|propose|offert|pris en charge|envisageable)'),
  r('fr.offer.bare_sponsoring', 'fr', 'bare', 'offered', 'medium',
    '(?:sponsoring|parrainage|sponsorisation) (?:de |du |d\'un |pour le |pour votre )?visa'),
  r('fr.reloc.aide', 'fr', 'statement', 'relocation', 'high',
    "(?:aide|package|pack|prime|forfait|indemnite|accompagnement|soutien|assistance|participation|prise en charge) (?:(?:des frais )?(?:a la |de |au |pour la |pour le |du |a votre |de votre |aux frais de ))?(?:relocation|relocalisation|demenagement|mobilite geographique|installation)"),
  r('fr.reloc.package_relocation', 'fr', 'statement', 'relocation', 'high', '(?:package|pack|forfait|prime) (?:de )?relocation'),
  r('fr.rtw.requis', 'fr', 'statement', 'right_to_work_required', 'high',
    "(?:autorisation|permis) de travail (?:valide |valable |en cours de validite )?(?:en france |dans l'ue |dans l'union europeenne |en belgique |au luxembourg |en suisse )?(?:est |sera )?(?:requise?|obligatoire|exigee?|necessaire|indispensable|imperative?)"),
  r('fr.rtw.autorise', 'fr', 'statement', 'right_to_work_required', 'high',
    "(?:devez|doit|devrez|devra|etre deja) (?:deja )?(?:etre )?(?:autorise|autorisee|autorises|habilite|habilitee|en droit|legalement autorise) (?:a|de) travailler (?:en|dans|au|sur)"),
  r('fr.rtw.valide', 'fr', 'statement', 'right_to_work_required', 'high',
    "(?:disposer d'un|posseder un|etre titulaire d'un|avoir un|detenir un) (?:permis de travail|titre de sejour|droit de travailler)(?: valide| valable| en cours de validite)?"),

  // ── Dutch ───────────────────────────────────────────────────────────────────────────────────
  r('nl.label.sponsoring', 'nl', 'labelled', 'offered', 'high',
    '(?:visum|visa)[- ]?(?:sponsoring|sponsorship|ondersteuning)\\s*(?::|=|\\s-)\\s*(?<v>ja|nee|mogelijk|niet mogelijk|geen)'),
  r('nl.form.heb_je', 'nl', 'form', 'right_to_work_required', 'low',
    '(?:heb je|heeft u|ben je|bent u|beschik je|beschikt u)[^?.\\n]{0,50}(?:werkvergunning|visum|sponsoring|verblijfsvergunning|gerechtigd om)[^.\\n]{0,40}\\?'),
  r('nl.neg.geen_sponsoring', 'nl', 'negative', 'not_offered', 'high',
    '(?:geen|zonder) (?:visum|visa|visum-?|visa-?)?[- ]?(?:sponsoring|sponsorship|ondersteuning bij (?:je |het |uw )?(?:visum|visa|verblijfsvergunning|werkvergunning)|visumondersteuning|kennismigrantenregeling|kennismigrant(?:en)?visum|kennismigrant(?:en)?status|sponsor)'),
  r('nl.neg.kunnen_niet', 'nl', 'negative', 'not_offered', 'high',
    '(?:kunnen|bieden|sponsoren|regelen|verzorgen|faciliteren|zijn) (?:helaas |momenteel |op dit moment )?(?:geen|niet)[^.\\n]{0,40}(?:visum|visa|sponsoring|sponsoren|werkvergunning|verblijfsvergunning|kennismigrant|erkend referent)'),
  r('nl.neg.alleen_eu', 'nl', 'negative', 'right_to_work_required', 'high',
    '(?:alleen|uitsluitend|enkel) (?:voor |open voor )?(?:eu|eer|europese)[- ]?(?:burgers|onderdanen|ingezetenen|nationaliteit|kandidaten|paspoorthouders)'),
  r('nl.offer.erkend_referent', 'nl', 'statement', 'offered', 'high',
    '(?:wij zijn|we zijn|zijn wij|als|is|zijn) (?:een |door de ind )?(?:door de ind )?erkende? (?:referent|sponsor)'),
  r('nl.offer.kennismigrant', 'nl', 'statement', 'offered', 'high',
    'kennismigrant(?:en)?(?:visum|regeling|status|vergunning|traject|aanvraag)? (?:is |zijn |wordt )?(?:mogelijk|beschikbaar|aangeboden|geregeld|ondersteund)'),
  r('nl.offer.hulp_visum', 'nl', 'statement', 'offered', 'high',
    '(?:hulp|ondersteuning|begeleiding|assistentie|support) (?:bij|met|voor) (?:je |uw |de |het |jouw )?(?:visum|visa|visumaanvraag|verblijfsvergunning|werkvergunning|kennismigrantenaanvraag|kennismigrantenvisum|immigratie|immigratieproces|ind-aanvraag|ind aanvraag)'),
  r('nl.offer.wij_sponsoren', 'nl', 'statement', 'offered', 'high',
    '(?:wij|we) (?:sponsoren|regelen|verzorgen|faciliteren|ondersteunen|bieden) (?:je |uw |het |de |een |jouw )?(?:visum|visa|visumsponsoring|werkvergunning|verblijfsvergunning|kennismigrantenvisum|sponsoring)'),
  r('nl.offer.bare_sponsoring', 'nl', 'bare', 'offered', 'medium', '(?:visum|visa)[- ]?(?:sponsoring|sponsorship|ondersteuning)'),
  r('nl.reloc.verhuis', 'nl', 'statement', 'relocation', 'high',
    '(?:verhuis|relocatie|relocation)[- ]?(?:vergoeding|kosten(?:vergoeding)?|pakket|package|ondersteuning|budget|bonus|regeling|hulp|service)'),
  r('nl.reloc.hulp_verhuizing', 'nl', 'statement', 'relocation', 'high',
    '(?:hulp|ondersteuning|begeleiding) (?:bij|met) (?:je |uw |de |jouw )?(?:verhuizing|relocatie|relocation|verhuizen)'),
  r('nl.reloc.30_regeling', 'nl', 'statement', 'relocation', 'medium', '30 ?%[- ]?(?:regeling|ruling)'),
  r('nl.rtw.vereist', 'nl', 'statement', 'right_to_work_required', 'high',
    '(?:geldige |bestaande )?(?:werkvergunning|verblijfsvergunning|tewerkstellingsvergunning)(?: (?:voor|in) (?:nederland|de eu|belgie))? (?:is |wordt )?(?:vereist|verplicht|noodzakelijk|een vereiste|een must|een pre)'),
  r('nl.rtw.geldige', 'nl', 'statement', 'right_to_work_required', 'high',
    '(?:in het bezit van|beschikken over|hebben van) (?:een )?(?:geldige )?(?:werkvergunning|verblijfsvergunning|tewerkstellingsvergunning)'),
  r('nl.rtw.gerechtigd', 'nl', 'statement', 'right_to_work_required', 'medium',
    '(?:gerechtigd|bevoegd|toestemming hebben|het recht hebben) (?:om |tot )?(?:in (?:nederland|de eu|belgie|europa) )?(?:te )?werken(?: in (?:nederland|de eu|belgie|europa))?'),

  // ── Spanish ─────────────────────────────────────────────────────────────────────────────────
  r('es.label.patrocinio', 'es', 'labelled', 'offered', 'high',
    'patrocinio(?: de (?:visado|visa))?\\s*(?::|=|\\s-)\\s*(?<v>si|no|disponible|no disponible|posible|no posible|ninguno)'),
  r('es.form.necesitas', 'es', 'form', 'right_to_work_required', 'low',
    '(?:necesitas|necesita|necesitaras|necesitara|requieres|requiere usted|requerira)[^?.\\n]{0,50}(?:patrocinio|visado|visa|permiso de trabajo)[^.\\n]{0,40}\\?'),
  r('es.neg.no_ofrecemos', 'es', 'negative', 'not_offered', 'high',
    'no (?:ofrecemos|ofrece|ofreceremos|proporcionamos|brindamos|podemos ofrecer|podemos proporcionar|podemos patrocinar|patrocinamos|tramitamos|gestionamos|facilitamos|incluye|se ofrece|se ofrecera|es posible ofrecer|contamos con|hay|existe|disponemos de)(?: el| un| ningun| ninguna| la)? (?:patrocinio|patrocinar|visado|visados|visa|visas|permisos? de trabajo|tramitacion de visados?|posibilidad de patrocinio|apoyo con el visado|ayuda con el visado)'),
  r('es.neg.sin_patrocinio', 'es', 'negative', 'right_to_work_required', 'medium',
    '(?:trabajar|trabajo|contratar)[^.\\n]{0,50}sin (?:necesidad de |requerir )?(?:patrocinio|visado|permiso adicional)'),
  r('es.neg.ningun_patrocinio', 'es', 'negative', 'not_offered', 'high', '(?:ningun|ninguna|sin) (?:tipo de )?(?:patrocinio|posibilidad de patrocinio)(?! (?:necesario|requerido))'),
  r('es.neg.patrocinio_no', 'es', 'negative', 'not_offered', 'high',
    'patrocinio(?: de (?:visado|visa))? no (?:esta |es |sera )?(?:disponible|posible|ofrecido|contemplado)'),
  r('es.neg.solo_ue', 'es', 'negative', 'right_to_work_required', 'high',
    '(?:solo|solamente|unicamente|exclusivamente) (?:para )?(?:ciudadanos|nacionales|candidatos|residentes) (?:de la ue|europeos|de la union europea|comunitarios|con nacionalidad (?:europea|espanola))'),
  r('es.offer.ayuda_visado', 'es', 'statement', 'offered', 'high',
    '(?:patrocinio|patrocinamos|tramitacion|tramitamos|gestion|gestionamos|ayuda|apoyo|asistencia|asesoramiento|acompanamiento|soporte) (?:completo |integral )?(?:con |para |en |del |de |de la |de tu |de su |para el |para la |en el |en la |con el |con la )?(?:el |la |tu |su )?(?:visado|visa|permiso de trabajo|permiso de residencia|tarjeta azul|proceso de visado|tramites de visado|tramites migratorios|proceso migratorio|residencia)'),
  r('es.offer.ofrecemos_patrocinio', 'es', 'statement', 'offered', 'high',
    '(?:ofrecemos|proporcionamos|brindamos|incluimos|incluye|facilitamos|se ofrece) (?:el |un )?(?:patrocinio|visado|patrocinio de visado|apoyo con el visado)'),
  r('es.offer.patrocinio_disponible', 'es', 'statement', 'offered', 'high',
    'patrocinio(?: de (?:visado|visa))? (?:esta |es |sera )?(?:disponible|posible|ofrecido|incluido)'),
  r('es.offer.bare_patrocinio', 'es', 'bare', 'offered', 'medium', 'patrocinio (?:de |del )?(?:visado|visa)'),
  r('es.reloc.paquete', 'es', 'statement', 'relocation', 'high',
    '(?:paquete|ayuda|apoyo|asistencia|bono|plan|programa|compensacion|gastos) (?:completo |integral )?(?:de |para la |a la |con la |para el |en la |por )?(?:reubicacion|relocalizacion|relocation|traslado|mudanza|recolocacion)'),
  r('es.rtw.requerido', 'es', 'statement', 'right_to_work_required', 'high',
    '(?:permiso|autorizacion) de trabajo (?:vigente |valido |en vigor )?(?:en espana |en la ue |en la union europea |en europa )?(?:es )?(?:necesario|obligatorio|imprescindible|requerido|indispensable|excluyente)'),
  r('es.rtw.se_requiere', 'es', 'statement', 'right_to_work_required', 'high',
    '(?:se requiere|imprescindible|es necesario|requisito|indispensable|debes|debe|deberas)[:]? (?:contar con |tener |disponer de |poseer |estar en posesion de )?(?:un |una )?(?:permiso|autorizacion) (?:de|para) (?:trabajo|trabajar)'),
  r('es.rtw.autorizado', 'es', 'statement', 'right_to_work_required', 'high',
    '(?:debes|debe|deberas|necesitas) (?:estar )?(?:autorizad[oa]|habilitad[oa]|legalmente autorizad[oa]) (?:para|a) trabajar en'),

  // ── Portuguese ──────────────────────────────────────────────────────────────────────────────
  r('pt.label.patrocinio', 'pt', 'labelled', 'offered', 'high',
    'patrocinio(?: de visto)?\\s*(?::|=|\\s-)\\s*(?<v>sim|nao|disponivel|nao disponivel|possivel|nenhum)'),
  r('pt.form.precisa', 'pt', 'form', 'right_to_work_required', 'low',
    '(?:voce precisa|precisa|precisara|necessita|necessitara|voce necessita)[^?.\\n]{0,50}(?:patrocinio|visto|autorizacao de trabalho)[^.\\n]{0,40}\\?'),
  r('pt.neg.nao_oferecemos', 'pt', 'negative', 'not_offered', 'high',
    'nao (?:oferecemos|oferece|fornecemos|patrocinamos|podemos oferecer|podemos patrocinar|podemos fornecer|damos|tratamos|ha|existe|temos|e possivel oferecer|e oferecido|incluimos)(?: o| um| a| nenhum)? (?:patrocinio|visto|vistos|apoio (?:com|no|ao) visto|possibilidade de patrocinio|autorizacao de trabalho)'),
  r('pt.neg.sem_patrocinio', 'pt', 'negative', 'right_to_work_required', 'medium',
    '(?:trabalhar|trabalho|contratar)[^.\\n]{0,50}sem (?:necessidade de )?(?:patrocinio|visto)'),
  r('pt.neg.nenhum', 'pt', 'negative', 'not_offered', 'high', '(?:nenhum|sem) (?:tipo de )?patrocinio(?! (?:necessario|exigido))'),
  r('pt.neg.apenas_ue', 'pt', 'negative', 'right_to_work_required', 'high',
    '(?:apenas|somente|exclusivamente|so) (?:para )?(?:cidadaos|nacionais|candidatos|residentes) (?:da ue|europeus|da uniao europeia|comunitarios|com nacionalidade (?:europeia|portuguesa))'),
  r('pt.offer.apoio_visto', 'pt', 'statement', 'offered', 'high',
    '(?:patrocinio|patrocinamos|apoio|ajuda|assistencia|suporte|acompanhamento|tratamos|tratamento) (?:completo |total )?(?:com |no |na |ao |para o |para a |de |do |da |com o |com a |em todo o )?(?:o |a |seu |sua )?(?:visto|autorizacao de residencia|autorizacao de trabalho|processo de visto|processo de imigracao|cartao azul|titulo de residencia|imigracao)'),
  r('pt.offer.oferecemos', 'pt', 'statement', 'offered', 'high',
    '(?:oferecemos|fornecemos|incluimos|garantimos|damos) (?:o |um )?(?:patrocinio|visto|patrocinio de visto|apoio com o visto)'),
  r('pt.offer.bare_patrocinio', 'pt', 'bare', 'offered', 'medium', 'patrocinio (?:de |do )?visto'),
  r('pt.reloc.pacote', 'pt', 'statement', 'relocation', 'high',
    '(?:pacote|apoio|ajuda|auxilio|bonus|subsidio|programa|beneficio) (?:completo |total )?(?:de |a |na |para a |com a |para )?(?:relocalizacao|realocacao|relocation|mudanca|recolocacao|relocacao)'),
  r('pt.rtw.obrigatoria', 'pt', 'statement', 'right_to_work_required', 'high',
    '(?:autorizacao|permissao|visto) de (?:trabalho|residencia) (?:valid[oa] )?(?:em portugal |na ue |na uniao europeia |no brasil |na europa )?(?:e )?(?:obrigatori[oa]|necessari[oa]|exigid[oa]|imprescindivel|requerid[oa]|indispensavel)'),
  r('pt.rtw.autorizado', 'pt', 'statement', 'right_to_work_required', 'high',
    '(?:deve|deves|devera|precisa|necessita) (?:estar |ser )?(?:ja )?(?:autorizad[oa]|legalmente autorizad[oa]|habilitad[oa]) a trabalhar (?:em|na|no)'),

  // ── Italian ─────────────────────────────────────────────────────────────────────────────────
  r('it.label.sponsorizzazione', 'it', 'labelled', 'offered', 'high',
    '(?:sponsorizzazione|sponsorship)(?: (?:del |per il )?visto)?\\s*(?::|=|\\s-)\\s*(?<v>si|no|disponibile|non disponibile|possibile|non possibile|nessuna)'),
  r('it.form.hai_bisogno', 'it', 'form', 'right_to_work_required', 'low',
    '(?:hai bisogno|avra bisogno|ha bisogno|necessiti|necessita|avrai bisogno)[^?.\\n]{0,50}(?:sponsorizzazione|visto|permesso di (?:lavoro|soggiorno))[^.\\n]{0,40}\\?'),
  r('it.neg.non_offriamo', 'it', 'negative', 'not_offered', 'high',
    'non (?:offriamo|forniamo|sponsorizziamo|possiamo offrire|possiamo sponsorizzare|possiamo fornire|garantiamo|gestiamo|e prevista|e possibile|prevediamo|e disponibile)(?: la| il| alcuna| alcun| nessuna| una)? (?:sponsorizzazione|visto|visti|supporto per il visto|sponsorship|assistenza per il visto|permesso di lavoro)'),
  r('it.neg.nessuna', 'it', 'negative', 'not_offered', 'high', '(?:nessuna|alcuna|senza) (?:possibilita di )?(?:sponsorizzazione|sponsorship)(?! (?:necessaria|richiesta))'),
  r('it.neg.solo_ue', 'it', 'negative', 'right_to_work_required', 'high',
    "(?:solo|solamente|esclusivamente|unicamente|riservato a) (?:ai )?(?:cittadini|candidati|residenti) (?:ue|europei|dell'ue|dell'unione europea|comunitari|italiani)"),
  r('it.offer.supporto_visto', 'it', 'statement', 'offered', 'high',
    '(?:sponsorizzazione|sponsorship|supporto|assistenza|aiuto|accompagnamento|gestione) (?:completo |completa |totale )?(?:per il |per |con il |nel |al |del |della |per la |nella |con la |alla )?(?:visto|visti|permesso di soggiorno|permesso di lavoro|carta blu|pratiche (?:del |per il )?visto|pratiche di immigrazione|immigrazione|pratica del visto)'),
  r('it.offer.offriamo', 'it', 'statement', 'offered', 'high',
    '(?:offriamo|forniamo|garantiamo|sponsorizziamo|gestiamo) (?:la |il |un )?(?:sponsorizzazione|visto|supporto per il visto|pratiche del visto)'),
  r('it.reloc.pacchetto', 'it', 'statement', 'relocation', 'high',
    "(?:pacchetto|supporto|aiuto|contributo|bonus|rimborso|assistenza|indennita) (?:completo |totale )?(?:di |per il |al |per la |alla |per |delle spese di |spese di )?(?:relocation|trasferimento|rilocazione|ricollocazione|trasloco)"),
  r('it.rtw.obbligatorio', 'it', 'statement', 'right_to_work_required', 'high',
    "(?:permesso di (?:lavoro|soggiorno)|autorizzazione al lavoro|autorizzazione a lavorare) (?:valido |in corso di validita )?(?:in italia |nell'ue |nell'unione europea )?(?:e )?(?:obbligatorio|necessario|richiesto|indispensabile|requisito|fondamentale)"),
  r('it.rtw.autorizzato', 'it', 'statement', 'right_to_work_required', 'high',
    '(?:devi|deve|dovrai|dovra) (?:gia )?(?:essere )?(?:autorizzat[oai]|legalmente autorizzat[oai]|abilitat[oai]) a lavorare in'),
  r('it.rtw.cittadinanza', 'it', 'statement', 'right_to_work_required', 'high',
    '(?:cittadinanza|nazionalita) (?:ue|europea|italiana|comunitaria) (?:e )?(?:obbligatoria|richiesta|necessaria|requisito)'),

  // ── Swedish ─────────────────────────────────────────────────────────────────────────────────
  r('sv.label.sponsring', 'sv', 'labelled', 'offered', 'high',
    '(?:visumsponsring|visum|arbetstillstand)\\s*(?::|=|\\s-)\\s*(?<v>ja|nej|mojligt|inte mojligt|ingen)'),
  r('sv.form.behover', 'sv', 'form', 'right_to_work_required', 'low',
    '(?:behover du|kommer du att behova|har du)[^?.\\n]{0,50}(?:visum|arbetstillstand|sponsring|uppehallstillstand)[^.\\n]{0,40}\\?'),
  r('sv.neg.ingen', 'sv', 'negative', 'not_offered', 'high',
    '(?:ingen|inga|inget) (?:visumsponsring|sponsring|sponsring av visum|hjalp med (?:visum|arbetstillstand)|visering)(?! (?:behovs|kravs))'),
  r('sv.neg.kan_inte', 'sv', 'negative', 'not_offered', 'high',
    '(?:kan|erbjuder|sponsrar|ordnar|hjalper) (?:tyvarr |for narvarande |i dagslaget )?(?:inte|ej|ingen|inga)[^.\\n]{0,30}(?:visum|arbetstillstand|sponsring|uppehallstillstand)'),
  r('sv.neg.endast_eu', 'sv', 'negative', 'right_to_work_required', 'high',
    '(?:endast|bara|enbart) (?:for |oppen for )?(?:eu-medborgare|eu/ees-medborgare|ees-medborgare|medborgare (?:inom|i) (?:eu|ees)|eu medborgare|svenska medborgare)'),
  r('sv.offer.hjalp_visum', 'sv', 'statement', 'offered', 'high',
    '(?:hjalp|stod|assistans|bistand|(?:vi )?hjalper (?:dig |er )?(?:till )?|(?:vi )?stottar (?:dig |er )?) ?(?:med|vid|for|i) (?:ditt |din |ansokan om |ansokningen om |hela )?(?:visum|arbetstillstand|uppehallstillstand|immigration|migrationsprocessen|visumprocessen|arbetstillstandsprocessen|visumansokan)'),
  r('sv.offer.vi_sponsrar', 'sv', 'statement', 'offered', 'high',
    '(?:vi )?(?:sponsrar|erbjuder|ordnar|bekostar|hjalper till med|stottar med|star for) (?:ditt |din |ett |en )?(?:visum|arbetstillstand|visumsponsring|sponsring av (?:visum|arbetstillstand))'),
  r('sv.offer.bare', 'sv', 'bare', 'offered', 'medium', '(?:visumsponsring|sponsring av (?:visum|arbetstillstand))'),
  r('sv.reloc.flytt', 'sv', 'statement', 'relocation', 'high',
    '(?:flytthjalp|flyttbidrag|flyttpaket|flyttersattning|flyttstod|relocation[- ]?(?:stod|paket|hjalp|bidrag))'),
  r('sv.reloc.hjalp_flytt', 'sv', 'statement', 'relocation', 'high',
    '(?:hjalp|stod) (?:med|vid) (?:flytten|flytt|relocation|omlokalisering|att flytta)'),
  r('sv.rtw.kravs', 'sv', 'statement', 'right_to_work_required', 'high',
    '(?:giltigt )?(?:arbetstillstand|uppehalls- och arbetstillstand)(?: i sverige| inom eu)? (?:ar ett krav|kravs|maste finnas|ar obligatoriskt|ar ett skall-krav)'),
  r('sv.rtw.ratt', 'sv', 'statement', 'right_to_work_required', 'high',
    '(?:maste ha|ska ha|kravs|krav pa) (?:ratt|behorighet|tillstand) att arbeta i (?:sverige|eu|norden)'),

  // ── Danish ──────────────────────────────────────────────────────────────────────────────────
  r('da.label.sponsorat', 'da', 'labelled', 'offered', 'high',
    '(?:visumsponsorat|visum|arbejdstilladelse)\\s*(?::|=|\\s-)\\s*(?<v>ja|nej|muligt|ikke muligt|ingen)'),
  r('da.form.har_du_brug', 'da', 'form', 'right_to_work_required', 'low',
    '(?:har du brug for|skal du bruge|har du)[^?.\\n]{0,50}(?:visum|arbejdstilladelse|sponsorat|opholdstilladelse)[^.\\n]{0,40}\\?'),
  r('da.neg.ingen', 'da', 'negative', 'not_offered', 'high',
    '(?:ingen|intet) (?:visumsponsorat|sponsorat|hjaelp til (?:visum|arbejdstilladelse)|visumhjaelp)(?! (?:kraeves|er nodvendig))'),
  r('da.neg.kan_ikke', 'da', 'negative', 'not_offered', 'high',
    '(?:kan|tilbyder|sponsorerer|hjaelper) (?:desvaerre |pt\\. |pa nuvaerende tidspunkt )?(?:ikke|ingen)[^.\\n]{0,30}(?:visum|arbejdstilladelse|sponsorat|opholdstilladelse)'),
  r('da.neg.kun_eu', 'da', 'negative', 'right_to_work_required', 'high',
    '(?:kun|udelukkende|alene) (?:for |abent for )?(?:eu-borgere|eu borgere|eu/eos-borgere|statsborgere i eu|danske statsborgere)'),
  r('da.offer.hjaelp_visum', 'da', 'statement', 'offered', 'high',
    '(?:hjaelp|stotte|assistance|bistand|(?:vi )?hjaelper (?:dig |jer )?|(?:vi )?stotter (?:dig |jer )?) ?(?:til|med|ved|i) (?:dit |din |ansogning om |ansogningen om |hele )?(?:visum|arbejdstilladelse|opholdstilladelse|immigration|ansogningsprocessen hos siri|siri-ansogning|fast-track)'),
  r('da.offer.vi_sponsorerer', 'da', 'statement', 'offered', 'high',
    '(?:vi )?(?:sponsorerer|tilbyder|arrangerer|betaler for|star for) (?:dit |din |et |en )?(?:visum|arbejdstilladelse|visumsponsorat|opholdstilladelse)'),
  r('da.offer.fast_track', 'da', 'statement', 'offered', 'high',
    '(?:certificeret|godkendt) (?:til |under |efter )?(?:fast[- ]track[- ]?ordningen|fast[- ]track)'),
  r('da.reloc.flytte', 'da', 'statement', 'relocation', 'high',
    '(?:flyttehjaelp|flyttegodtgorelse|flyttepakke|flyttetilskud|relocation[- ]?(?:pakke|stotte|hjaelp))'),
  r('da.reloc.hjaelp_flytning', 'da', 'statement', 'relocation', 'high',
    '(?:hjaelp|stotte) (?:til|med) (?:flytningen|flytning|relocation|at flytte)'),
  r('da.rtw.kraeves', 'da', 'statement', 'right_to_work_required', 'high',
    '(?:gyldig )?(?:arbejdstilladelse|opholds- og arbejdstilladelse)(?: i danmark)? (?:er et krav|kraeves|er pakraevet|skal vaere pa plads|er en forudsaetning)'),
  r('da.rtw.ret', 'da', 'statement', 'right_to_work_required', 'high',
    '(?:skal have|kraever|krav om) (?:ret|tilladelse) til at arbejde i (?:danmark|eu)'),

  // ── Norwegian ───────────────────────────────────────────────────────────────────────────────
  r('no.label.sponsing', 'no', 'labelled', 'offered', 'high',
    '(?:visumsponsing|visumstotte|arbeidstillatelse)\\s*(?::|=|\\s-)\\s*(?<v>ja|nei|mulig|ikke mulig|ingen)'),
  r('no.form.trenger_du', 'no', 'form', 'right_to_work_required', 'low',
    '(?:trenger du|vil du trenge|har du behov for)[^?.\\n]{0,50}(?:visum|arbeidstillatelse|sponsing|oppholdstillatelse)[^.\\n]{0,40}\\?'),
  r('no.neg.ingen', 'no', 'negative', 'not_offered', 'high',
    '(?:ingen|intet) (?:visumsponsing|sponsing|visumstotte|hjelp med (?:visum|arbeidstillatelse))(?! (?:kreves|er nodvendig))'),
  r('no.neg.kan_ikke', 'no', 'negative', 'not_offered', 'high',
    '(?:kan|tilbyr|sponser|hjelper) (?:dessverre |for oyeblikket )?(?:ikke|ingen)[^.\\n]{0,30}(?:visum|arbeidstillatelse|sponsing|oppholdstillatelse)'),
  r('no.neg.kun_eu', 'no', 'negative', 'right_to_work_required', 'high',
    '(?:kun|bare|utelukkende) (?:for |apen for )?(?:eu-borgere|eos-borgere|eu/eos-borgere|borgere (?:fra|i) (?:eu|eos)|norske statsborgere)'),
  r('no.offer.hjelp_visum', 'no', 'statement', 'offered', 'high',
    '(?:hjelp|stotte|bistand|assistanse|(?:vi )?hjelper (?:deg |dere )?|(?:vi )?stotter (?:deg |dere )?) ?(?:med|til|ved|i) (?:ditt |din |soknad om |soknaden om |hele )?(?:visum|arbeidstillatelse|oppholdstillatelse|immigrasjon|udi-soknaden|soknadsprosessen hos udi)'),
  r('no.offer.vi_sponser', 'no', 'statement', 'offered', 'high',
    '(?:vi )?(?:sponser|tilbyr|ordner|dekker|betaler for) (?:ditt |din |et |en )?(?:visum|arbeidstillatelse|visumsponsing|oppholdstillatelse)'),
  r('no.reloc.flytte', 'no', 'statement', 'relocation', 'high',
    '(?:flyttehjelp|flyttegodtgjorelse|flyttepakke|flyttestotte|relocation[- ]?(?:pakke|stotte|hjelp))'),
  r('no.reloc.hjelp_flytting', 'no', 'statement', 'relocation', 'high',
    '(?:hjelp|stotte|bistand) (?:med|til) (?:flyttingen|flytting|relocation|a flytte)'),
  r('no.rtw.kreves', 'no', 'statement', 'right_to_work_required', 'high',
    '(?:gyldig )?(?:arbeidstillatelse|oppholds- og arbeidstillatelse)(?: i norge)? (?:er et krav|kreves|er pakrevd|ma foreligge|ma vaere pa plass|er en forutsetning)'),
  r('no.rtw.rett', 'no', 'statement', 'right_to_work_required', 'high',
    '(?:ma ha|krever|krav om) (?:rett|tillatelse) til a (?:arbeide|jobbe) i (?:norge|eu|eos)'),

  // ── Finnish ─────────────────────────────────────────────────────────────────────────────────
  r('fi.form.tarvitsetko', 'fi', 'form', 'right_to_work_required', 'low',
    '(?:tarvitsetko|tarvitsetteko|onko sinulla|onko teilla)[^?.\\n]{0,50}(?:viisum|tyolup|tyoluv|oleskelulup|oleskeluluv|sponsor)[a-z]*[^.\\n]{0,40}\\?'),
  r('fi.neg.emme_tarjoa', 'fi', 'negative', 'not_offered', 'high',
    '(?:emme|ei|eivat) (?:valitettavasti |tassa vaiheessa )?(?:tarjoa|voi tarjota|pysty tarjoamaan|sponsoroi|jarjesta|avusta|pysty avustamaan|kustanna)[^.\\n]{0,30}(?:viisum|tyolup|tyoluv|oleskelulup|oleskeluluv|sponsor)[a-z]*'),
  r('fi.neg.ei_sponsorointia', 'fi', 'negative', 'not_offered', 'high', 'ei (?:viisumi)?sponsorointia'),
  r('fi.neg.vain_eu', 'fi', 'negative', 'right_to_work_required', 'high',
    '(?:vain|ainoastaan|pelkastaan) (?:eu-kansalaiset|eu kansalaiset|eu-kansalaisille|eu-maiden kansalaiset|eu\\/eta-kansalaiset|suomen kansalaiset)'),
  r('fi.offer.autamme', 'fi', 'statement', 'offered', 'high',
    '(?:autamme|avustamme|tuemme|hoidamme|jarjestamme|tarjoamme apua|tarjoamme tukea|apua|tukea|avustusta)[^.\\n]{0,25}(?:viisum|tyolup|tyoluv|oleskelulup|oleskeluluv|maahanmuut)[a-z-]*'),
  r('fi.offer.tarjoamme', 'fi', 'statement', 'offered', 'high',
    '(?:tarjoamme|jarjestamme|kustannamme|sponsoroimme) (?:sinulle )?(?:viisumin|tyoluvan|oleskeluluvan|viisumituen|tyolupatuen|viisumisponsoroinnin)'),
  r('fi.offer.bare', 'fi', 'bare', 'offered', 'medium', '(?:viisumituki|tyolupatuki|maahanmuuttotuki|viisumisponsorointi)'),
  r('fi.reloc.muutto', 'fi', 'statement', 'relocation', 'high',
    '(?:muuttoap|muuttotu|muuttopaket|muuttokorvau|muuttoraha|relocation[- ]?(?:tu|paket|ap))[a-z]*'),
  r('fi.reloc.apua_muuttoon', 'fi', 'statement', 'relocation', 'high', '(?:apua|tukea|autamme) (?:muuttoon|muutossa|muuttamiseen|muuttamisessa)'),
  r('fi.rtw.vaaditaan', 'fi', 'statement', 'right_to_work_required', 'high',
    '(?:voimassa oleva )?(?:tyolupa|tyoskentelyoikeus|oikeus tyoskennella|tyonteko-oikeus)(?: suomessa| eu:ssa)? (?:vaaditaan|edellytetaan|on edellytys|on pakollinen|on vaatimus)'),
  r('fi.rtw.edellytamme', 'fi', 'statement', 'right_to_work_required', 'high',
    '(?:edellytamme|vaadimme|edellytetaan) (?:voimassa olevaa |voimassaolevaa )?(?:tyolupaa|tyoskentelyoikeutta|oikeutta tyoskennella|tyonteko-oikeutta)'),

  // ── Polish ──────────────────────────────────────────────────────────────────────────────────
  r('pl.form.czy', 'pl', 'form', 'right_to_work_required', 'low',
    '(?:czy (?:potrzebujesz|bedziesz potrzebowac|bedziesz potrzebowal|posiadasz|masz))[^?.\\n]{0,50}(?:wiz|sponsor|pozwoleni|zezwoleni)[a-z]*[^.\\n]{0,40}\\?'),
  r('pl.neg.nie_oferujemy', 'pl', 'negative', 'not_offered', 'high',
    'nie (?:oferujemy|zapewniamy|sponsorujemy|mozemy zaoferowac|mozemy zapewnic|pomagamy|mamy mozliwosci|oferuje|zapewnia|jestesmy w stanie (?:zapewnic|zaoferowac|sponsorowac))[^.\\n]{0,30}(?:wiz|sponsor|zezwoleni|pozwoleni|legalizacj|karty pobytu)[a-z]*'),
  r('pl.neg.brak', 'pl', 'negative', 'not_offered', 'high',
    '(?:brak|bez) (?:mozliwosci )?(?:sponsorowania|sponsoringu|sponsorowania wizy|wsparcia wizowego|sponsoringu wizy|pomocy w uzyskaniu wizy|wsparcia w legalizacji)(?! (?:jest )?(?:wymagan|potrzebn))'),
  r('pl.neg.tylko_ue', 'pl', 'negative', 'right_to_work_required', 'high',
    '(?:tylko|wylacznie|jedynie) (?:dla )?(?:obywatele|obywateli|obywatelami|kandydaci|kandydatow|osoby|osob) (?:z |ze )?(?:ue|unii europejskiej|polski|polskim obywatelstwem|obywatelstwem ue|krajow ue)'),
  r('pl.offer.pomoc_wiza', 'pl', 'statement', 'offered', 'high',
    '(?:pomoc|wsparcie|pomagamy|wspieramy|asysta|zapewniamy pomoc|zapewniamy wsparcie) (?:w |przy |z |we )?(?:uzyskaniu |zalatwieniu |procesie |uzyskiwaniu |procedurze |sprawach )?(?:wizy|wiz|wizowych|wizowym|zezwolenia na prace|pozwolenia na prace|karty pobytu|niebieskiej karty|legalizacji (?:pobytu|zatrudnienia|pracy)|formalnosciach wizowych|formalnosci wizowych|procesie wizowym|imigracyjnych)'),
  r('pl.offer.sponsorujemy', 'pl', 'statement', 'offered', 'high',
    '(?:sponsorujemy|zapewniamy|oferujemy|pokrywamy) (?:sponsoring |sponsorowanie |wsparcie |koszty )?(?:wize|wizy|wizowe|wizowy|zezwolenie na prace|pozwolenie na prace|legalizacje (?:pobytu|pracy))'),
  r('pl.offer.bare', 'pl', 'bare', 'offered', 'medium', '(?:sponsoring|sponsorowanie) (?:wizy|wiz|wizowy)'),
  r('pl.reloc.pakiet', 'pl', 'statement', 'relocation', 'high',
    '(?:pakiet|pomoc|wsparcie|dodatek|bonus|zwrot kosztow) (?:w |przy |na |za )?(?:relokacyjny|relokacyjna|relokacyjne|relokacji|relokacje|przeprowadzce|przeprowadzke|przeprowadzki)'),
  r('pl.rtw.wymagane', 'pl', 'statement', 'right_to_work_required', 'high',
    '(?:wazne |aktualne )?(?:pozwolenie|zezwolenie) na prace(?: w polsce| w ue)? (?:jest )?(?:wymagane|konieczne|niezbedne|obowiazkowe)'),
  r('pl.rtw.prawo', 'pl', 'statement', 'right_to_work_required', 'high',
    '(?:wymagane|wymagamy|konieczne|niezbedne|posiadanie|musisz posiadac|musisz miec) (?:jest )?(?:prawo|prawa|uprawnienie|uprawnien|uprawnienia|pozwolenia|zezwolenia) (?:do (?:legalnej )?pracy|na prace) (?:w (?:polsce|ue|unii europejskiej))?'),

  // ── Czech ───────────────────────────────────────────────────────────────────────────────────
  r('cs.form.potrebujete', 'cs', 'form', 'right_to_work_required', 'low',
    '(?:potrebujete|budete potrebovat|mate|potrebujes)[^?.\\n]{0,50}(?:viz|pracovni povoleni|zamestnaneck|sponzor)[a-z]*[^.\\n]{0,40}\\?'),
  r('cs.neg.nenabizime', 'cs', 'negative', 'not_offered', 'high',
    '(?:nenabizime|neposkytujeme|nezajistujeme|nesponzorujeme|nevyrizujeme|nepodporujeme|nemuzeme nabidnout|nemuzeme zajistit|nemuzeme poskytnout|nejsme schopni (?:zajistit|nabidnout|poskytnout))[^.\\n]{0,30}(?:viz|sponzor|pracovni povoleni|zamestnaneck|modrou kartu|modre karty)[a-z]*'),
  r('cs.neg.zadne', 'cs', 'negative', 'not_offered', 'high', '(?:zadne|zadny|zadnou|bez) (?:moznosti )?(?:sponzorstvi|sponzorovani|sponzoring|podpory s vizem|pomoci s vizem)'),
  r('cs.neg.pouze_eu', 'cs', 'negative', 'right_to_work_required', 'high',
    '(?:pouze|jen|vyhradne|vyhradne pro) (?:pro )?(?:obcane|obcany|kandidaty|uchazece) (?:z )?(?:eu|evropske unie|cr|ceske republiky|clenskych statu eu)'),
  r('cs.offer.pomoc_vizum', 'cs', 'statement', 'offered', 'high',
    '(?:pomoc|podpora|pomuzeme|pomahame|asistence|zajisteni|vyrizeni) (?:vam |ti )?(?:s |se |pri |v |ve )?(?:vizem|vizy|vizou|viza|pracovnim povolenim|pracovniho povoleni|zamestnaneckou kartou|zamestnanecke karty|modrou kartou|modre karty|vyrizenim viza|vyrizenim pracovniho povoleni|imigraci|imigracnim procesem|vizovym procesem)'),
  r('cs.offer.zajistime', 'cs', 'statement', 'offered', 'high',
    '(?:zajistime|zajistujeme|vyridime|vyrizujeme|sponzorujeme|nabizime|poskytujeme) (?:vam |ti )?(?:sponzorstvi |podporu (?:s |pri ) )?(?:vizum|vizo|viza|pracovni povoleni|zamestnaneckou kartu|modrou kartu|vizovou podporu)'),
  r('cs.reloc.relokace', 'cs', 'statement', 'relocation', 'high',
    '(?:relokacni (?:balicek|bonus|prispevek|podpora)|pomoc s relokaci|pomoc se stehovanim|prispevek na stehovani|podpora pri relokaci|podpora pri stehovani|pomoc pri stehovani|prispevek na relokaci)'),
  r('cs.rtw.nutne', 'cs', 'statement', 'right_to_work_required', 'high',
    '(?:platne )?pracovni povoleni(?: v cr| v ceske republice| v eu)? (?:je )?(?:nutne|nutnosti|podminkou|vyzadovano|pozadovano|nezbytne|nutnou podminkou)'),
  r('cs.rtw.opravneni', 'cs', 'statement', 'right_to_work_required', 'high',
    '(?:podminkou je |nutne je |vyzadujeme |pozadujeme )(?:pravo|opravneni|povoleni) (?:pracovat|k praci|k vykonu prace) v (?:cr|ceske republice|eu)'),
];

/**
 * Negation cues, checked in the clause BEFORE a positive hit (last few words), language-agnostic
 * because postings mix languages. A cue followed by "-" ("non-EU", "nicht-EU") does not count.
 * `weak` cues ("without", "ohne", "sans" …) turn an offer into a right-to-work requirement instead
 * of a refusal ("able to work without visa sponsorship").
 */
export const STRONG_NEGATORS: readonly string[] = [
  // en
  'no', 'not', 'never', 'cannot', 'unable', 'neither', 'nor', "[a-z]+n't", 'can not', 'no longer', 'none',
  // de
  'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines', 'keinerlei', 'nicht', 'nie', 'niemals', 'weder',
  // fr
  'pas', 'aucun', 'aucune', 'ni', 'jamais', 'ne', "n'",
  // nl
  'geen', 'niet', 'nooit',
  // es / pt / it
  'ningun', 'ninguna', 'ninguno', 'nunca', 'tampoco', 'nao', 'nenhum', 'nenhuma', 'nem', 'non', 'nessun', 'nessuna', 'nessuno',
  // sv / da / no
  'inte', 'ej', 'ingen', 'inget', 'inga', 'aldrig', 'ikke', 'intet', 'aldri',
  // fi
  'ei', 'emme', 'eivat', 'ette',
  // pl
  'brak', 'zadnego', 'zadnej', 'zadnych', 'zaden', 'zadna', 'zadne',
  // cs
  'neni', 'nelze', 'zadny', 'zadnou', 'nenabizime', 'neposkytujeme', 'nezajistujeme', 'nemuzeme', 'nesponzorujeme', 'nevyrizujeme', 'nepodporujeme', 'nejsme',
];

export const WEAK_NEGATORS: readonly string[] = [
  'without', 'ohne', 'sans', 'zonder', 'sin', 'sem', 'senza', 'utan', 'uden', 'uten', 'ilman', 'bez',
];

/** Phrases that look negative but are not ("not only", "no matter where"). Removed before the check. */
export const PSEUDO_NEGATIONS: readonly string[] = [
  'no matter', 'not only', 'not just', 'no doubt', 'no problem', 'not a problem', 'no-brainer', 'never (?:be )?an? (?:issue|problem|obstacle|barrier)',
  "(?:won't|will not|is not|isn't) (?:be )?an? (?:issue|problem|obstacle|barrier)", 'not an? (?:issue|obstacle|barrier)', 'no (?:issue|obstacle|barrier)', 'without a doubt', 'without doubt', 'no questions asked',
  'nicht nur', 'ohne zweifel', 'non seulement', 'pas seulement', 'sans doute', 'niet alleen', 'zonder twijfel', 'no solo', 'no solamente',
  'sin duda', 'nao so', 'nao apenas', 'sem duvida', 'non solo', 'senza dubbio', 'inte bara', 'inte endast', 'ikke kun', 'ikke bare',
  'ei vain', 'ei ainoastaan', 'nie tylko', 'bez watpienia', 'nejen', 'bez ohledu',
  // Equal-opportunity wording: the negation is about discrimination, never about the offer
  // ("We do not discriminate and offer visa sponsorship", "hired without regard to national origin").
  "(?:do|does|did|will|shall|would) not (?:ever )?(?:discriminat[a-z]*|tolerate|charge)", "(?:don't|doesn't|didn't|won't) (?:ever )?(?:discriminat[a-z]*|tolerate|charge)",
  'never (?:discriminat[a-z]*|tolerate|charge)', 'not (?:be )?tolerated', 'no discrimination', 'without (?:regard|distinction|discrimination|prejudice)',
  'diskriminier[a-z]* (?:nicht|niemanden|niemand)', 'keine diskriminierung', 'ohne (?:ansehen|rucksicht auf|unterschied|diskriminierung)',
  'ne discrimin[a-z]* (?:pas|aucun[a-z]*|personne)', 'sans (?:distinction|discrimination)', 'aucune discrimination',
  'discrimineren niet', 'zonder (?:onderscheid|discriminatie)', 'geen discriminatie',
  'no discrimina[a-z]*', 'sin (?:distincion|discriminacion)', 'nao discrimina[a-z]*', 'sem (?:distincao|discriminacao)',
  'non discrimin[a-z]*', 'senza (?:distinzion[ei]|discriminazion[ei])',
  'diskriminerar (?:inte|ej)', 'utan (?:diskriminering|hansyn till)', 'diskriminerer ikke', 'uden (?:diskrimination|hensyn til)', 'uten (?:diskriminering|hensyn til)',
  'ei syrji[a-z]*', 'ilman syrjintaa', 'nie dyskryminuj[a-z]*', 'bez (?:dyskryminacji|wzgledu na|diskriminace|rozdilu)',
];

/**
 * Negation right AFTER a hit ("Visa sponsorship is not available", "Visa sponsorship is something
 * we cannot offer", "Ein Visa-Sponsoring können wir leider nicht anbieten"): optionally a
 * coordinated noun ("… and relocation are not …"), up to five filler words (copulas, pronouns,
 * modals, adverbs) and then a negator. The same check runs across a label separator
 * ("Visa sponsorship - we're unable to offer this", "Visa sponsorship (not available)").
 */
export const POST_FILLERS: readonly string[] = [
  'is', 'are', 'was', 'were', 'will', 'would', 'be', 'can', 'could', 'may', 'unfortunately', 'currently', 'sadly', 'at this time', 'for this role',
  'something', 'that', 'this', 'it', 'we', "we're", "we've", 'we are', 'do', 'does', 'they', 'i', 'still', 'also', 'simply', 'sadly',
  'ist', 'sind', 'wird', 'werden', 'leider', 'derzeit', 'aktuell', 'momentan', 'hier', 'konnen', 'kann', 'durfen', 'wir', 'bieten', 'ubernehmen', 'gibt', 'es', 'ein', 'etwas',
  'est', 'sont', 'sera', 'malheureusement', 'actuellement',
  'wordt', 'worden', 'helaas', 'momenteel', 'kunnen', 'kan', 'wij', 'bieden', 'zijn',
  'es', 'esta', 'son', 'sera', 'lamentablemente', 'actualmente', 'desafortunadamente',
  'e', 'sao', 'infelizmente', 'atualmente',
  'sono', 'purtroppo', 'attualmente',
  'ar', 'tyvarr', 'er', 'desvaerre', 'dessverre', 'on', 'valitettavasti',
  'jest', 'sa', 'niestety', 'obecnie', 'je', 'jsou', 'bohuzel', 'aktualne',
];

export const POST_NEGATORS: readonly string[] = [
  'not', "[a-z]+n't", 'cannot', 'can not', 'unable', 'never', 'no longer', 'unavailable', 'impossible', 'out of scope', 'off the table', 'excluded',
  'nicht', 'kein', 'keine', 'ausgeschlossen', 'entfallt',
  'pas', "n'est pas", 'non', 'niet', 'geen', 'no', 'nao', 'inte', 'ej', 'ikke', 'ei', 'nie', 'niedostepn[a-z]*', 'neni', 'nelze',
];

/** Requirement/condition cues that make a bare mention or a right-to-work phrase non-committal. */
export const CONDITION_CUES: readonly string[] = [
  // "if you require visa sponsorship", "whether you need", "in case you need"
  'if', 'whether', 'in case', 'unless', 'should you', 'wenn', 'falls', 'sofern', 'ob', 'si', 'au cas ou', 'indien', 'mocht', 'mochten',
  'caso', 'en caso de', 'hvis', 'jos', 'jesli', 'jezeli', 'pokud', 'kdyz', 'qualora', 'nel caso',
];

export const REQUIREMENT_CUES: readonly string[] = [
  'require', 'requires', 'required', 'requiring', 'need', 'needs', 'needed', 'needing', 'eligible for', 'apply for', 'applying for',
  'benotig[a-z]*', 'brauch[a-z]*', 'besoin', 'nodig', 'necesit[a-z]*', 'precis[a-z]*', 'necessit[a-z]*', 'bisogno', 'behov[a-z]*', 'brug for',
  'trenger', 'tarvit[a-z]*', 'potrzeb[a-z]*', 'potreb[a-z]*', 'requier[a-z]*', 'requer[a-z]*', 'richied[a-z]*',
];

/** Sentence starters that make a sentence a question even without "?" (application forms). */
export const QUESTION_STARTERS: readonly string[] = [
  'will you', 'do you', 'are you', 'would you', 'have you', 'can you', 'could you', 'does your', 'is your',
  'benotigen sie', 'brauchen sie', 'haben sie', 'sind sie', 'besitzen sie', 'brauchst du', 'hast du', 'bist du', 'benotigst du',
  'avez-vous', 'aurez-vous', 'etes-vous', 'possedez-vous', 'avez vous', 'etes vous',
  'heeft u', 'heb je', 'ben je', 'bent u', 'beschikt u', 'beschik je',
  'necesitas', 'necesita usted', 'tienes', 'requieres', 'voce precisa', 'voce tem', 'precisa de', 'hai bisogno', 'possiedi', 'sei in possesso',
  'behover du', 'har du', 'trenger du', 'har du brug', 'tarvitsetko', 'onko sinulla', 'czy', 'potrebujete', 'mate',
];

/**
 * FAQ-style answers. A question about the employer's offer ("Visa sponsorship for this role?",
 * "Do you offer visa sponsorship?") answered by the very next line ("Unfortunately not.", "Yes!")
 * is read from the answer. Short answers must stand alone (followed by punctuation or the end of
 * the line), so "Yes / No" option lists and "Si necesitas …" ("if you need …") never count.
 */
export const ANSWER_YES_WORDS: readonly string[] = [
  'yes', 'yep', 'yeah', 'yup', 'sure', 'absolutely', 'definitely', 'certainly', 'of course', 'indeed',
  'ja', 'jawohl', 'naturlich', 'selbstverstandlich', 'klar', 'oui', 'bien sur', 'absolument', 'natuurlijk', 'zeker', 'jazeker',
  'si', 'claro', 'por supuesto', 'sim', 'claro que sim', 'certo', 'certamente', 'javisst', 'absolut', 'selvfolgelig', 'selvsagt',
  'kylla', 'tottakai', 'tak', 'oczywiscie', 'ano', 'samozrejme',
];

export const ANSWER_NO_WORDS: readonly string[] = [
  'no', 'nope', 'nein', 'non', 'nee', 'nej', 'nei', 'ei', 'nie', 'nao', 'ne',
];

/** "Unfortunately not.", "Leider nicht.", "Helaas niet.": a regret word, then a bare negator. */
export const ANSWER_REGRET_WORDS: readonly string[] = [
  'unfortunately', 'sadly', 'regrettably', "i'm afraid", 'i am afraid', 'sorry', 'leider', 'malheureusement', 'helaas',
  'lamentablemente', 'desafortunadamente', 'infelizmente', 'purtroppo', 'tyvarr', 'desvaerre', 'dessverre', 'valitettavasti',
  'niestety', 'bohuzel',
];

export const ANSWER_REGRET_NEGATORS: readonly string[] = [
  'not', 'no', 'nicht', 'nein', 'pas', 'non', 'niet', 'nee', 'nao', 'inte', 'nej', 'ikke', 'nei', 'ei', 'nie', 'ne',
];

/** A plain English "not …" / "we can't" answer ("Not at this time.", "We don't."). */
export const ANSWER_EN_NO_PHRASES: readonly string[] = [
  'not (?:at the moment|at this time|at present|currently|right now|for this (?:role|position|job)|possible|available|offered|anymore|any more)',
  "we (?:can't|cannot|can not|don't|do not|won't|will not|are unable|are not able|aren't able|are not|aren't)(?: (?:currently|at the moment|at this time|right now))?",
];

/** A plain English "we do" answer ("We do!", "We sure can."). */
export const ANSWER_EN_YES_PHRASES: readonly string[] = [
  'we (?:sure |certainly |absolutely |definitely )?(?:do|can|will|are)',
];

/**
 * A question with one of these is about the candidate ("Are you seeking visa sponsorship?"), not
 * the employer's offer: it is never read from an answer.
 */
export const CANDIDATE_QUESTION_CUES: readonly string[] = [
  'you', 'your', "you're", 'yourself', 'looking for', 'seeking', 'searching for', 'in need of', 'interested in', 'hoping for',
  'du', 'dich', 'dir', 'dein', 'deine', 'suchst', 'suchen sie', 'vous', 'votre', 'cherchez', 'jij', 'jouw', 'zoek je', 'zoekt u',
  'usted', 'buscas', 'voce', 'procura', 'cerchi', 'tu', 'dig', 'din', 'soker du', 'sinulla', 'sinun', 'szukasz', 'hledate',
];

/** …unless the question asks whether the employer offers it ("Do you offer visa sponsorship?"). */
export const EMPLOYER_QUESTION_CUES: readonly string[] = [
  '(?:you|u|sie|vous|ihr|je|jullie) (?:currently |also |still |ever |actually )?(?:offer|provide|sponsor|support|help with|cover|include|arrange|bieten|sponsern|unterstutzen|ubernehmen|offrez|proposez|parrainez|bieden|sponsoren|ondersteunen)',
  'is (?:there )?(?:any )?(?:visa |work permit |immigration )?(?:sponsorship|support)', 'available', 'possible', 'offered', 'provided', 'included',
  'moglich', 'angeboten', 'disponible', 'mogelijk', 'posible', 'possivel', 'possibile', 'mojligt', 'muligt', 'mulig',
];

/**
 * Hedges that turn an offer into a maybe ("may be available for exceptional candidates", "case by
 * case", "nach Absprache"). A hedged offer keeps the signal but drops to low confidence, which the
 * decision engine reads as "likely", never "confirmed".
 */
export const HEDGE_CUES: readonly string[] = [
  'may(?! (?:also |still )?apply)', 'might', 'possibly', 'potentially', 'case by case', 'case-by-case', 'in some cases', 'in certain cases', 'depending on', 'depends on',
  'subject to', 'for exceptional', 'can be discussed', 'could be', 'under certain conditions', 'where possible',
  'if applicable', 'on request', 'upon request', 'negotiable',
  'eventuell', 'moglicherweise', 'unter umstanden', 'nach absprache', 'auf anfrage', 'im einzelfall', 'je nach',
  'eventuellement', 'selon le profil', 'selon profil', 'au cas par cas', 'sous conditions', 'eventueel', 'in overleg', 'afhankelijk van',
  'segun perfil', 'segun el perfil', 'dependiendo', 'a valorar', 'eventualmente', 'dependendo', 'a combinar', 'da valutare', 'in base al profilo',
  'eventuellt', 'beroende pa', 'eventuelt', 'afhaengigt af', 'avhengig av', 'mahdollisesti', 'tapauskohtaisesti', 'w zaleznosci od', 'ewentualnie',
  'v zavislosti na', 'pripadne',
];

/**
 * Section headings / inline labels that make a bare mention a benefit ("Benefits:", "What we
 * offer", "Wir bieten") or a job duty / requirement ("Responsibilities", "Your profile"). Matched
 * at the start of a line (bullets stripped), followed by ":" / "-" or the end of the line.
 */
export const BENEFIT_HEADINGS: readonly string[] = [
  'benefits', 'our benefits', 'perks', 'perks and benefits', 'perks & benefits', 'benefits and perks', 'benefits & perks', 'what we offer', 'we offer',
  'our offer', 'what we provide', 'we provide', 'what you get', "what you'll get", 'what you will get', "what's in it for you", 'what is in it for you',
  'why join us', 'why us', 'why you will love working here', 'compensation and benefits', 'compensation & benefits', 'package', 'the package', 'our package',
  'you get', "you'll get", 'you will get', 'what we can offer', 'what can we offer', 'what can you expect', 'what you can expect',
  'wir bieten', 'was wir bieten', 'das bieten wir', 'das bieten wir dir', 'das bieten wir ihnen', 'unser angebot', 'deine vorteile', 'ihre vorteile', 'vorteile', 'deine benefits', 'ihre benefits',
  'nous offrons', 'nous proposons', 'ce que nous offrons', 'ce que nous proposons', 'avantages', 'nos avantages', 'vos avantages',
  'wij bieden', 'wat wij bieden', 'wat bieden wij', 'wat bieden we', 'ons aanbod', 'arbeidsvoorwaarden', 'wat we bieden',
  'ofrecemos', 'que ofrecemos', 'beneficios', 'te ofrecemos', 'oferecemos', 'o que oferecemos', 'offriamo', 'cosa offriamo', 'vantaggi', 'benefit',
  'vi erbjuder', 'formaner', 'vi tilbyder', 'fordele', 'vi tilbyr', 'fordeler', 'goder', 'tarjoamme', 'edut', 'tarjoamme sinulle',
  'oferujemy', 'benefity', 'co oferujemy', 'nabizime', 'co nabizime', 'co ti nabizime',
];

export const DUTY_HEADINGS: readonly string[] = [
  'responsibilities', 'your responsibilities', 'key responsibilities', 'main responsibilities', 'duties', 'your duties', 'tasks', 'your tasks',
  'what you will do', "what you'll do", 'what you will be doing', "what you'll be doing", 'your role', 'the role', 'role', 'your mission', 'about the role',
  'requirements', 'qualifications', 'what you bring', "what you'll bring", 'what we are looking for', "what we're looking for", 'about you', 'your profile',
  'profile', 'skills', 'must have', 'must-have', 'nice to have', 'nice-to-have', 'who you are', 'you have', 'experience',
  'aufgaben', 'deine aufgaben', 'ihre aufgaben', 'dein profil', 'ihr profil', 'anforderungen', 'qualifikationen', 'das bringst du mit', 'das bringen sie mit', 'deine rolle',
  'missions', 'vos missions', 'votre mission', 'profil recherche', 'votre profil', 'taken', 'jouw taken', 'jouw profiel', 'functie-eisen', 'wat ga je doen', 'wie ben jij',
  'responsabilidades', 'requisitos', 'tu perfil', 'funciones', 'responsabilita', 'requisiti', 'mansioni', 'il tuo profilo',
  'arbetsuppgifter', 'kvalifikationer', 'arbejdsopgaver', 'kvalifikasjoner', 'arbeidsoppgaver', 'tehtavat', 'vaatimukset', 'obowiazki', 'wymagania', 'napln prace', 'pozadujeme',
];

/**
 * Job-duty context before a hit: the posting talks about visa work as part of the job or the
 * product ("you will manage visa sponsorship", "experience with immigration support", "our
 * platform automates visa sponsorship"), not about what the employer offers. Always applies.
 */
export const DUTY_CUES: readonly string[] = [
  'experience (?:with|in|of|handling|managing)', 'hands-on experience', 'knowledge (?:of|in|about)', 'familiar(?:ity)? with', 'understanding of', 'expertise in', 'background in',
  'responsible for', 'responsibilities', 'accountable for', 'automat[a-z]*', 'streamlin[a-z]*', 'digitali[sz][a-z]*', 'simplif(?:y|ies|ying)',
  'helps? (?:companies|businesses|employers|clients|customers|organi[sz]ations|hr teams|teams|people)', 'helping (?:companies|businesses|employers|clients|customers|organi[sz]ations|hr teams|teams|people)',
  'our (?:product|platform|software|app|solution|tool|customers|clients)', 'for (?:our )?(?:clients|customers|employers)',
  'erfahrung (?:mit|im|in|bei)', 'kenntnisse (?:im|in|uber|von|der|des)', 'verantwortlich fur', 'verantwortung fur', 'zustandig fur',
  'experience (?:en|avec|dans)', 'connaissances? (?:de|des|en)', 'responsable de', 'ervaring (?:met|in)', 'kennis van', 'verantwoordelijk voor',
  'experiencia (?:en|con)', 'conocimientos? de', 'experiencia (?:em|com)', 'conhecimentos? de', 'responsavel por', 'esperienza (?:in|con|nella|nel|di)', 'conoscenza (?:di|della|del)',
  'erfarenhet av', 'kunskap om', 'erfaring med', 'kendskab til', 'kokemusta', 'doswiadczenie w', 'znajomosc', 'zkusenost[a-z]* s',
];

/**
 * Duty verbs ("coordinate visa sponsorship"): a duty only when the employer is not the subject
 * ("we manage your visa sponsorship" stays an offer; see EMPLOYER_SUBJECTS).
 */
export const DUTY_VERBS: readonly string[] = [
  'manage', 'managing', 'coordinate', 'coordinating', 'oversee', 'overseeing', 'administer', 'administering', 'own', 'owning', 'run', 'running',
  'handle', 'handling', 'arrange', 'arranging', 'advise on', 'advising on', 'process', 'processing', 'track', 'tracking', 'liaise', 'liaising',
  'prepare', 'preparing', 'drive', 'driving', 'deliver', 'delivering', 'support our', 'supporting our',
  'koordinierst', 'koordinieren', 'verwaltest', 'betreust', 'bearbeitest', 'gerez', 'coordonnez', 'coordineer', 'beheer', 'gestionar', 'coordinar', 'gerir', 'gestire', 'coordinare',
];

/** The employer as the subject ("we", "our team", "wir" …): duty verbs then describe an offer. */
export const EMPLOYER_SUBJECTS: readonly string[] = [
  'we', "we'll", "we're", 'our team', 'our people team', 'our hr team', 'the company', 'our company', 'wir', 'nous', 'wij', 'we zullen', 'nosotros', 'nos', 'noi', 'vi', 'me', 'my',
];

/**
 * The candidate / role as the subject ("you will …", "the role involves …"): what follows is a
 * duty unless it is a benefit verb ("you will get", "you'll receive", "du erhältst").
 */
export const DUTY_SUBJECTS: readonly string[] = [
  'you will', "you'll", 'you would', "you'd", 'you are going to', 'the candidate will', 'the successful candidate will', 'this role involves', 'the role involves',
  'du wirst', 'sie werden', 'vous allez', 'vous serez', 'je gaat', 'je zal', 'u gaat',
];

export const BENEFIT_VERBS: readonly string[] = [
  'get', 'receive', 'enjoy', 'benefit from', 'have access to', 'be offered', 'be provided with', 'be eligible for', 'be supported', 'be given', 'be sponsored', 'also get', 'also receive',
  'erhaltst', 'erhalten', 'bekommst', 'bekommen', 'profitierst', 'profitieren', 'beneficierez', 'recevrez', 'krijg', 'krijgt', 'ontvang', 'ontvangt',
];

/** Words after a bare hit that make it a topic, not an offer ("visa sponsorship processes", "… is a plus"). */
export const POST_DUTY_CUES: readonly string[] = [
  'process', 'processes', 'procedures?', 'rules', 'regulations?', 'laws?', 'legislation', 'compliance', 'cases?', 'casework', 'specialists?', 'advisors?', 'advisers?',
  'consultants?', 'experts?', 'platform', 'software', 'tools?', 'workflows?', 'requests', 'is a plus', 'would be a plus', 'a plus', 'is an advantage', 'an advantage',
  'experience', 'knowledge', 'for (?:our )?(?:employers|companies|clients|customers|businesses)',
  'prozesse', 'prozess', 'erfahrung', 'kenntnisse', 'von vorteil', 'wunschenswert', 'est un plus', 'un plus', 'is een pre', 'een pluspunt', 'es un plus', 'valorable', 'e um diferencial', 'costituisce un plus',
];

/** Offer verbs before a bare hit in the same clause ("we provide relocation support and visa sponsorship"). */
export const OFFER_VERBS: readonly string[] = [
  'offer', 'offers', 'offering', 'provide', 'provides', 'providing', 'include', 'includes', 'including', 'cover', 'covers', 'covering', 'plus', 'enjoy',
  'receive', "you(?:'ll| will)? get", 'supported with', 'support with', 'help with', 'assistance with', 'we help with', 'we (?:handle|arrange|manage|organi[sz]e|sort out|pay for|take care of)', 'take care of', 'full',
  'bieten', 'bietet', 'anbieten', 'ubernehmen', 'inklusive', 'inkl', 'offrons', 'proposons', 'fournissons', 'incluant', 'bieden', 'inclusief',
  'ofrecemos', 'ofrece', 'incluye', 'oferecemos', 'oferece', 'inclui', 'offriamo', 'forniamo', 'incluso', 'erbjuder', 'tilbyder', 'tilbyr', 'tarjoamme',
  'oferujemy', 'zapewniamy', 'nabizime', 'poskytujeme',
];

/** Words right after a bare hit that make it an offer ("Visa-Unterstützung inklusive", "visa support included"). */
export const POST_BENEFIT_CUES: readonly string[] = [
  'included', 'inclusive', 'provided', 'offered', 'available', 'guaranteed', 'on us', 'covered', 'paid', 'for you', 'for the right candidate', 'for successful candidates',
  'inklusive', 'inbegriffen', 'moglich', 'vorhanden', 'angeboten', 'garantiert', 'inclus', 'incluse', 'inbegrepen', 'incluido', 'incluida', 'incluso', 'incluido', 'inclusa', 'ingar', 'inkluderet', 'inkludert', 'sisaltyy',
];

/** Values of `labelled` rules that mean "yes". Everything else matched by the rule means "no". */
export const LABEL_POSITIVE_RE =
  /^(?:yes|available|provided|possible|offered|supported|true|included|ja|moglich|vorhanden|oui|disponible|mogelijk|si|sim|disponivel|possivel|disponibile|possibile|mojligt|muligt|mulig)$/;
