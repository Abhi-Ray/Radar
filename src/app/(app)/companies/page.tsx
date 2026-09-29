import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Companies" };

export default function CompaniesPage() {
  return (
    <ModulePending
      section="/companies"
      module="UI-TRACKER"
      description="Employers seen on the scope: sponsor-register status, hiring history and your notes."
    />
  );
}
