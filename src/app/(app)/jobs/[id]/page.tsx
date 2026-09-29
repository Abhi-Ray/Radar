import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ModulePending
      section="/jobs"
      module="UI-JOBS"
      record={{ kind: "Job", key: id }}
      description="One job with its receipts: visa verdict, eligibility, salary evidence and fit breakdown."
    />
  );
}
