import Link from 'next/link';
import { EMAIL, WHATSAPP } from './contacts';
import type { Dict, Locale } from './dictionaries';
import { link } from './ui';

const contact = `inline-flex min-h-11 items-center ${link}`;

/** A lost flat code or PIN: a code by email first; without an email a flatmate or the app team (ops/collector-pin-recovery.md). */
export function ForgotCode({ t, lang, className }: { t: Dict; lang: Locale; className?: string }) {
  return (
    <div className={className}>
      <h2 className="font-semibold">{t.app.forgotTitle}</h2>
      <p className="mt-1 text-[15px] text-muted">{t.app.forgotLead}</p>
      <Link href={`/${lang}/forgot`} className={contact}>{t.app.forgotLink}</Link>
      <p className="mt-3 text-[15px] text-muted">{t.app.forgotNoEmail}</p>
      <Contacts t={t} />
    </div>
  );
}

/** The app team's WhatsApp and email links (also on the forgot page when an email has no flat). */
export function Contacts({ t, className = 'flex flex-wrap gap-x-6' }: { t: Dict; className?: string }) {
  return (
    <div className={className}>
      {WHATSAPP && <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={contact}>{t.footer.whatsapp}</a>}
      {EMAIL && <a href={EMAIL} className={contact}>{t.footer.email}</a>}
    </div>
  );
}
