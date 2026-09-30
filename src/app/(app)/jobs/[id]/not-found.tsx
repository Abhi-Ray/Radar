import { ErrorScreen } from "@/components/shell/ErrorScreen";
import { Button } from "@/components/ui/Button";

/** Unknown or malformed job id. Rendered inside the app shell (the layout owns <main>). */
export default function JobNotFound() {
  return (
    <ErrorScreen
      layout="panel"
      code="404"
      stamp="No blip"
      title="No job at this bearing"
      actions={
        <>
          <Button href="/jobs" variant="primary" icon="jobs">
            All jobs
          </Button>
          <Button href="/" variant="secondary" icon="desk">
            Back to the desk
          </Button>
        </>
      }
    >
      <p>
        There is no job with this number. It may have been mistyped, or it came from an export made before the database was
        reset. Merged duplicates keep their page, so a missing one never existed here.
      </p>
    </ErrorScreen>
  );
}
