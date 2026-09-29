/**
 * The complete RADAR schema. Import tables from here (`@/db/schema`), never from the individual
 * files, so drizzle's relational queries see every table + relation.
 *
 * Naming: `XxxRow` = selected row type, `NewXxx` = insert type.
 */
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as accuracy from './accuracy';
import * as ai from './ai';
import * as auth from './auth';
import * as companiesSchema from './companies';
import * as geo from './geo';
import * as jobsSchema from './jobs';
import * as pipeline from './pipeline';
import * as sourcesSchema from './sources';
import * as tracker from './tracker';

export * from './_enums';
export * from './accuracy';
export * from './ai';
export * from './auth';
export * from './companies';
export * from './geo';
export * from './jobs';
export * from './pipeline';
export * from './relations';
export * from './sources';
export * from './tracker';

// ---- auth / ops
export type SessionRow = InferSelectModel<typeof auth.sessions>;
export type NewSession = InferInsertModel<typeof auth.sessions>;
export type LoginAttemptRow = InferSelectModel<typeof auth.loginAttempts>;
export type NewLoginAttempt = InferInsertModel<typeof auth.loginAttempts>;
export type AuditLogRow = InferSelectModel<typeof auth.auditLog>;
export type NewAuditLog = InferInsertModel<typeof auth.auditLog>;
export type SettingRow = InferSelectModel<typeof auth.settings>;
export type NewSetting = InferInsertModel<typeof auth.settings>;
export type AlertRow = InferSelectModel<typeof auth.alerts>;
export type NewAlert = InferInsertModel<typeof auth.alerts>;
export type BackupRunRow = InferSelectModel<typeof auth.backupRuns>;
export type NewBackupRun = InferInsertModel<typeof auth.backupRuns>;

// ---- geo / visa
export type CountryRow = InferSelectModel<typeof geo.countries>;
export type NewCountry = InferInsertModel<typeof geo.countries>;
export type VisaRouteRow = InferSelectModel<typeof geo.visaRoutes>;
export type NewVisaRoute = InferInsertModel<typeof geo.visaRoutes>;
export type VisaRuleVersionRow = InferSelectModel<typeof geo.visaRuleVersions>;
export type NewVisaRuleVersion = InferInsertModel<typeof geo.visaRuleVersions>;
export type VisaRuleChangeRow = InferSelectModel<typeof geo.visaRuleChanges>;
export type NewVisaRuleChange = InferInsertModel<typeof geo.visaRuleChanges>;
export type OfficialPageWatchRow = InferSelectModel<typeof geo.officialPageWatches>;
export type NewOfficialPageWatch = InferInsertModel<typeof geo.officialPageWatches>;

// ---- sources / pipeline
export type SourcePlatformRow = InferSelectModel<typeof sourcesSchema.sourcePlatforms>;
export type NewSourcePlatform = InferInsertModel<typeof sourcesSchema.sourcePlatforms>;
export type SourceRow = InferSelectModel<typeof sourcesSchema.sources>;
export type NewSource = InferInsertModel<typeof sourcesSchema.sources>;
export type SourceRunRow = InferSelectModel<typeof sourcesSchema.sourceRuns>;
export type NewSourceRun = InferInsertModel<typeof sourcesSchema.sourceRuns>;
export type PipelineRunRow = InferSelectModel<typeof pipeline.pipelineRuns>;
export type NewPipelineRun = InferInsertModel<typeof pipeline.pipelineRuns>;
export type PipelineLockRow = InferSelectModel<typeof pipeline.pipelineLock>;
export type RawSnapshotRow = InferSelectModel<typeof pipeline.rawSnapshots>;
export type NewRawSnapshot = InferInsertModel<typeof pipeline.rawSnapshots>;
export type DeadLetterRow = InferSelectModel<typeof pipeline.deadLetters>;
export type NewDeadLetter = InferInsertModel<typeof pipeline.deadLetters>;

// ---- companies
export type CompanyRow = InferSelectModel<typeof companiesSchema.companies>;
export type NewCompany = InferInsertModel<typeof companiesSchema.companies>;
export type CompanyAliasRow = InferSelectModel<typeof companiesSchema.companyAliases>;
export type NewCompanyAlias = InferInsertModel<typeof companiesSchema.companyAliases>;
export type SponsorRegisterEntryRow = InferSelectModel<typeof companiesSchema.sponsorRegisterEntries>;
export type NewSponsorRegisterEntry = InferInsertModel<typeof companiesSchema.sponsorRegisterEntries>;
export type CompanyEvidenceRow = InferSelectModel<typeof companiesSchema.companyEvidence>;
export type NewCompanyEvidence = InferInsertModel<typeof companiesSchema.companyEvidence>;

// ---- jobs
export type JobRow = InferSelectModel<typeof jobsSchema.jobs>;
export type NewJob = InferInsertModel<typeof jobsSchema.jobs>;
export type JobSourceRow = InferSelectModel<typeof jobsSchema.jobSources>;
export type NewJobSource = InferInsertModel<typeof jobsSchema.jobSources>;
export type JobFactRow = InferSelectModel<typeof jobsSchema.jobFacts>;
export type NewJobFact = InferInsertModel<typeof jobsSchema.jobFacts>;
export type JobChangeRow = InferSelectModel<typeof jobsSchema.jobChanges>;
export type NewJobChange = InferInsertModel<typeof jobsSchema.jobChanges>;
export type JobScoreRow = InferSelectModel<typeof jobsSchema.jobScores>;
export type NewJobScore = InferInsertModel<typeof jobsSchema.jobScores>;
export type DuplicateCandidateRow = InferSelectModel<typeof jobsSchema.duplicateCandidates>;
export type NewDuplicateCandidate = InferInsertModel<typeof jobsSchema.duplicateCandidates>;
export type JobOverrideRow = InferSelectModel<typeof jobsSchema.jobOverrides>;
export type NewJobOverride = InferInsertModel<typeof jobsSchema.jobOverrides>;
export type CorrectionRow = InferSelectModel<typeof jobsSchema.corrections>;
export type NewCorrection = InferInsertModel<typeof jobsSchema.corrections>;
export type TitleReviewRow = InferSelectModel<typeof jobsSchema.titleReviewQueue>;
export type NewTitleReview = InferInsertModel<typeof jobsSchema.titleReviewQueue>;
export type LinkCheckRow = InferSelectModel<typeof jobsSchema.linkChecks>;
export type NewLinkCheck = InferInsertModel<typeof jobsSchema.linkChecks>;

// ---- accuracy
export type GoldenSampleRow = InferSelectModel<typeof accuracy.goldenSamples>;
export type NewGoldenSample = InferInsertModel<typeof accuracy.goldenSamples>;
export type AccuracyRunRow = InferSelectModel<typeof accuracy.accuracyRuns>;
export type NewAccuracyRun = InferInsertModel<typeof accuracy.accuracyRuns>;
export type SpotCheckRow = InferSelectModel<typeof accuracy.spotChecks>;
export type NewSpotCheck = InferInsertModel<typeof accuracy.spotChecks>;

// ---- ai
export type AiUsageRow = InferSelectModel<typeof ai.aiUsage>;
export type NewAiUsage = InferInsertModel<typeof ai.aiUsage>;
export type AiCallRow = InferSelectModel<typeof ai.aiCalls>;
export type NewAiCall = InferInsertModel<typeof ai.aiCalls>;
export type AiCacheRow = InferSelectModel<typeof ai.aiCache>;
export type NewAiCache = InferInsertModel<typeof ai.aiCache>;
export type AiQueueRow = InferSelectModel<typeof ai.aiQueue>;
export type NewAiQueue = InferInsertModel<typeof ai.aiQueue>;

// ---- tracker
export type ApplicationRow = InferSelectModel<typeof tracker.applications>;
export type NewApplication = InferInsertModel<typeof tracker.applications>;
export type ApplicationEventRow = InferSelectModel<typeof tracker.applicationEvents>;
export type NewApplicationEvent = InferInsertModel<typeof tracker.applicationEvents>;
export type ApplicationSnapshotRow = InferSelectModel<typeof tracker.applicationSnapshots>;
export type NewApplicationSnapshot = InferInsertModel<typeof tracker.applicationSnapshots>;
export type ResumeVersionRow = InferSelectModel<typeof tracker.resumeVersions>;
export type NewResumeVersion = InferInsertModel<typeof tracker.resumeVersions>;
export type TemplateRow = InferSelectModel<typeof tracker.templates>;
export type NewTemplate = InferInsertModel<typeof tracker.templates>;
export type ReminderRow = InferSelectModel<typeof tracker.reminders>;
export type NewReminder = InferInsertModel<typeof tracker.reminders>;
