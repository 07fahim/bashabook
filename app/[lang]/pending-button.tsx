'use client';

import type { ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';

/** A submit button that dims while its form saves, so a slow tap isn't repeated. */
export function PendingButton({ className, children, ...rest }: ComponentProps<'button'> & { className: string }) {
  const { pending } = useFormStatus();
  return <button {...rest} aria-busy={pending} className={`${className} aria-busy:pointer-events-none aria-busy:opacity-60`}>{children}</button>;
}
