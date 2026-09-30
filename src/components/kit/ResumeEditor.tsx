"use client";

/**
 * One resume version: name, track, where the file lives, and the Markdown text with a live
 * preview (side by side on wide screens, a Write / Preview switch on phones). The preview is
 * rendered by the kit's own Markdown renderer — never as HTML — so pasted markup stays text.
 */
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { deleteResumeAction, saveResumeAction } from "@/lib/actions/kit";
import { InlineError, useKeepValuesAction, useLazyModal } from "@/components/tracker/action-hooks";
import { Markdown } from "./MarkdownView";
import { MAX_MARKDOWN, wordCount } from "./markdown";
import { RESUME_TRACK_KEYS, TRACK_LABEL, type ResumeTrackKey } from "./labels";

export interface ResumeDraft {
  id: number | null;
  name: string;
  track: ResumeTrackKey;
  fileNote: string | null;
  contentMd: string;
  usedBy: number;
}

const STARTER = `# Your Name
Cloud security engineer · City, Country · email@example.com

## Summary
Two lines: what you do, for whom, with what result.

## Experience
### Role — Company (2023–now)
- Measured result, in the job's words
- Another result with a number

## Skills
AWS, Terraform, Kubernetes, …
`;

function DeleteResume({ id, name, usedBy }: { id: number; name: string; usedBy: number }) {
  const router = useRouter();
  const m = useLazyModal();
  const { state, pending, onSubmit } = useKeepValuesAction(deleteResumeAction, {
    errorTitle: "Not deleted",
    onOk: () => {
      m.hide();
      router.push("/kit?tab=resumes");
    },
  });
  return (
    <>
      <Button type="button" variant="ghost" icon="trash" onClick={m.show} aria-haspopup="dialog">
        Delete
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={`Delete “${name}”?`} kicker="Kit · Resume" size="sm" tone="stamp">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={id} />
            {usedBy > 0 ? (
              <p className="text-sm">
                This version is recorded on <strong>{usedBy}</strong> application{usedBy === 1 ? "" : "s"}, so it stays — the logbook must still say what you
                sent. Save a new version instead.
              </p>
            ) : (
              <p className="text-sm">The text is removed for good. No application records it, so nothing else changes.</p>
            )}
            <InlineError state={state} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" type="button" data-dialog-close>
                Keep it
              </Button>
              <SubmitButton variant="danger" icon="trash" pending={pending} pendingLabel="Deleting…" disabled={usedBy > 0} data-autofocus>
                Delete version
              </SubmitButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function ResumeEditor({ draft }: { draft: ResumeDraft }) {
  const router = useRouter();
  const [content, setContent] = useState(draft.contentMd || (draft.id ? "" : STARTER));
  const [view, setView] = useState<"write" | "preview">("write");
  const preview = useDeferredValue(content);
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(saveResumeAction, {
    errorTitle: "Not saved",
    onOk: (s) => {
      if (s.href && (!draft.id || s.id !== draft.id)) router.push(s.href, { scroll: false });
    },
  });
  const words = wordCount(preview);
  const formId = `resume-form-${draft.id ?? "new"}`;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form
        key={formKey}
        id={formId}
        onSubmit={onSubmit}
        className="flex min-w-0 flex-col gap-4"
        aria-label={draft.id ? `Edit ${draft.name}` : "New resume version"}
      >
        {draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="Version name" required hint="What makes it different: track, market, month.">
            {(p) => <Input {...p} name="name" defaultValue={draft.name} maxLength={191} placeholder="Cloud security · EU · Sep 2026" autoComplete="off" />}
          </Field>
          <Field label="Track" required>
            {(p) => (
              <Select
                {...p}
                name="track"
                defaultValue={draft.track}
                options={RESUME_TRACK_KEYS.map((t) => ({
                  value: t,
                  label: TRACK_LABEL[t],
                }))}
              />
            )}
          </Field>
        </div>
        <Field label="File note" optional hint="Where the PDF lives (file name or folder) — the text below is the source.">
          {(p) => <Input {...p} name="fileNote" defaultValue={draft.fileNote ?? ""} maxLength={512} autoComplete="off" />}
        </Field>

        <div className="flex gap-1 lg:hidden" role="group" aria-label="Editor view">
          {(["write", "preview"] as const).map((v) => (
            <Button key={v} type="button" size="sm" variant={view === v ? "ink" : "secondary"} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "write" ? "Write" : "Preview"}
            </Button>
          ))}
        </div>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className={cn("min-w-0 flex-col gap-1", view === "preview" ? "hidden lg:flex" : "flex")}>
            <Field label="Resume text (Markdown)" required hint="# headings, - bullets, **bold**, [links](https://…). No HTML.">
              {(p) => (
                <Textarea
                  {...p}
                  name="contentMd"
                  value={content}
                  onChange={(e) => setContent(e.currentTarget.value)}
                  rows={24}
                  mono
                  maxLength={MAX_MARKDOWN}
                  spellCheck
                  className="min-h-[24rem]"
                />
              )}
            </Field>
          </div>
          <section aria-label="Preview" className={cn("min-w-0 flex-col gap-2", view === "write" ? "hidden lg:flex" : "flex")}>
            <p className="micro flex items-center justify-between gap-2 text-ink">
              <span>Preview</span>
              <span className="font-mono text-muted tabular">
                {words} word{words === 1 ? "" : "s"}
              </span>
            </p>
            <div className="min-h-[24rem] max-h-[70dvh] overflow-y-auto border-3 border-ink bg-card p-4 shadow-sm">
              <Markdown source={preview} emptyText="Start typing on the left." />
            </div>
          </section>
        </div>

        <InlineError state={state} />
      </form>
      {/* Outside the form: the delete dialog holds its own form (forms cannot nest). */}
      <div className="flex flex-col-reverse gap-2 border-t-3 border-ink pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {draft.id ? <DeleteResume id={draft.id} name={draft.name} usedBy={draft.usedBy} /> : null}
        {draft.id ? (
          <SubmitButton form={formId} variant="secondary" icon="copy" name="asNew" value="1" pending={pending}>
            Save as a new version
          </SubmitButton>
        ) : null}
        <SubmitButton form={formId} variant="primary" icon="check" pending={pending} pendingLabel="Saving…">
          {draft.id ? "Save changes" : "Create version"}
        </SubmitButton>
      </div>
      {draft.id && draft.usedBy > 0 ? (
        <p className="text-xs text-muted">
          Recorded on {draft.usedBy} application{draft.usedBy === 1 ? "" : "s"}. Editing changes the text for all of them — use “Save as a new version” to keep
          what was sent.
        </p>
      ) : null}
    </div>
  );
}
