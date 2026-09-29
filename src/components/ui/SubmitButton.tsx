"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonAsButton } from "./Button";

export type SubmitButtonProps = Omit<ButtonAsButton, "type" | "pending"> & {
  /** Force the pending look (e.g. from useActionState's `pending`). */
  pending?: boolean;
};

/**
 * Submit button that shows the pending state of its parent <form> (server actions).
 * <SubmitButton variant="primary" pendingLabel="Saving…">Save</SubmitButton>
 */
export function SubmitButton({ pending, ...props }: SubmitButtonProps) {
  const status = useFormStatus();
  return <Button {...props} type="submit" pending={pending || status.pending} />;
}
