"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"], summary';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  );
}

export interface DialogWiring {
  ref: RefObject<HTMLDialogElement | null>;
  onCancel: (e: SyntheticEvent<HTMLDialogElement>) => void;
  onClick: (e: MouseEvent<HTMLDialogElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDialogElement>) => void;
}

/**
 * Drives a native <dialog> as a controlled modal:
 * - showModal()/close() follow `open` (page behind becomes inert, top layer, no z-index wars)
 * - Esc, backdrop clicks and clicks on [data-dialog-close] call onClose (the parent decides)
 * - Tab/Shift+Tab cycle inside the dialog
 * - focus returns to whatever opened it
 */
export function useDialog(open: boolean, onClose: () => void, closeOnBackdrop = true): DialogWiring {
  const ref = useRef<HTMLDialogElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const autofocus = dialog.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
      (autofocus ?? focusables(dialog)[0] ?? dialog).focus();
    } else if (!open && dialog.open) {
      dialog.close();
      const back = restoreRef.current;
      restoreRef.current = null;
      if (back && back.isConnected) back.focus();
    }
  }, [open]);

  // Close for real if the component unmounts while open.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const onCancel = useCallback(
    (e: SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  const onClick = useCallback(
    (e: MouseEvent<HTMLDialogElement>) => {
      // A click whose target is the <dialog> itself landed on the backdrop area.
      if (closeOnBackdrop && e.target === e.currentTarget) {
        onClose();
        return;
      }
      // Any element marked data-dialog-close (e.g. a server-rendered Cancel button) dismisses.
      const target = e.target instanceof Element ? e.target.closest("[data-dialog-close]") : null;
      if (target && e.currentTarget.contains(target)) onClose();
    },
    [closeOnBackdrop, onClose],
  );

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab") return;
    const dialog = ref.current;
    if (!dialog) return;
    const items = focusables(dialog);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return { ref, onCancel, onClick, onKeyDown };
}

/** Tiny open/close state helper. */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, show, hide, toggle, setOpen };
}
