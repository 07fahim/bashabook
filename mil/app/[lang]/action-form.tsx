'use client';

import { startTransition, useActionState, type ReactNode } from 'react';

export type FormState = { error?: string; done?: string } | null;

/** Runs a Server Action and shows its error or success line. Submits by hand so React doesn't clear the fields on an error. */
export function ActionForm({ action, children, className }: { action: (prev: FormState, data: FormData) => Promise<FormState>; children: ReactNode; className?: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form
      className={className}
      onSubmit={e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      <fieldset disabled={pending} className="space-y-5">{children}</fieldset>
      {state?.error && <p role="alert" className="mt-4 font-semibold text-chili">{state.error}</p>}
      {state?.done && <p role="status" className="mt-4 font-semibold text-leaf">{state.done}</p>}
    </form>
  );
}
