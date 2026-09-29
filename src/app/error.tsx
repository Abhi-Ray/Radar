"use client";

import { ErrorScreen } from "@/components/shell/ErrorScreen";
import { Button } from "@/components/ui/Button";

/**
 * Root error boundary: catches failures in the (auth) and (app) layouts themselves (e.g. the
 * database is unreachable while checking the session). The server logs the full error; the
 * browser only ever sees the digest.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main">
      <ErrorScreen
        layout="page"
        code="500"
        stamp="Fault"
        title="Station fault"
        digest={error.digest}
        actions={
          <>
            <Button type="button" variant="primary" icon="refresh" onClick={() => retry()}>
              Try again
            </Button>
            <Button href="/login" variant="secondary" icon="lock">
              Sign-in screen
            </Button>
          </>
        }
      >
        <p>
          This screen could not be loaded. Usually the database or a downstream service is restarting — give it a minute
          and try again. If it keeps failing, check the server log for the reference below.
        </p>
      </ErrorScreen>
    </main>
  );
}
