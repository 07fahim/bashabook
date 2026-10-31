'use client';

import { useParams } from 'next/navigation';
import { useState, type ComponentProps } from 'react';
import { field, focus } from './ui';

const copy = { bn: ['দেখান', 'লুকান'], en: ['Show', 'Hide'] };

/** A field typed as dots, like a password, with an eye button that shows what was typed (PINs, the flat code). */
export function SecretField({ label, className = '', ...input }: { label: string; name: string } & ComponentProps<'input'>) {
  const [shown, setShown] = useState(false);
  const { lang } = useParams<{ lang: string }>();
  const word = (lang === 'bn' ? copy.bn : copy.en)[shown ? 1 : 0];
  return (
    <label className="block font-semibold">
      {label}
      <span className="relative block">
        <input {...input} type={shown ? 'text' : 'password'} className={`${field} pr-14 ${className}`} />
        {/* the mousedown keeps focus (and the phone keyboard) in the field */}
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => setShown(s => !s)}
          aria-label={lang === 'bn' ? `${label} ${word}` : `${word} ${label}`}
          className={`absolute top-1.5 right-1 bottom-0 grid w-12 place-items-center rounded-full text-muted hover:text-ink ${focus}`}
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {shown && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </span>
    </label>
  );
}
