/** The sponsor-evidence stamp for a company (server-safe). "No evidence" is dashed: it is not a "no". */
import { Stamp, type StampSize } from "@/components/ui/Stamp";
import type { SponsorClass } from "./model";
import { SPONSOR_CLASS_META } from "./view";

export function SponsorStamp({ cls, size = "sm", sub, kicker, tilt = "auto", className }: { cls: SponsorClass; size?: StampSize; sub?: string | null; kicker?: string; tilt?: "auto" | "none"; className?: string }) {
  const m = SPONSOR_CLASS_META[cls];
  return (
    <Stamp
      label={m.stamp}
      tone={m.tone}
      size={size}
      kicker={kicker ?? "Visa sponsor"}
      sub={sub ?? undefined}
      dashed={cls === "none"}
      inked={size !== "sm"}
      tilt={tilt}
      srLabel={`Sponsor evidence: ${m.stamp}`}
      className={className}
    />
  );
}
