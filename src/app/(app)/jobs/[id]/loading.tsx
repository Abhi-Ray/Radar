import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

/** Job detail placeholder: header slab, then the receipts column and the side column. */
export default function JobLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Pulling the receipts for this job…</span>
      <div aria-hidden="true" className="flex flex-col gap-3 border-3 border-ink bg-card p-5 shadow-lg">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-10 w-4/5 max-w-2xl md:h-12" />
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-6 w-44" />
      </div>
      <p aria-hidden="true" className="micro flex items-center gap-2 text-muted">
        <span className="inline-flex gap-[3px] animate-pending">
          <span className="size-2 bg-ink" />
          <span className="size-2 bg-ink" />
          <span className="size-2 bg-ink" />
        </span>
        Pulling the receipts
      </p>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="flex flex-col gap-6">
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
