import type { Metadata } from "next";
import { ErrorScreen } from "@/components/shell/ErrorScreen";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main">
      <ErrorScreen
        layout="page"
        code="404"
        stamp="No signal"
        title="Nothing at this bearing"
        actions={
          <>
            <Button href="/" variant="primary" icon="desk">
              Back to the desk
            </Button>
            <Button href="/jobs" variant="secondary" icon="jobs">
              All jobs
            </Button>
          </>
        }
      >
        <p>
          The address is wrong, or the record was merged, archived or never existed. Links from old exports and
          deduplicated jobs end up here.
        </p>
      </ErrorScreen>
    </main>
  );
}
