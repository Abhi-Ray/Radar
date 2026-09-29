import { cn } from "./cn";

export interface SkeletonProps {
  className?: string;
  /** Number of stacked text lines (last one shorter). */
  lines?: number;
}

/** Hatched placeholder block that scans (stepped, not shimmering). Hidden from assistive tech. */
export function Skeleton({ className, lines }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={cn("hatch-soft animate-scan block h-3.5 border-2 border-ink/25 bg-paper-deep", i === lines - 1 ? "w-3/5" : "w-full")} />
        ))}
      </div>
    );
  }
  return <span aria-hidden="true" className={cn("hatch-soft animate-scan block h-4 border-2 border-ink/25 bg-paper-deep", className)} />;
}

/** Screen-reader announcement + visual skeleton card, used by loading.tsx files. */
export function SkeletonCard({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div className={cn("border-3 border-ink/40 bg-card p-4", className)}>
      <span className="sr-only">{label}</span>
      <Skeleton className="mb-3 h-6 w-2/5" />
      <Skeleton lines={3} />
    </div>
  );
}
