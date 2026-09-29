"use client";

import { ErrorScreen } from "@/components/shell/ErrorScreen";
import { Button } from "@/components/ui/Button";

/**
 * Error boundary for every signed-in screen. Renders inside the shell, so the rail and tabs stay
 * usable. The server logs the full error; the browser only shows the digest.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ErrorScreen
      code="500"
      stamp="Fault"
      title="Signal lost"
      digest={error.digest}
      actions={
        <>
          <Button type="button" variant="primary" icon="refresh" onClick={() => retry()}>
            Try again
          </Button>
          <Button href="/" variant="secondary" icon="desk">
            Back to the desk
          </Button>
        </>
      }
    >
      <p>
        This screen failed to load. Nothing was changed. If a form was being saved, check that it stuck before submitting
        again. Persistent faults show up under System with the reference below.
      </p>
    </ErrorScreen>
  );
}
