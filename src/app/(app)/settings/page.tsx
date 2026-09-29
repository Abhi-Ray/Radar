import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ModulePending
      section="/settings"
      module="UI-OPS"
      description="Profile, eligibility rules, scoring weights and signed-in sessions."
    />
  );
}
