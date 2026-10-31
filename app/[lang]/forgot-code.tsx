import { EMAIL, WHATSAPP } from './contacts';
import type { Dict } from './dictionaries';
import { link } from './ui';

const contact = `inline-flex min-h-11 items-center ${link}`;

/** What to do when the flat code is lost: ask a flatmate first, else the app team (ops/collector-pin-recovery.md). */
export function ForgotCode({ t, className }: { t: Dict; className?: string }) {
  return (
    <div className={className}>
      <h2 className="font-semibold">{t.app.forgotTitle}</h2>
      <p className="mt-1 text-[15px] text-muted">{t.app.forgotLead}</p>
      <div className="flex flex-wrap gap-x-6">
        {WHATSAPP && <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={contact}>{t.footer.whatsapp}</a>}
        {EMAIL && <a href={EMAIL} className={contact}>{t.footer.email}</a>}
      </div>
    </div>
  );
}
