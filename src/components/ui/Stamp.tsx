import type { ReactNode } from "react";
import { cn } from "./cn";
import { pickVariant } from "./geometry";
import {
  ELIGIBILITY_META,
  TONE_TEXT,
  VISA_META,
  toEligibility,
  toVisaStatus,
  type EligibilityResult,
  type Tone,
  type VisaStatus,
} from "./status";

export type StampSize = "sm" | "md" | "lg";

interface StampBase {
  size?: StampSize;
  /** Small mono line under the verdict: route, country, date ("BLUE CARD · DE"). */
  sub?: ReactNode;
  /** Rotation seed; defaults to the label so the same verdict always lands at the same tilt. */
  seed?: string;
  /** "auto" (seeded −6°…4°) or "none". */
  tilt?: "auto" | "none";
  /** Play the scale-in "thunk" when it mounts (disabled under reduced motion). */
  animate?: boolean;
  /** Speckled ink + roughened edge. Default true; turn off for tiny inline use. */
  inked?: boolean;
  className?: string;
}

export type StampProps =
  | (StampBase & { kind: "visa"; status: VisaStatus | string | null | undefined; kicker?: ReactNode })
  | (StampBase & { kind: "eligibility"; result: EligibilityResult | string | null | undefined; kicker?: ReactNode })
  | (StampBase & { kind?: "generic"; tone?: Tone; label: ReactNode; kicker?: ReactNode; srLabel?: string; dashed?: boolean });

const SIZE: Record<StampSize, { outer: string; inner: string; label: string; kicker: string; sub: string }> = {
  sm: {
    outer: "border-2 p-[2px]",
    inner: "border px-1.5 py-0.5 gap-0",
    label: "text-[0.7rem]",
    kicker: "hidden",
    sub: "hidden",
  },
  md: {
    outer: "border-3 p-[3px]",
    inner: "border-[1.5px] px-2.5 py-1 gap-0.5",
    label: "text-base",
    kicker: "text-[0.5625rem]",
    sub: "text-[0.625rem]",
  },
  lg: {
    outer: "border-4 p-1",
    inner: "border-2 px-4 py-2 gap-1",
    label: "text-2xl md:text-3xl",
    kicker: "text-[0.6875rem]",
    sub: "text-xs",
  },
};

/**
 * Passport-style verdict stamp. Double border, tilted, speckled ink.
 *
 * <Stamp kind="visa" status="confirmed" sub="EU BLUE CARD · DE" />
 * <Stamp kind="eligibility" result="borderline" />
 * <Stamp label="Merged" tone="cobalt" />
 */
export function Stamp(props: StampProps) {
  const { size = "md", sub, seed, tilt = "auto", animate, inked = true, className } = props;

  let label: ReactNode;
  let kicker: ReactNode;
  let tone: Tone;
  let srLabel: string;
  let dashed = false;

  if (props.kind === "visa") {
    const status = toVisaStatus(props.status);
    const meta = VISA_META[status];
    label = meta.stamp;
    kicker = props.kicker ?? "Visa";
    tone = meta.tone;
    srLabel = `Visa sponsorship: ${meta.label}`;
    dashed = status === "unknown";
  } else if (props.kind === "eligibility") {
    const result = toEligibility(props.result);
    const meta = ELIGIBILITY_META[result];
    label = meta.stamp;
    kicker = props.kicker ?? "Eligibility";
    tone = meta.tone;
    srLabel = `Eligibility: ${meta.label}`;
    dashed = result === "cant_tell";
  } else {
    label = props.label;
    kicker = props.kicker;
    tone = props.tone ?? "ink";
    srLabel = props.srLabel ?? (typeof props.label === "string" ? props.label : "");
    dashed = Boolean(props.dashed);
  }

  const s = SIZE[size];
  const rotSeed = seed ?? (typeof label === "string" ? label : srLabel);
  const rot = tilt === "none" ? "stamp-rot-none" : `stamp-rot-${pickVariant(rotSeed || "stamp", 6)}`;

  return (
    <span
      className={cn(
        "stamp inline-flex shrink-0 select-none border-current align-middle",
        rot,
        TONE_TEXT[tone],
        s.outer,
        dashed && "border-dashed",
        inked && "ink-texture",
        inked && size !== "sm" && "ink-rough",
        animate && "stamp-thunk",
        className,
      )}
    >
      <span className={cn("flex flex-col items-center border-current text-center", s.inner, dashed && "border-dashed")}>
        {kicker && size !== "sm" ? (
          <span aria-hidden="true" className={cn("font-mono font-bold uppercase leading-none tracking-[0.2em]", s.kicker)}>
            {kicker}
          </span>
        ) : null}
        <span
          aria-hidden={srLabel ? true : undefined}
          className={cn("headline wide whitespace-nowrap uppercase leading-none tracking-stamp", s.label)}
        >
          {label}
        </span>
        {sub && size !== "sm" ? (
          <span className={cn("font-mono font-bold uppercase leading-none tracking-[0.12em]", s.sub)}>{sub}</span>
        ) : null}
      </span>
      {srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  );
}
