"use client";

/** Copies text to the clipboard and says so (toast + a short "Copied" label). */
import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  what = "Text",
  variant = "secondary",
  size = "sm",
  disabled,
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  /** For the toast: "Cover letter copied". */
  what?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  disabled?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
      toast({ kind: "ok", title: `${what} copied`, duration: 2500 });
    } catch {
      toast({ kind: "error", title: "Could not copy", body: "The browser blocked the clipboard. Select the text and copy it by hand." });
    }
  };
  return (
    <Button type="button" variant={variant} size={size} icon={copied ? "check" : "copy"} onClick={copy} disabled={disabled || !text} className={className}>
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  );
}
