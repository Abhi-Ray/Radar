/**
 * Public, unauthenticated screens (sign-in). A hazard-taped "restricted area" frame around a single
 * full-height page; no nav, nothing that needs a session.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div aria-hidden="true" className="h-3 shrink-0 border-b-3 border-ink bg-acid hatch-dense" />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <div aria-hidden="true" className="h-3 shrink-0 border-t-3 border-ink bg-acid hatch-dense" />
    </div>
  );
}
