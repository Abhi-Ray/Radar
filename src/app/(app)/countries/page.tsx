import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Countries" };

export default function CountriesPage() {
  return (
    <ModulePending
      section="/countries"
      module="UI-TRACKER"
      description="Visa routes, salary thresholds and remote-work rules per country, each with a source."
    />
  );
}
