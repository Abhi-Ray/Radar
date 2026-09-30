import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

/** Jobs list placeholder: header, the filter column and a grid of card skeletons. */
export default function JobsLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Sweeping the scope for jobs…</span>
      <div aria-hidden="true" className="flex flex-col gap-3 border-b-3 border-ink pb-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-12 w-48 md:h-16" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <p aria-hidden="true" className="micro flex items-center gap-2 text-muted">
        <span className="inline-flex gap-[3px] animate-pending">
          <span className="size-2 bg-ink" />
          <span className="size-2 bg-ink" />
          <span className="size-2 bg-ink" />
        </span>
        Sweeping the scope
      </p>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="hidden h-96 border-3 border-dashed border-ink/40 lg:block" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
