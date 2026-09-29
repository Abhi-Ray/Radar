"use client";

import { useId, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { cn } from "./cn";
import type { IconName } from "./icons";
import { TONE_SOLID, type Tone } from "./status";
import { useDialog, useDisclosure } from "./useDialog";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Micro label above the title. */
  kicker?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row at the bottom (buttons). */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Header band colour. Destructive confirms use "stamp". */
  tone?: Tone;
  /** Clicking the dotted backdrop closes. Default true. */
  closeOnBackdrop?: boolean;
  /** Close when a form inside is submitted. Default false (keep it open to show errors). */
  closeOnSubmit?: boolean;
  className?: string;
}

const WIDTH = { sm: "sm:w-[26rem]", md: "sm:w-[34rem]", lg: "sm:w-[46rem]" } as const;

/**
 * Native <dialog> modal: focus trapped, Esc closes, page behind is inert, focus restored.
 * On phones it is a full-width sheet pinned to the bottom.
 */
export function Modal({
  open,
  onClose,
  title,
  kicker,
  description,
  children,
  footer,
  size = "md",
  tone = "acid",
  closeOnBackdrop = true,
  closeOnSubmit = false,
  className,
}: ModalProps) {
  const id = useId();
  const wiring = useDialog(open, onClose, closeOnBackdrop);
  return (
    <dialog
      {...wiring}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onSubmit={closeOnSubmit ? () => onClose() : undefined}
      className={cn(
        "fixed m-0 mt-auto w-full max-w-full overscroll-contain p-0 text-ink open:animate-sheet-up",
        "sm:m-auto sm:max-w-[calc(100vw-2rem)] sm:open:animate-pop",
        WIDTH[size],
        className,
      )}
    >
      <div className="flex max-h-[92dvh] flex-col border-3 border-ink bg-card shadow-xl sm:max-h-[85dvh]">
        <div className={cn("flex items-start justify-between gap-3 border-b-3 border-ink px-4 py-3", TONE_SOLID[tone], tone === "ink" && "on-ink")}>
          <div className="min-w-0">
            {kicker ? <p className="micro mb-1 opacity-85">{kicker}</p> : null}
            <h2 id={`${id}-title`} className="headline wide text-xl uppercase leading-none md:text-2xl">
              {title}
            </h2>
          </div>
          <Button variant="secondary" size="sm" square icon="close" aria-label="Close" onClick={onClose} className="shrink-0" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {description ? (
            <p id={`${id}-desc`} className="mb-3 text-sm text-ink-soft">
              {description}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t-3 border-ink bg-paper px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

export interface ModalButtonProps extends Omit<ModalProps, "open" | "onClose"> {
  /** Trigger button label. */
  label: ReactNode;
  icon?: IconName;
  variant?: ButtonVariant;
  buttonSize?: ButtonSize;
  buttonClassName?: string;
  /** Footer actions. Give a Cancel button `data-dialog-close` to dismiss without JS wiring. */
  footer?: ReactNode;
}

/** Uncontrolled convenience: a button that opens a modal. Server pages can use it directly. */
export function ModalButton({ label, icon, variant = "secondary", buttonSize = "md", buttonClassName, footer, ...modal }: ModalButtonProps) {
  const d = useDisclosure();
  return (
    <>
      <Button variant={variant} size={buttonSize} icon={icon} onClick={d.show} className={buttonClassName} aria-haspopup="dialog">
        {label}
      </Button>
      <Modal {...modal} open={d.open} onClose={d.hide} footer={footer} />
    </>
  );
}
