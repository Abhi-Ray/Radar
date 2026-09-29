import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Tracker" };

export default function TrackerPage() {
  return (
    <ModulePending
      section="/applications"
      module="UI-TRACKER"
      description="Applications from saved to offer: stages, follow-ups and deadlines."
    />
  );
}
