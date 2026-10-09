import type { ComponentProps, ReactNode } from 'react';

export const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
// focus (not focus-visible): date and time fields only report focus on their inner parts
export const field = 'mt-1.5 block w-full rounded-3xl border border-muted bg-surface px-4 py-3 text-lg md:py-2 font-normal focus:outline-2 focus:outline-offset-2 focus:outline-ink';
export const primary = `flex min-h-12 w-full rounded-full items-center justify-center bg-turmeric px-6 font-semibold text-on-turmeric hover:brightness-95 disabled:opacity-60 ${focus}`;
export const secondary = `flex min-h-12 w-full rounded-full items-center justify-center border border-muted bg-surface px-6 font-semibold hover:bg-paper disabled:opacity-60 ${focus}`;
/** A label wrapping a checkbox; turns turmeric when ticked. */
export const checkChip = 'flex min-h-12 items-center justify-center gap-2 rounded-full border border-muted bg-surface font-semibold has-[:checked]:border-turmeric has-[:checked]:bg-turmeric has-[:checked]:text-on-turmeric';
export const link = `font-semibold text-turmeric-ink underline-offset-4 hover:underline ${focus}`;

export function Field({ label, hint, className = '', ...input }: { label: string; hint?: string; name: string } & ComponentProps<'input'>) {
  return (
    <label className="block font-semibold">
      {label}
      <input className={`${field} ${className}`} aria-describedby={hint ? `${input.name}-hint` : undefined} {...input} />
      {hint && <span id={`${input.name}-hint`} className="mt-1 block text-[15px] font-normal text-muted">{hint}</span>}
    </label>
  );
}

export const PinField = (p: { label: string; name: string; autoComplete: string }) => (
  <Field type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required {...p} />
);

/** A card that folds away: the title is the button, the content shows when opened. */
/** `open` only sets how the page first loads; after that the reader decides. */
export function Fold({ id, title, lead, level = 2, open, children }: { id?: string; title: string; lead?: string; level?: 2 | 3; open?: boolean; children: ReactNode }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <details id={id} open={open} className="group mt-3 scroll-mt-24 rounded-3xl border border-line bg-surface">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 rounded-3xl p-5 [&::-webkit-details-marker]:hidden ${focus}`}>
        <H className="text-lg font-bold">{title}</H>
        <span aria-hidden="true" className="text-2xl leading-none text-muted transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="px-5 pb-5">
        {lead && <p className="text-muted">{lead}</p>}
        {children}
      </div>
    </details>
  );
}

/** A list that can grow long. Wider screens: every row, scrolling inside the card so the card's title and the page around
 *  it stay put. Phones (a scroll box inside a scrolling page is a trap there): the first `keep` rows, then Show all.
 *  `fill`: on wider screens the box takes exactly the height left in a stretched card, so the card ends level with the
 *  column beside it; the absolute box adds no height of its own (24rem at least). `short`: about three rows, for a list
 *  that sits above a page's main content. Otherwise it stops at 70% of the screen.
 *  No tabIndex: browsers make a scroll box keyboard-focusable themselves, and on phones nothing here scrolls. */
export function LongList({ items, keep, label, more, less, fill, short }: { items: ReactNode[]; keep: number; label: string; more: string; less: string; fill?: boolean; short?: boolean }) {
  const list = 'divide-y divide-line';
  return (
    <div className={fill ? 'mt-3 md:relative md:min-h-96 md:flex-1' : 'mt-3'}>
      <div role="group" aria-label={label} className={`md:overflow-y-auto md:pr-3 md:[scrollbar-width:thin] ${fill ? 'md:absolute md:inset-0' : short ? 'md:max-h-64' : 'md:max-h-[70vh]'}`}>
        <ul className={list}>{items.slice(0, keep)}</ul>
        {items.length > keep && (<>
          {/* between the first rows and the rest: one order for eyes, keyboards and screen readers (peer-open needs it first) */}
          <details className="group/all peer md:hidden">
            <summary className={`mt-2 inline-flex min-h-11 cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden ${link}`}>
              <span className="group-open/all:hidden">{more}</span>
              <span className="hidden group-open/all:inline">{less}</span>
            </summary>
          </details>
          <ul className={`${list} hidden border-t border-line peer-open:block md:block`}>{items.slice(keep)}</ul>
        </>)}
      </div>
    </div>
  );
}

/** A small label above a group of cards. */
export const groupLabel = 'mt-10 text-[15px] font-semibold text-muted';

/** Shown for the moment a logged-in page waits for the database: the shape of the page, no words. */
export function PageSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto max-w-md animate-pulse md:max-w-7xl md:px-8 px-5 pt-5 motion-reduce:animate-none">
      <div className="h-8 w-32 rounded-lg bg-line" />
      <div className="mt-10 h-9 w-56 rounded-lg bg-line" />
      <div className="mt-8 h-40 rounded-2xl bg-line" />
      <div className="mt-4 h-24 rounded-2xl bg-line" />
    </div>
  );
}
