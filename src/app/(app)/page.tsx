import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Desk" };

export default function DeskPage() {
  return (
    <ModulePending
      section="/"
      module="UI-JOBS"
      description="Control desk: new blips, deadlines, follow-ups and station health at a glance."
    />
  );
}
