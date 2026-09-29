import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Kit" };

export default function KitPage() {
  return (
    <ModulePending
      section="/kit"
      module="UI-TRACKER"
      description="CVs, cover letters and answer templates, versioned and linked to applications."
    />
  );
}
