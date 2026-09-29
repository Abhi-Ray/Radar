"use client";

import { useId, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { cn } from "./cn";
import type { IconName } from "./icons";
import { useDialog, useDisclosure } from "./useDialog";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  kicker?: ReactNode;
  children?: ReactNode;
  /** Sticky action row (Apply / Reset). */
  footer?: ReactNode;
  /** Desktop side. Mobile is always a bottom sheet. */
  side?: "right" | "left";
  /** Close automatically when a form inside is submitted (filters). Default true. */
  closeOnSubmit?: boolean;
  className?: string;
}

/**
 * Bottom sheet on phones, side panel from md up. Native modal <dialog>: focus trap, Esc,
 * backdrop click, focus restore. Used for mobile filters and the "More" nav sheet.
 */
export function Drawer({ open, onClose, title, kicker, children, footer, side = "right", closeOnSubmit = true, className }: DrawerProps) {
  const id = useId();
  const wiring = useDialog(open, onClose);
  return (
    <dialog
      {...wiring}
      aria-labelledby={`${id}-title`}
      onSubmit={closeOnSubmit ? () => onClose() : undefined}
      className={cn(
        // phone: bottom sheet
        "fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-full overscroll-contain p-0 text-ink open:animate-sheet-up",
        // md+: full-height side panel
        "md:top-0 md:bottom-0 md:h-dvh md:w-[min(28rem,100vw)] md:open:animate-sheet-left",
        side === "right" ? "md:right-0 md:left-auto" : "md:left-0 md:right-auto",
        className,
      )}
    >
      <div
        className={cn(
          "flex max-h-[88dvh] flex-col border-t-3 border-ink bg-card md:h-full md:max-h-none md:border-t-0",
          side === "right" ? "md:border-l-3" : "md:border-r-3",
        )}
      >
        <div aria-hidden="true" className="flex justify-center pt-2 md:hidden">
          <span className="h-1.5 w-12 bg-ink" />
        </div>
        <div className="flex items-start justify-between gap-3 border-b-3 border-ink px-4 py-3">
          <div className="min-w-0">
            {kicker ? <p className="micro mb-1 text-muted">{kicker}</p> : null}
            <h2 id={`${id}-title`} className="headline wide text-xl uppercase leading-none">
              {title}
            </h2>
          </div>
          <Button variant="secondary" size="sm" square icon="close" aria-label="Close" onClick={onClose} className="shrink-0" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer ? (
          <div className="flex gap-2 border-t-3 border-ink bg-paper px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] [&>*]:flex-1">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}

export interface DrawerButtonProps extends Omit<DrawerProps, "open" | "onClose"> {
  label: ReactNode;
  icon?: IconName;
  variant?: ButtonVariant;
  buttonSize?: ButtonSize;
  buttonClassName?: string;
  /** Small count on the trigger ("3" active filters). */
  badge?: number | null;
}

/** Uncontrolled convenience: trigger button + drawer (e.g. "Filters" on mobile). */
export function DrawerButton({ label, icon = "filter", variant = "secondary", buttonSize = "md", buttonClassName, badge, ...drawer }: DrawerButtonProps) {
  const d = useDisclosure();
  return (
    <>
      <Button variant={variant} size={buttonSize} icon={icon} onClick={d.show} className={buttonClassName} aria-haspopup="dialog">
        {label}
        {typeof badge === "number" && badge > 0 ? (
          <span className="ml-1 bg-ink px-1.5 py-0.5 font-mono text-[0.6875rem] text-paper tabular">{badge}</span>
        ) : null}
      </Button>
      <Drawer {...drawer} open={d.open} onClose={d.hide} />
    </>
  );
}
