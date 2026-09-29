"use client";

import { ErrorScreen } from "@/components/shell/ErrorScreen";
import "./globals.css";

/**
 * Last-resort boundary for failures in the root layout itself. Replaces the whole document, so it
 * brings its own <html>/<body> and styles (fonts fall back to the system stack).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Station fault · RADAR</title>
        <main id="main">
          <ErrorScreen
            layout="page"
            code="500"
            stamp="Fault"
            title="Station down"
            digest={error.digest}
            actions={
              <button
                type="button"
                onClick={() => retry()}
                className="min-h-11 border-3 border-ink bg-acid px-4 text-sm font-extrabold uppercase tracking-[0.06em] shadow-md press"
              >
                Try again
              </button>
            }
          >
            <p>The app shell itself failed to render. Reload in a minute; if it persists, check the server log for this reference.</p>
          </ErrorScreen>
        </main>
      </body>
    </html>
  );
}
