import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Country" };

export default async function CountryPage({ params }: { params: Promise<{ iso2: string }> }) {
  const { iso2 } = await params;
  return (
    <ModulePending
      section="/countries"
      module="UI-TRACKER"
      record={{ kind: "Country", key: iso2.toUpperCase() }}
      description="One country: routes, thresholds, processing times and the receipts behind them."
    />
  );
}
