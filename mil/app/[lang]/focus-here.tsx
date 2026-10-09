'use client';

import { useEffect, useRef } from 'react';

/** Put inside a Fold opened from a link: scrolls to it and focuses its first field (content streams in after the jump). */
export function FocusHere() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = ref.current?.closest('details');
    box?.scrollIntoView({ block: 'start' });
    box?.querySelector<HTMLInputElement>('input:not([type=hidden])')?.focus({ preventScroll: true });
  }, []);
  return <span ref={ref} hidden />;
}
