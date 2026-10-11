'use client';

import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from 'react';

/** `confirm`: the server refused until the person ticks this box (it then posts fix=1): a deliberate choice, asked only when needed. */
export type FormState = { error?: string; done?: string; confirm?: string } | null;

/** Runs a Server Action and shows its error or success line. Submits by hand so React doesn't clear the fields on an error. */
/** `clearOnDone` empties the fields after a success (PINs on a shared phone). */
export function ActionForm({ action, children, className, clearOnDone }: { action: (prev: FormState, data: FormData) => Promise<FormState>; children: ReactNode; className?: string; clearOnDone?: boolean }) {
  const [state, run, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  const [n, setN] = useState(0);   // one key per submit, so the same message twice is announced twice
  useEffect(() => { if (clearOnDone && state?.done) form.current?.reset(); }, [state, clearOnDone]);
  return (
    <form
      ref={form}
      className={className}
      onSubmit={e => {
        e.preventDefault();
        if (pending) return;
        setN(k => k + 1);
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      <fieldset aria-busy={pending} className="space-y-5 aria-busy:pointer-events-none aria-busy:opacity-60">{children}</fieldset>
      {state?.error && <p role="alert" className="mt-4 font-semibold text-chili">{state.error}</p>}
      {state?.confirm && (
        <label className="mt-3 flex min-h-11 items-start gap-3 font-semibold">
          <input type="checkbox" name="fix" value="1" className="mt-1 size-5 shrink-0 accent-turmeric" />{state.confirm}
        </label>
      )}
      {state?.done && <p key={n} role="status" className="mt-4 font-semibold text-leaf">{state.done}</p>}
    </form>
  );
}
