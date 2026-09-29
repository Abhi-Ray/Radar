import { SubmitButton } from "@/components/ui/SubmitButton";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icons";
import { logoutAction } from "@/lib/auth/actions";

export interface UserMenuProps {
  email: string;
  variant?: "rail" | "compact" | "sheet";
  className?: string;
}

/** Operator badge + sign-out (a real form posting to the logout server action; works without JS). */
export function UserMenu({ email, variant = "rail", className }: UserMenuProps) {
  if (variant === "compact") {
    return (
      <form action={logoutAction} className={className}>
        <SubmitButton variant="secondary" size="sm" square icon="logout" aria-label={`Sign out ${email}`} title="Sign out" />
      </form>
    );
  }

  const onInk = variant === "rail";
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className={cn("flex min-w-0 items-center gap-2 border-2 px-2 py-1.5", onInk ? "border-paper/40 text-paper" : "border-ink bg-paper text-ink")}>
        <span aria-hidden="true" className={cn("flex size-7 shrink-0 items-center justify-center", onInk ? "bg-paper text-ink" : "bg-ink text-paper")}>
          <Icon name="user" size={16} />
        </span>
        <span className="min-w-0">
          <span className={cn("micro block text-[0.5625rem]", onInk ? "text-acid" : "text-muted")}>Operator</span>
          <span className="block truncate font-mono text-xs" title={email}>
            {email}
          </span>
        </span>
      </div>
      <form action={logoutAction}>
        <SubmitButton variant={onInk ? "ink" : "secondary"} size="sm" icon="logout" fullWidth pendingLabel="Signing out" className={onInk ? "border-paper" : undefined}>
          Sign out
        </SubmitButton>
      </form>
    </div>
  );
}
