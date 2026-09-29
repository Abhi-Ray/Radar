import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { METHOD_META, isMethodKind, type MethodKind } from "./status";

const STYLE: Record<MethodKind, { cls: string; icon: IconName }> = {
  manual: { cls: "bg-ink text-paper border-ink", icon: "user" },
  official: { cls: "bg-radar-tint text-ink border-ink", icon: "shield" },
  posting: { cls: "bg-cobalt-tint text-ink border-ink", icon: "quote" },
  rule: { cls: "bg-acid-tint text-ink border-ink", icon: "bolt" },
  ai: { cls: "bg-lilac text-ink border-ink", icon: "ai" },
  estimate: { cls: "bg-card text-ink border-ink border-dashed hatch-soft italic", icon: "euro" },
};

export interface MethodTagProps {
  method: MethodKind | string | null | undefined;
  /** "short" = MANUAL, "long" = MANUAL (YOU). */
  variant?: "short" | "long";
  className?: string;
}

/** How a fact was obtained. AI is always lilac; estimates are hatched and dashed. */
export function MethodTag({ method, variant = "short", className }: MethodTagProps) {
  if (!isMethodKind(method)) {
    return (
      <span className={cn("inline-flex min-h-6 items-center gap-1 border-2 border-dashed border-ink px-1.5 font-mono text-[0.6875rem] font-bold uppercase text-muted", className)}>
        Unknown method
      </span>
    );
  }
  const meta = METHOD_META[method];
  const s = STYLE[method];
  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex min-h-6 items-center gap-1 whitespace-nowrap border-2 px-1.5 font-mono text-[0.6875rem] font-bold uppercase leading-none tracking-[0.08em]",
        s.cls,
        className,
      )}
    >
      <Icon name={s.icon} size={12} />
      <span className="sr-only">Method: </span>
      {variant === "long" ? meta.long : meta.label}
    </span>
  );
}
