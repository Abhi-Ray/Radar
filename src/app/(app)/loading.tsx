import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

/** Streaming placeholder for any signed-in screen: header bar + a grid of card skeletons. */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-8">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="flex flex-col gap-3 border-b-3 border-ink pb-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-12 w-3/4 max-w-xl md:h-16" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <p aria-hidden="true" className="micro flex items-center gap-2 text-muted">
        <span className="inline-flex gap-[3px] animate-pending">
          <span className="size-2 bg-ink" />
          <span className="size-2 bg-ink" />
          <span className="size-2 bg-ink" />
        </span>
        Tuning in
      </p>
      <div aria-hidden="true" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
