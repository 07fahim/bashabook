'use client';

import { useState, type ReactNode } from 'react';

/** Pick a person and a day, then Show: `panel` (the controls for what is shown now) fades and can't be used once the pick
 *  changes, until Show loads the new pick, so a tap never changes the person or day picked before. Nothing submits by
 *  itself: arrowing through names or typing a date stays possible with the keyboard. */
export function ShowForm({ className, hint, children, panel }: { className: string; hint: string; children: ReactNode; panel: ReactNode }) {
  const [stale, setStale] = useState(false);
  return (<>
    {/* autoComplete off: a reload must not bring back a changed pick without its fade; the status stays mounted so a screen
        reader hears the hint when it appears */}
    <form className={className} autoComplete="off" onChange={() => setStale(true)}>
      {children}
      <p role="status" className={stale ? 'text-[15px] font-semibold' : 'sr-only'}>{stale ? hint : ''}</p>
    </form>
    <div inert={stale} className={stale ? 'opacity-40' : undefined}>{panel}</div>
  </>);
}
