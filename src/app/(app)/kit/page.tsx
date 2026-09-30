import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Kit" };

export default async function KitPage() {
  await requireSession();
  return (
    <ModulePending
      section="/kit"
      module="UI-TRACKER"
      description="CVs, cover letters and answer templates, versioned and linked to applications."
    />
  );
}
