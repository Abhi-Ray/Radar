import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RadarSweep, type RadarBlip } from "@/components/ui/RadarSweep";
import { Wordmark } from "@/components/ui/Wordmark";
import { RATE_LIMIT } from "@/lib/auth/rate-limit";
import { safeNextPath } from "@/lib/auth/request";
import { getSession } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

/* Illustration only: the login scope is decorative (aria-hidden), these are not data. */
const DECOR_BLIPS: RadarBlip[] = [
  { id: "a", angle: 38, distance: 0.62, label: "", tone: "acid", ping: true },
  { id: "b", angle: 131, distance: 0.34, label: "", tone: "radar" },
  { id: "c", angle: 214, distance: 0.8, label: "", tone: "signal" },
  { id: "d", angle: 297, distance: 0.5, label: "", tone: "acid" },
  { id: "e", angle: 346, distance: 0.22, label: "", tone: "paper" },
];

const READOUT: { k: string; v: string }[] = [
  { k: "Station", v: "RADAR-01" },
  { k: "Seats", v: "1 operator" },
  { k: "Scope", v: "Armed" },
  { k: "Access", v: "Restricted" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const next = safeNextPath(rawNext, "");

  // Already signed in (valid, unrevoked session)? Skip the form.
  let signedIn = false;
  try {
    signedIn = (await getSession()) !== null;
  } catch (err) {
    log.warn("login: session check failed", { error: err instanceof Error ? err.message : String(err) });
  }
  if (signedIn) redirect(next || "/");

  return (
    <main id="main" className="grid flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Console: wordmark + live scope. */}
      <section
        aria-labelledby="station-title"
        className="on-ink relative flex flex-col gap-6 overflow-hidden border-b-3 border-ink bg-ink px-5 pt-5 pb-6 text-paper scanlines sm:px-8 sm:pt-7 sm:pb-8 lg:border-r-3 lg:border-b-0 lg:px-12 lg:pt-12 lg:pb-10"
      >
        <div className="relative z-10 flex items-start justify-between gap-4">
          <p className="micro flex items-center gap-2 text-acid">
            <span aria-hidden="true" className="size-2 animate-blink bg-radar" />
            Field station · standing by
          </p>
          <p className="micro hidden border-2 border-paper/40 px-2 py-0.5 font-mono text-paper/80 sm:block">STN-01</p>
        </div>

        <div className="relative z-10 @container">
          <h1 id="station-title" className="sr-only">
            RADAR field station
          </h1>
          <Wordmark size="fit" onInk />
          <p className="mt-4 max-w-md text-base leading-snug text-paper/85 md:text-lg">
            Visa-aware job radar for one operator. Every fact carries a receipt; every verdict gets a stamp.
          </p>
        </div>

        <div className="relative z-0 mx-auto w-full max-w-[10rem] min-[400px]:max-w-[13rem] sm:max-w-xs lg:mt-auto lg:max-w-[min(34rem,58vh)]" aria-hidden="true">
          <div className="border-3 border-paper/30 p-2 shadow-[6px_6px_0_0_var(--color-radar-deep)]">
            <RadarSweep blips={DECOR_BLIPS} label="Radar scope" />
          </div>
        </div>

        <dl className="relative z-10 hidden grid-cols-4 border-3 border-paper/30 font-mono text-xs lg:grid">
          {READOUT.map((r) => (
            <div key={r.k} className="border-r-3 border-paper/30 px-3 py-2 last:border-r-0">
              <dt className="micro text-[0.625rem] text-paper/60">{r.k}</dt>
              <dd className="m-0 font-bold uppercase text-paper">{r.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Sign-in card. */}
      <section aria-label="Sign in" className="flex items-start justify-center px-4 py-8 sm:px-8 lg:items-center lg:py-12">
        <div className="w-full max-w-md">
          <LoginForm next={next} />
          <p className="mt-6 font-mono text-xs leading-relaxed text-muted">
            Private instance · not indexed · no sign-ups. {RATE_LIMIT.maxFailures} wrong tries lock this network address for{" "}
            {Math.round(RATE_LIMIT.baseLockMs / 60_000)} minutes; repeat lockouts double, up to{" "}
            {Math.round(RATE_LIMIT.maxLockMs / 3_600_000)} hours.
          </p>
        </div>
      </section>
    </main>
  );
}
