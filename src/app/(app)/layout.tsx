import { BottomTabs } from "@/components/shell/BottomTabs";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { ToastProvider } from "@/components/ui/Toast";
import { requireSession } from "@/lib/auth/session";

/**
 * Everything behind the login wall. The proxy already rejected missing/expired JWTs; this does the
 * DB-backed check (revoked sessions, wrong operator) on every render.
 *
 * Desktop: sticky ink rail + content column. Phone: sticky top bar + fixed bottom tabs, with the
 * content padded clear of the tab bar (and the home-indicator safe area).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();

  return (
    <ToastProvider>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="min-h-dvh md:grid md:grid-cols-[15.5rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Sidebar email={session.email} />
        <div className="flex min-w-0 flex-col">
          <TopBar />
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-[96rem] flex-1 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] outline-none sm:px-6 md:px-8 md:pt-9 md:pb-16 xl:px-12"
          >
            {children}
          </main>
        </div>
      </div>
      <BottomTabs email={session.email} />
    </ToastProvider>
  );
}
