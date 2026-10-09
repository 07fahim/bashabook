import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDictionary, hasLocale } from './dictionaries';
import { Khata } from './khata';
import { Header } from './header';
import { focus } from './ui';

const h2 = 'font-display text-3xl font-bold';
// ponytail: placeholder contacts, replace with the real WhatsApp number and email before launch
const WHATSAPP = 'https://wa.me/8801700000000';
const EMAIL = 'mailto:hello@bashabook.example';

export default async function Landing({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <>
      <Header t={t} lang={lang} path="" />

      <main className="mx-auto max-w-5xl px-5">
        <section className="grid items-center gap-10 py-6 md:grid-cols-2 md:py-14">
          <div>
            <h1 className="font-display text-4xl leading-tight font-bold text-balance sm:text-5xl md:text-6xl">{t.heroTitle}</h1>
            <p className="mt-5 max-w-prose text-lg text-muted">{t.heroBody}</p>
            <Link href={`/${lang}/new`} prefetch={false} className={`mt-8 inline-flex min-h-14 items-center bg-turmeric px-8 text-lg font-semibold text-on-turmeric hover:brightness-95 ${focus}`}>
              {t.create}
            </Link>
            <p className="mt-4 text-muted">
              {t.joinLead}{' '}
              <Link href={`/${lang}/join`} prefetch={false} className={`font-semibold text-turmeric-ink underline-offset-4 hover:underline ${focus}`}>
                {t.joinCta}
              </Link>
            </p>
          </div>
          <Khata t={t.khata} />
        </section>

        <section className="border-t border-line py-14" aria-labelledby="steps">
          <h2 id="steps" className={h2}>{t.stepsTitle}</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {t.steps.map((step, i) => (
              <li key={step.title} className="flex flex-col">
                <span className="grid size-10 place-items-center rounded-full bg-turmeric font-bold text-on-turmeric" aria-hidden="true">{i + 1}</span>
                <h3 className="mt-4 text-xl font-bold">{step.title}</h3>
                <p className="mt-2 text-muted">{step.body}</p>
                <p className="mt-4 self-start rounded-lg border border-line bg-surface px-3 py-1.5 font-semibold tabular-nums">{step.stat}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid items-center gap-8 border-t border-line py-14 md:grid-cols-2">
          <div>
            <h2 className={h2}>{t.settleTitle}</h2>
            <p className="mt-3 text-muted">{t.settleBody}</p>
          </div>
          <figure className="rounded-2xl border border-line bg-surface">
            <figcaption className="border-b border-line px-5 py-3 font-semibold">{t.chat.group}</figcaption>
            <div className="flex items-end gap-2 p-5">
              <Image src="/logo-mark.png" alt="" width={31} height={32} className="mb-7 shrink-0" />
              <div>
                <p className="mb-1 text-[15px] text-muted">{t.chat.sender}</p>
                <p className="rounded-2xl rounded-bl-sm bg-turmeric px-4 py-3 whitespace-pre-line text-on-turmeric">{t.settleMsg.join('\n')}</p>
                <p className="mt-1 text-[15px] text-muted">{t.chat.time}</p>
              </div>
            </div>
          </figure>
        </section>

        <section className="grid gap-8 border-t border-line py-14 md:grid-cols-2">
          <div>
            <h2 className={h2}>{t.trust.title}</h2>
            <p className="mt-3 text-lg text-muted">{t.trust.lead}</p>
          </div>
          <dl className="divide-y divide-line border-y border-line">
            {t.trust.points.map(([what, how]) => (
              <div key={what} className="py-4">
                <dt className="font-semibold">{what}</dt>
                <dd className="mt-1 text-muted">{how}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="grid gap-8 border-t border-line py-14 md:grid-cols-2 md:items-center">
          <div>
            <h2 className={h2}>{t.price.title}</h2>
            <p className="mt-3 text-lg text-muted">{t.price.lead}</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <p className="flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums">{t.price.amount}</span>
              <span className="text-lg text-muted">{t.price.period}</span>
            </p>
            <p className="mt-2 text-muted">{t.price.note}</p>
            <ul className="mt-6 space-y-3">
              {t.price.features.map(f => (
                <li key={f} className="flex items-start gap-3">
                  <svg className="mt-1 size-5 shrink-0 text-leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <Link href={`/${lang}/new`} prefetch={false} className={`mt-8 flex min-h-12 w-full items-center justify-center bg-turmeric px-6 font-semibold text-on-turmeric hover:brightness-95 ${focus}`}>
              {t.price.cta}
            </Link>
          </div>
        </section>

        <section className="grid gap-6 border-t border-line py-14 md:grid-cols-[1fr_2fr] md:gap-12">
          <h2 className={h2}>{t.faqTitle}</h2>
          <div className="divide-y divide-line border-y border-line">
            {t.faq.map(([q, a]) => (
              <details key={q} className="group">
                <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-semibold [&::-webkit-details-marker]:hidden ${focus}`}>
                  {q}
                  <span aria-hidden="true" className="text-2xl leading-none text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="pb-5 text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-5">
        <div className="space-y-4 border-t border-line py-8 text-[15px] text-muted">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-semibold text-ink">{t.footer.tagline}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={`inline-block py-2 font-semibold text-turmeric-ink underline-offset-4 hover:underline ${focus}`}>
                {t.footer.whatsapp}
              </a>
              <a href={EMAIL} className={`inline-block py-2 font-semibold text-turmeric-ink underline-offset-4 hover:underline ${focus}`}>
                {t.footer.email}
              </a>
            </div>
          </div>
          <p>{t.footer.privacy}</p>
        </div>
      </footer>
    </>
  );
}
