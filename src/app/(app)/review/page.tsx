import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return (
    <ModulePending
      section="/review"
      module="UI-OPS"
      description="Things a human must decide: duplicate pairs, unmapped titles, failed parses, flagged jobs."
    />
  );
}
