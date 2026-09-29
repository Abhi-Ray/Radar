import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <ModulePending
      section="/jobs"
      module="UI-JOBS"
      description="Every job on the scope, filterable by visa route, remote rules, salary and fit."
    />
  );
}
