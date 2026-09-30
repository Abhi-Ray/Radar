import { ErrorScreen } from "@/components/shell/ErrorScreen";
import { Button } from "@/components/ui/Button";

/** Unknown or malformed application id. Rendered inside the app shell. */
export default function ApplicationNotFound() {
  return (
    <ErrorScreen
      layout="panel"
      code="404"
      stamp="Not filed"
      title="No application with this number"
      actions={
        <>
          <Button href="/applications" variant="primary" icon="tracker">
            All applications
          </Button>
          <Button href="/" variant="secondary" icon="desk">
            Back to the desk
          </Button>
        </>
      }
    >
      <p>There is no application with this number. It may have been mistyped, or it came from an export made before the database was reset.</p>
    </ErrorScreen>
  );
}
