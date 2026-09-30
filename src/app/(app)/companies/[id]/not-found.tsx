import { ErrorScreen } from "@/components/shell/ErrorScreen";
import { Button } from "@/components/ui/Button";

/** Unknown or malformed company id. Rendered inside the app shell. */
export default function CompanyNotFound() {
  return (
    <ErrorScreen
      layout="panel"
      code="404"
      stamp="Not on file"
      title="No company with this number"
      actions={
        <>
          <Button href="/companies" variant="primary" icon="companies">
            All companies
          </Button>
          <Button href="/" variant="secondary" icon="desk">
            Back to the desk
          </Button>
        </>
      }
    >
      <p>There is no company with this number. It may have been mistyped, or it came from a link made before the database was reset.</p>
    </ErrorScreen>
  );
}
