'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** A submit button that dims while its form saves, so a slow tap isn't repeated. */
export function PendingButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return <button aria-busy={pending} className={`${className} aria-busy:pointer-events-none aria-busy:opacity-60`}>{children}</button>;
}
