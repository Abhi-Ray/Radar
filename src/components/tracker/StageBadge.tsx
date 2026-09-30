/** Stage chip in the stage's colour and icon (board cards, lists, the logbook). Server-safe. */
import { Badge } from "@/components/ui/Badge";
import { STAGE_META, isApplicationStage } from "@/lib/tracker/stages";

export function StageBadge({ stage, size = "sm", short }: { stage: string; size?: "sm" | "md"; short?: boolean }) {
  if (!isApplicationStage(stage)) {
    return (
      <Badge tone="concrete" variant="outline" size={size}>
        Unknown stage
      </Badge>
    );
  }
  const m = STAGE_META[stage];
  return (
    <Badge tone={m.tone} variant="solid" size={size} icon={m.icon}>
      {short ? m.short : m.label}
    </Badge>
  );
}
