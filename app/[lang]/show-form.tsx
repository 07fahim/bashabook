'use client';

import type { ComponentProps } from 'react';

/** A form that shows what it picks as soon as a pick is complete, so the controls under it never belong to the person or day
 *  picked before. Its own Show button stays for keyboards and for a browser without JavaScript. */
export function ShowForm(props: ComponentProps<'form'>) {
  return <form {...props} onChange={e => { const f = e.currentTarget; if (f.checkValidity()) f.requestSubmit(); }} />;
}
