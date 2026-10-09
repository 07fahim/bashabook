'use client';

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from 'react';

export type FormState = { error?: string; done?: string } | null;

/** Runs a Server Action and shows its error or success line. Submits by hand so React doesn't clear the fields on an error. */
/** `clearOnDone` empties the fields after a success (PINs on a shared phone). */
export function ActionForm({ action, children, className, clearOnDone }: { action: (prev: FormState, data: FormData) => Promise<FormState>; children: ReactNode; className?: string; clearOnDone?: boolean }) {
  const [state, run, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (clearOnDone && state?.done) form.current?.reset(); }, [state, clearOnDone]);
  return (
    <form
      ref={form}
      className={className}
      onSubmit={e => {
        e.preventDefault();
        if (pending) return;
        // with the pressed button, so a form can have two (save, or take it back)
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => run(data));
      }}
    >
      <fieldset aria-busy={pending} className="space-y-5 aria-busy:pointer-events-none aria-busy:opacity-60">{children}</fieldset>
      {state?.error && <p role="alert" className="mt-4 font-semibold text-chili">{state.error}</p>}
      {state?.done && <p role="status" className="mt-4 font-semibold text-leaf">{state.done}</p>}
    </form>
  );
}
