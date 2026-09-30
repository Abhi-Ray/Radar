"use client";

/** "Done" on a follow-up sticky note: closes the reminder and logs it on the timeline. */
import { SubmitButton } from "@/components/ui/SubmitButton";
import { completeReminderAction } from "@/lib/actions/applications";
import { useKeepValuesAction } from "./action-hooks";

export function ReminderDone({ reminderId, label = "Done" }: { reminderId: number; label?: string }) {
  const { pending, onSubmit } = useKeepValuesAction(completeReminderAction, { errorTitle: "Reminder still open" });
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="reminderId" value={reminderId} />
      <SubmitButton variant="ink" size="sm" icon="check" pending={pending} pendingLabel="Closing…">
        {label}
      </SubmitButton>
    </form>
  );
}
