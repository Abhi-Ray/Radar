/** Drizzle relational-query metadata (db.query.*.findMany({ with: … })). No DDL effect. */
import { relations } from 'drizzle-orm';
import { accuracyRuns, goldenSamples, spotChecks } from './accuracy';
import { aiQueue } from './ai';
import { companies, companyAliases, companyEvidence, sponsorRegisterEntries } from './companies';
import { countries, officialPageWatches, visaRoutes, visaRuleChanges, visaRuleVersions } from './geo';
import {
  corrections,
  duplicateCandidates,
  jobChanges,
  jobFacts,
  jobOverrides,
  jobScores,
  jobSources,
  jobs,
  linkChecks,
  titleReviewQueue,
} from './jobs';
import { deadLetters, pipelineRuns, rawSnapshots } from './pipeline';
import { sourcePlatforms, sourceRuns, sources } from './sources';
import { applicationEvents, applicationSnapshots, applications, reminders, resumeVersions, templates } from './tracker';

// ---- geo / visa
export const countriesRelations = relations(countries, ({ many }) => ({
  visaRoutes: many(visaRoutes),
  jobs: many(jobs),
  sources: many(sources),
  templates: many(templates),
}));

export const visaRoutesRelations = relations(visaRoutes, ({ one, many }) => ({
  country: one(countries, { fields: [visaRoutes.countryIso2], references: [countries.iso2] }),
  ruleVersions: many(visaRuleVersions),
  changes: many(visaRuleChanges),
  pageWatches: many(officialPageWatches),
}));

export const visaRuleVersionsRelations = relations(visaRuleVersions, ({ one }) => ({
  route: one(visaRoutes, { fields: [visaRuleVersions.routeId], references: [visaRoutes.id] }),
}));

export const visaRuleChangesRelations = relations(visaRuleChanges, ({ one }) => ({
  route: one(visaRoutes, { fields: [visaRuleChanges.routeId], references: [visaRoutes.id] }),
  ruleVersion: one(visaRuleVersions, { fields: [visaRuleChanges.ruleVersionId], references: [visaRuleVersions.id] }),
}));

export const officialPageWatchesRelations = relations(officialPageWatches, ({ one }) => ({
  route: one(visaRoutes, { fields: [officialPageWatches.routeId], references: [visaRoutes.id] }),
}));

// ---- sources / pipeline
export const sourcePlatformsRelations = relations(sourcePlatforms, ({ many }) => ({
  sources: many(sources),
}));

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  platform: one(sourcePlatforms, { fields: [sources.platformKey], references: [sourcePlatforms.key] }),
  country: one(countries, { fields: [sources.countryIso2], references: [countries.iso2] }),
  company: one(companies, { fields: [sources.companyId], references: [companies.id] }),
  runs: many(sourceRuns),
  jobSources: many(jobSources),
  rawSnapshots: many(rawSnapshots),
  deadLetters: many(deadLetters),
}));

export const pipelineRunsRelations = relations(pipelineRuns, ({ many }) => ({
  sourceRuns: many(sourceRuns),
  deadLetters: many(deadLetters),
}));

export const sourceRunsRelations = relations(sourceRuns, ({ one }) => ({
  run: one(pipelineRuns, { fields: [sourceRuns.runId], references: [pipelineRuns.id] }),
  source: one(sources, { fields: [sourceRuns.sourceId], references: [sources.id] }),
}));

export const rawSnapshotsRelations = relations(rawSnapshots, ({ one }) => ({
  source: one(sources, { fields: [rawSnapshots.sourceId], references: [sources.id] }),
  run: one(pipelineRuns, { fields: [rawSnapshots.runId], references: [pipelineRuns.id] }),
}));

export const deadLettersRelations = relations(deadLetters, ({ one }) => ({
  source: one(sources, { fields: [deadLetters.sourceId], references: [sources.id] }),
  run: one(pipelineRuns, { fields: [deadLetters.runId], references: [pipelineRuns.id] }),
  rawSnapshot: one(rawSnapshots, { fields: [deadLetters.rawSnapshotId], references: [rawSnapshots.id] }),
}));

// ---- companies
export const companiesRelations = relations(companies, ({ one, many }) => ({
  parent: one(companies, {
    fields: [companies.parentCompanyId],
    references: [companies.id],
    relationName: 'company_parent',
  }),
  children: many(companies, { relationName: 'company_parent' }),
  mergedInto: one(companies, {
    fields: [companies.mergedIntoId],
    references: [companies.id],
    relationName: 'company_merged_into',
  }),
  mergedFrom: many(companies, { relationName: 'company_merged_into' }),
  aliases: many(companyAliases),
  evidence: many(companyEvidence),
  jobs: many(jobs),
}));

export const companyAliasesRelations = relations(companyAliases, ({ one }) => ({
  company: one(companies, { fields: [companyAliases.companyId], references: [companies.id] }),
}));

export const companyEvidenceRelations = relations(companyEvidence, ({ one }) => ({
  company: one(companies, { fields: [companyEvidence.companyId], references: [companies.id] }),
  registerEntry: one(sponsorRegisterEntries, {
    fields: [companyEvidence.registerEntryId],
    references: [sponsorRegisterEntries.id],
  }),
}));

export const sponsorRegisterEntriesRelations = relations(sponsorRegisterEntries, ({ many }) => ({
  evidence: many(companyEvidence),
}));

// ---- jobs
export const jobsRelations = relations(jobs, ({ one, many }) => ({
  company: one(companies, { fields: [jobs.companyId], references: [companies.id] }),
  country: one(countries, { fields: [jobs.countryIso2], references: [countries.iso2] }),
  bestSource: one(sources, { fields: [jobs.bestSourceId], references: [sources.id] }),
  mergedInto: one(jobs, { fields: [jobs.mergedIntoJobId], references: [jobs.id], relationName: 'job_merged_into' }),
  mergedFrom: many(jobs, { relationName: 'job_merged_into' }),
  sources: many(jobSources),
  facts: many(jobFacts),
  changes: many(jobChanges),
  scores: many(jobScores),
  overrides: many(jobOverrides),
  corrections: many(corrections),
  linkChecks: many(linkChecks),
  applications: many(applications),
  aiQueue: many(aiQueue),
}));

export const jobSourcesRelations = relations(jobSources, ({ one }) => ({
  job: one(jobs, { fields: [jobSources.jobId], references: [jobs.id] }),
  source: one(sources, { fields: [jobSources.sourceId], references: [sources.id] }),
  rawSnapshot: one(rawSnapshots, { fields: [jobSources.rawSnapshotId], references: [rawSnapshots.id] }),
}));

export const jobFactsRelations = relations(jobFacts, ({ one }) => ({
  job: one(jobs, { fields: [jobFacts.jobId], references: [jobs.id] }),
}));

export const jobChangesRelations = relations(jobChanges, ({ one }) => ({
  job: one(jobs, { fields: [jobChanges.jobId], references: [jobs.id] }),
  run: one(pipelineRuns, { fields: [jobChanges.runId], references: [pipelineRuns.id] }),
}));

export const jobScoresRelations = relations(jobScores, ({ one }) => ({
  job: one(jobs, { fields: [jobScores.jobId], references: [jobs.id] }),
}));

export const jobOverridesRelations = relations(jobOverrides, ({ one }) => ({
  job: one(jobs, { fields: [jobOverrides.jobId], references: [jobs.id] }),
}));

export const correctionsRelations = relations(corrections, ({ one }) => ({
  job: one(jobs, { fields: [corrections.jobId], references: [jobs.id] }),
  goldenSample: one(goldenSamples, { fields: [corrections.goldenSampleId], references: [goldenSamples.id] }),
}));

export const duplicateCandidatesRelations = relations(duplicateCandidates, ({ one }) => ({
  jobA: one(jobs, { fields: [duplicateCandidates.jobA], references: [jobs.id], relationName: 'duplicate_job_a' }),
  jobB: one(jobs, { fields: [duplicateCandidates.jobB], references: [jobs.id], relationName: 'duplicate_job_b' }),
}));

export const titleReviewQueueRelations = relations(titleReviewQueue, ({ one }) => ({
  sampleJob: one(jobs, { fields: [titleReviewQueue.sampleJobId], references: [jobs.id] }),
}));

export const linkChecksRelations = relations(linkChecks, ({ one }) => ({
  job: one(jobs, { fields: [linkChecks.jobId], references: [jobs.id] }),
}));

// ---- accuracy
export const goldenSamplesRelations = relations(goldenSamples, ({ one, many }) => ({
  job: one(jobs, { fields: [goldenSamples.jobId], references: [jobs.id] }),
  corrections: many(corrections),
}));

export const accuracyRunsRelations = relations(accuracyRuns, ({ one }) => ({
  comparedTo: one(accuracyRuns, { fields: [accuracyRuns.comparedToRunId], references: [accuracyRuns.id] }),
}));

export const spotChecksRelations = relations(spotChecks, ({ one }) => ({
  job: one(jobs, { fields: [spotChecks.jobId], references: [jobs.id] }),
  source: one(sources, { fields: [spotChecks.sourceId], references: [sources.id] }),
}));

// ---- ai
export const aiQueueRelations = relations(aiQueue, ({ one }) => ({
  job: one(jobs, { fields: [aiQueue.jobId], references: [jobs.id] }),
}));

// ---- tracker
export const resumeVersionsRelations = relations(resumeVersions, ({ many }) => ({
  applications: many(applications),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  job: one(jobs, { fields: [applications.jobId], references: [jobs.id] }),
  country: one(countries, { fields: [applications.countryIso2], references: [countries.iso2] }),
  resumeVersion: one(resumeVersions, { fields: [applications.resumeVersionId], references: [resumeVersions.id] }),
  events: many(applicationEvents),
  snapshots: many(applicationSnapshots),
  reminders: many(reminders),
}));

export const applicationEventsRelations = relations(applicationEvents, ({ one }) => ({
  application: one(applications, { fields: [applicationEvents.applicationId], references: [applications.id] }),
}));

export const applicationSnapshotsRelations = relations(applicationSnapshots, ({ one }) => ({
  application: one(applications, { fields: [applicationSnapshots.applicationId], references: [applications.id] }),
}));

export const templatesRelations = relations(templates, ({ one }) => ({
  country: one(countries, { fields: [templates.countryIso2], references: [countries.iso2] }),
}));

export const remindersRelations = relations(reminders, ({ one }) => ({
  application: one(applications, { fields: [reminders.applicationId], references: [applications.id] }),
}));
