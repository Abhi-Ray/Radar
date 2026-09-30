import { ErrorScreen } from "@/components/shell/ErrorScreen";
import { Button } from "@/components/ui/Button";

/** Unknown or malformed country code. Rendered inside the app shell. */
export default function CountryNotFound() {
  return (
    <ErrorScreen
      layout="panel"
      code="404"
      stamp="No such country"
      title="No guide for this country code"
      actions={
        <>
          <Button href="/countries" variant="primary" icon="countries">
            All countries
          </Button>
          <Button href="/" variant="secondary" icon="desk">
            Back to the desk
          </Button>
        </>
      }
    >
      <p>Country guides use two-letter ISO codes, like /countries/de. This one is not on file — check the code, or load the seed data.</p>
    </ErrorScreen>
  );
}
