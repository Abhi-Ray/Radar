import type { Metadata } from "next";
import { AiForm, AlertsForm, ProfileForm, RetentionForm, WeightsForm } from "@/components/settings/SettingsForms";
import { Panel } from "@/components/tracker/Panel";
import { SectionHeader, formatRelative } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { loadSettings } from "@/lib/queries/settings";

export const metadata: Metadata = { title: "Settings" };

const JUMPS = [
  ["profile", "Profile"],
  ["weights", "Score weights"],
  ["alerts", "Alerts"],
  ["ai", "AI"],
  ["retention", "Retention"],
] as const;

export default async function SettingsPage() {
  await requireSession();
  const s = await loadSettings();
  const now = new Date();
  const saved = (d: Date | null) => (d ? <span className="micro">saved {formatRelative(d, now)}</span> : <span className="micro">defaults — never saved</span>);
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="10"
        kicker="OPS · Settings"
        title="Settings"
        description="Who you are, what you are looking for, how a job is scored and when RADAR speaks up. Every save is logged in the audit trail."
      />
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {JUMPS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="micro min-h-11 content-center border-3 border-ink bg-card px-3 font-bold shadow-sm hover:bg-acid">
            {label}
          </a>
        ))}
      </nav>

      <Panel id="profile" code="A" kicker="You" title="Profile & targets" actions={saved(s.updatedAt.profile)}>
        <ProfileForm profile={s.profile} version={s.versions.profile} countryNames={s.countryNames} />
      </Panel>
      <Panel id="weights" code="B" kicker="Scoring" title="Score weights" actions={saved(s.updatedAt.score_weights)}>
        <WeightsForm weights={s.score_weights} version={s.versions.score_weights} />
      </Panel>
      <Panel id="alerts" code="C" kicker="Alerts" title="When RADAR speaks up" actions={saved(s.updatedAt.alerts)}>
        <AlertsForm alerts={s.alerts} version={s.versions.alerts} telegramReady={s.env.telegram} emailReady={s.env.email} />
      </Panel>
      <Panel id="ai" code="D" kicker="AI" title="AI budget" actions={saved(s.updatedAt.ai)}>
        <AiForm ai={s.ai} version={s.versions.ai} envReady={s.env.aiReady} model={s.env.aiModel} envLimit={s.env.aiEnvLimit} />
      </Panel>
      <Panel id="retention" code="E" kicker="Housekeeping" title="Data retention" actions={saved(s.updatedAt.retention)}>
        <RetentionForm retention={s.retention} version={s.versions.retention} />
      </Panel>
    </div>
  );
}
