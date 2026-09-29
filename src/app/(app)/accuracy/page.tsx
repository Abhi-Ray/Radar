import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Accuracy" };

export default function AccuracyPage() {
  return (
    <ModulePending
      section="/accuracy"
      module="UI-OPS"
      description="Golden sample, accuracy dashboard and spot-checks for every extractor."
    />
  );
}
