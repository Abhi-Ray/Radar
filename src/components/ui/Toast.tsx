"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type ToastKind = "ok" | "info" | "warn" | "error" | "ai";

export interface ToastInput {
  title: string;
  body?: string;
  kind?: ToastKind;
  /** ms before auto-dismiss; 0 = sticky. Default 5000 (errors 9000). */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, "body">> {
  id: number;
  body?: string;
}

interface ToastApi {
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND: Record<ToastKind, { bar: string; icon: IconName; word: string }> = {
  ok: { bar: "bg-radar text-ink", icon: "check", word: "Done" },
  info: { bar: "bg-cobalt text-white", icon: "info", word: "Note" },
  warn: { bar: "bg-signal text-ink", icon: "alert", word: "Heads up" },
  error: { bar: "bg-stamp-deep text-white", icon: "alert", word: "Failed" },
  ai: { bar: "bg-lilac text-ink", icon: "ai", word: "AI" },
};

const MAX = 4;

/** Mount once (app layout). Toasts stack bottom-right on desktop, above the tab bar on phones. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => {
      if (ms <= 0) return;
      const prev = timers.current.get(id);
      if (prev) clearTimeout(prev);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      );
    },
    [dismiss],
  );

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      const kind = input.kind ?? "ok";
      const duration = input.duration ?? (kind === "error" ? 9000 : 5000);
      setItems((list) => [...list.slice(-(MAX - 1)), { id, title: input.title, body: input.body, kind, duration }]);
      schedule(id, duration);
      return id;
    },
    [schedule],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-stretch gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:w-[24rem]"
      >
        {items.map((t) => {
          const k = KIND[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              onMouseEnter={() => {
                const timer = timers.current.get(t.id);
                if (timer) clearTimeout(timer);
              }}
              onMouseLeave={() => schedule(t.id, 2500)}
              className="pointer-events-auto flex animate-toast-in border-3 border-ink bg-card shadow-lg"
            >
              <div aria-hidden="true" className={cn("flex w-10 shrink-0 justify-center pt-2.5", k.bar)}>
                <Icon name={k.icon} size={20} />
              </div>
              <div className="min-w-0 flex-1 border-l-3 border-ink px-3 py-2.5">
                <p className="text-sm font-extrabold leading-snug">
                  <span className="sr-only">{k.word}: </span>
                  {t.title}
                </p>
                {t.body ? <p className="mt-0.5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{t.body}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="flex w-11 shrink-0 items-center justify-center border-l-3 border-ink hover:bg-acid"
              >
                <Icon name="close" size={16} />
                <span className="sr-only">Dismiss</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** `const { toast } = useToast(); toast({ title: "Saved", kind: "ok" })`. Safe outside the provider (no-op). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { toast: () => 0, dismiss: () => undefined };
}

/**
 * Fire a toast once from server-rendered output (e.g. after a redirect with ?saved=1).
 * <FlashToast id="saved-123" title="Settings saved" />
 */
export function FlashToast({ id, ...input }: ToastInput & { id: string }) {
  const { toast } = useToast();
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (fired.current === id) return;
    fired.current = id;
    toast(input);
    // Fire once per id; input is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, toast]);
  return null;
}
