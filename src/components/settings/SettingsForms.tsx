"use client";

import { useState, type ReactNode } from "react";
import { InlineError, useKeepValuesAction } from "@/components/tracker/action-hooks";
import { Field, Input, Select, SubmitButton, Textarea, cn } from "@/components/ui";
import { saveSettingsAction } from "@/lib/actions/settings";
import { COMPANY_TYPES_LIST, COMPANY_TYPE_LABEL, COUNTRY_TIERS, TARGETABLE_ROLES, TARGET_FAMILIES, TARGET_FAMILY_LABEL, TIERED_COUNTRY_CODES, familyOf } from "./options";
import { WEIGHTS_TOTAL, WEIGHT_LABELS, roleFieldName, weightFieldName, weightsTotal } from "./forms";
import { SCORE_COMPONENT_KEYS, type AiSettings, type AlertSettings, type Profile, type RetentionSettings, type ScoreWeights } from "@/lib/contracts/settings";

function Shell({ section, version, submit, children }: { section: string; version: number; submit: string; children: (extra: ReactNode) => ReactNode }) {
  const { state, onSubmit, formKey } = useKeepValuesAction(saveSettingsAction);
  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="version" value={version} />
      {children(null)}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="primary" icon="check" pendingLabel="Saving…">
          {submit}
        </SubmitButton>
        <InlineError state={state} />
      </div>
    </form>
  );
}

const box = "flex min-h-11 items-center gap-2 border-3 border-ink bg-card px-3 text-sm font-bold";
const check = "size-5 shrink-0 accent-ink";

function Group({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-3 border-ink bg-paper/60 p-4">
      <legend className="micro bg-ink px-2 py-0.5 text-paper">{legend}</legend>
      {hint ? <p className="text-sm text-ink-soft">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

function Num({ label, name, value, step = 1, min, max, hint }: { label: string; name: string; value: number; step?: number | "any"; min?: number; max?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(p) => <Input {...p} type="number" inputMode="decimal" name={name} defaultValue={value} step={step} min={min} max={max} />}
    </Field>
  );
}

export function ProfileForm({ profile, version, countryNames }: { profile: Profile; version: number; countryNames: Record<string, string> }) {
  const extra = profile.targetCountries.filter((c) => !TIERED_COUNTRY_CODES.has(c));
  const eb = profile.experienceBand;
  return (
    <Shell section="profile" version={version} submit="Save profile">
      {() => (
        <>
          <Group legend="You" hint="Visa rules are evaluated for this passport and degree level; the salary floor lowers the score of jobs that state less.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Passport (ISO)" required>{(p) => <Input {...p} name="passport" defaultValue={profile.passport} maxLength={2} className="uppercase" autoComplete="off" />}</Field>
              <Field label="Degree" required>{(p) => <Input {...p} name="degree" defaultValue={profile.degree} maxLength={120} autoComplete="off" />}</Field>
              <Field label="Degree level" required>
                {(p) => <Select {...p} name="degreeLevel" defaultValue={profile.degreeLevel} options={[{ value: "none", label: "None" }, { value: "bachelor", label: "Bachelor" }, { value: "master", label: "Master" }, { value: "phd", label: "PhD" }]} />}
              </Field>
              <Num label="Years of experience" name="yearsTotal" value={profile.yearsTotal} step="any" min={0} max={40} />
              <Num label="Years in cloud" name="yearsCloud" value={profile.yearsCloud} step="any" min={0} max={40} />
              <Num label="Expected salary (€/yr)" name="expectedSalaryEur" value={profile.expectedSalaryEur} step={1000} min={0} />
              <Num label="Salary floor (€/yr)" name="salaryFloorEur" value={profile.salaryFloorEur} step={1000} min={0} />
            </div>
          </Group>

          <Group legend="Experience bands" hint="Years asked in a posting. Core = ideal, show = still worth seeing, outside hide-below/above = hidden (with a counter, never silently).">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Num label="Core from" name="coreLow" value={eb.core[0]} step="any" min={0} max={40} />
              <Num label="Core to" name="coreHigh" value={eb.core[1]} step="any" min={0} max={40} />
              <Num label="Show from" name="showLow" value={eb.show[0]} step="any" min={0} max={40} />
              <Num label="Show to" name="showHigh" value={eb.show[1]} step="any" min={0} max={40} />
              <Num label="Hide below" name="hideBelow" value={eb.hideBelow} step="any" min={0} max={40} />
              <Num label="Hide at or above" name="hideAbove" value={eb.hideAbove} step="any" min={0} max={40} />
            </div>
          </Group>

          <Group legend="Target roles" hint="Primary roles count most in the score; fallback roles are shown but ranked lower. Pick at least one primary role.">
            <div className="grid gap-3 md:grid-cols-2">
              {TARGETABLE_ROLES.map((r) => (
                <Field key={r.key} label={r.label} hint={r.description}>
                  {(p) => <Select {...p} name={roleFieldName(r.key)} defaultValue={familyOf(r.key, profile.targetRoles)} options={TARGET_FAMILIES.map((f) => ({ value: f, label: TARGET_FAMILY_LABEL[f] }))} />}
                </Field>
              ))}
            </div>
          </Group>

          <Group legend="Target countries" hint="The Desk checklist asks you to verify a visa rule for each of these. They do not filter or re-rank jobs.">
            {COUNTRY_TIERS.map((tier) => (
              <div key={tier.key} className="flex flex-col gap-2">
                <p className="micro">{tier.label}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {tier.codes.map((c) => (
                    <label key={c} className={box}>
                      <input type="checkbox" name="countries" value={c} defaultChecked={profile.targetCountries.includes(c)} className={check} />
                      <span className="min-w-0 truncate"><span className="font-mono">{c}</span> <span className="font-normal text-ink-soft">{c === "XW" ? "Remote" : (countryNames[c] ?? "")}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <Field label="Other countries" optional hint="Two-letter codes, separated by commas — for anywhere not listed above.">
              {(p) => <Input {...p} name="countriesExtra" defaultValue={extra.join(", ")} autoComplete="off" className="uppercase" />}
            </Field>
          </Group>

          <Group legend="Company types" hint="Untick a type to exclude those employers (agencies are excluded from sponsor evidence either way).">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {COMPANY_TYPES_LIST.map((t) => (
                <label key={t} className={box}>
                  <input type="checkbox" name="companyTypes" value={t} defaultChecked={profile.companyTypes.includes(t)} className={check} />
                  {COMPANY_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </Group>

          <Field label="Skills" hint="One per line or comma-separated. Used for the skills part of the score.">
            {(p) => <Textarea {...p} name="skills" rows={6} defaultValue={profile.skills.join("\n")} spellCheck={false} />}
          </Field>
        </>
      )}
    </Shell>
  );
}

export function WeightsForm({ weights, version }: { weights: ScoreWeights; version: number }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(SCORE_COMPONENT_KEYS.map((k) => [k, String(weights[k])])));
  const total = weightsTotal(Object.fromEntries(SCORE_COMPONENT_KEYS.map((k) => [k, Number(vals[k].replace(",", "."))])));
  const ok = total === WEIGHTS_TOTAL;
  return (
    <Shell section="score_weights" version={version} submit="Save weights">
      {() => (
        <>
          <p className="text-sm text-ink-soft">How much each part counts towards a job&apos;s fit score. They must add up to {WEIGHTS_TOTAL}. Every score can be explained part by part on the job page.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {SCORE_COMPONENT_KEYS.map((k) => (
              <Field key={k} label={WEIGHT_LABELS[k]}>
                {(p) => <Input {...p} type="number" inputMode="decimal" name={weightFieldName(k)} value={vals[k]} step="any" min={0} max={100} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />}
              </Field>
            ))}
          </div>
          <p className={cn("micro w-fit border-3 border-ink px-3 py-1.5 font-bold tabular", ok ? "bg-radar" : "bg-stamp-tint text-stamp-deep")} role="status">
            Total {total} / {WEIGHTS_TOTAL}
            {ok ? " ✓" : total > WEIGHTS_TOTAL ? ` — ${Math.round((total - WEIGHTS_TOTAL) * 100) / 100} too many` : ` — ${Math.round((WEIGHTS_TOTAL - total) * 100) / 100} to go`}
          </p>
        </>
      )}
    </Shell>
  );
}

export function AlertsForm({ alerts, version, telegramReady, emailReady }: { alerts: AlertSettings; version: number; telegramReady: boolean; emailReady: boolean }) {
  return (
    <Shell section="alerts" version={version} submit="Save alert settings">
      {() => (
        <>
          <p className="text-sm text-ink-soft">Every alert always shows on the System screen. These settings decide what is also pushed to you and how sensitive the checks are.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={box}>
              <input type="checkbox" name="telegram" value="1" defaultChecked={alerts.telegram} className={check} />
              Push to Telegram
            </label>
            <label className={box}>
              <input type="checkbox" name="email" value="1" defaultChecked={alerts.email} className={check} />
              Push by email
            </label>
            <label className={box}>
              <input type="checkbox" name="digest" value="1" defaultChecked={alerts.digest} className={check} />
              Morning digest
            </label>
          </div>
          {!telegramReady && !emailReady ? (
            <p className="border-l-4 border-signal-deep bg-signal-tint px-3 py-2 text-sm font-bold">
              No delivery channel is configured on the server yet (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, or SMTP_URL + ALERT_EMAIL_TO), so nothing can be pushed. Alerts still show in the app.
            </p>
          ) : (
            <p className="text-sm text-ink-soft">Server channels ready: {[telegramReady && "Telegram", emailReady && "email"].filter(Boolean).join(" and ")}.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Push from severity">
              {(p) => <Select {...p} name="minSeverity" defaultValue={alerts.minSeverity} options={[{ value: "info", label: "Everything (info)" }, { value: "warn", label: "Warnings and worse" }, { value: "critical", label: "Critical only" }]} />}
            </Field>
            <Num label="Digest hour (local)" name="digestHour" value={alerts.digestHour} min={0} max={23} />
            <Num label="Heartbeat (hours)" name="heartbeatHours" value={alerts.heartbeatHours} min={1} max={168} hint="No successful run for this long raises an alert." />
            <Num label="Volume drop (%)" name="volumeDropPct" value={alerts.volumeDropPct} step="any" min={0} max={100} hint="Below the source's normal range by this much." />
            <Num label="Volume spike (%)" name="volumeSpikePct" value={alerts.volumeSpikePct} step="any" min={0} max={10000} hint="Above the range's top by this much." />
            <Num label="Parse failures (%)" name="parseFailPct" value={alerts.parseFailPct} step="any" min={0} max={100} />
            <Num label="Field drift (points)" name="fieldDriftPct" value={alerts.fieldDriftPct} step="any" min={0} max={100} hint="A usual field disappearing = the site changed." />
          </div>
        </>
      )}
    </Shell>
  );
}

export function AiForm({ ai, version, envReady, model, envLimit }: { ai: AiSettings; version: number; envReady: boolean; model: string; envLimit: number }) {
  return (
    <Shell section="ai" version={version} submit="Save AI settings">
      {() => (
        <>
          <p className="text-sm text-ink-soft">
            The AI is a helper for hard cases only, never the last word, and always behind a daily budget. Model <span className="font-mono font-bold">{model}</span>; the server allows at most {envLimit} calls a day.
            {envReady ? "" : " AI is switched off on the server (no key or AI_ENABLED is false), so this has no effect yet."}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className={box}>
              <input type="checkbox" name="enabled" value="1" defaultChecked={ai.enabled} className={check} />
              Use the AI
            </label>
            <Num label="Daily limit" name="dailyLimit" value={ai.dailyLimit} min={0} max={50} hint="Can only lower the server limit." />
            <Num label="Kept for manual asks" name="reserveForManual" value={ai.reserveForManual} min={0} max={50} hint="Calls the background work may not use." />
          </div>
        </>
      )}
    </Shell>
  );
}

export function RetentionForm({ retention, version }: { retention: RetentionSettings; version: number }) {
  return (
    <Shell section="retention" version={version} submit="Save retention">
      {() => (
        <div className="max-w-md">
          <Num label="Keep raw snapshots (days)" name="rawDays" value={retention.rawDays} min={7} max={3650} hint="Older raw pages are deleted daily. Shorter = a smaller database and smaller GitHub backups; the parsed jobs are kept either way." />
        </div>
      )}
    </Shell>
  );
}
