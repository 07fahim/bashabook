import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDictionary, hasLocale } from './dictionaries';
import { Khata } from './khata';
import { Header } from './header';
import { focus } from './ui';

const h2 = 'font-display text-3xl font-bold';
// contact links show only once real ones are set: no placeholder that looks like a real number or address
const WHATSAPP: string | null = null;   // e.g. 'https://wa.me/8801XXXXXXXXX'
const EMAIL: string | null = null;      // e.g. 'mailto:name@example.com'

/** Line icons for the feature cards (24px grid). */
const ICONS = {
  meal: 'M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9',
  cook: 'M8 17v-4.2A3.5 3.5 0 0 1 9 6a3.5 3.5 0 0 1 6 0 3.5 3.5 0 0 1 1 6.8V17M8 17h8v4H8z',
  bazar: 'M6 7h12l-1 13H7L6 7ZM9 7a3 3 0 0 1 6 0',
  bill: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H3V7ZM3 7l12-4v4M16 13.5h2',
  settle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.5l3 3 5-6',
};

export default async function Landing({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <>
      <Header t={t} lang={lang} path="" />

      <main className="mx-auto max-w-7xl px-5 md:px-8">
        <section className="grid items-center gap-10 py-6 md:grid-cols-2 md:py-14">
          <div>
            <h1 className="font-display text-4xl leading-tight font-bold text-balance sm:text-5xl md:text-6xl">{t.heroTitle}</h1>
            <p className="mt-5 max-w-prose text-lg text-muted">{t.heroBody}</p>
            <Link href={`/${lang}/new`} prefetch={false} className={`mt-8 inline-flex min-h-14 items-center rounded-full bg-turmeric px-8 text-lg font-semibold text-on-turmeric hover:brightness-95 ${focus}`}>
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
                <p className="mt-4 self-start rounded-full border border-line bg-surface px-3 py-1.5 font-semibold tabular-nums">{step.stat}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* What the app covers, one card per part of running a flat */}
        <section className="border-t border-line py-14">
          <h2 className={h2}>{t.uses.title}</h2>
          <p className="mt-3 max-w-2xl text-lg text-muted">{t.uses.lead}</p>
          <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {t.uses.items.map(u => (
              <li key={u.title} className="rounded-3xl border border-line bg-surface p-6">
                <span className="grid size-12 place-items-center rounded-2xl bg-paper text-turmeric-ink" aria-hidden="true">
                  <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={ICONS[u.icon as keyof typeof ICONS]} />
                  </svg>
                </span>
                <h3 className="mt-5 text-xl font-bold">{u.title}</h3>
                <p className="mt-2 text-muted">{u.body}</p>
                <ul className="mt-4 space-y-2">
                  {u.points.map(p => (
                    <li key={p} className="flex items-start gap-2">
                      <svg className="mt-1 size-4 shrink-0 text-leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {p}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid items-center gap-8 border-t border-line py-14 md:grid-cols-2">
          <div>
            <h2 className={h2}>{t.settleTitle}</h2>
            <p className="mt-3 text-lg text-muted">{t.settleBody}</p>
          </div>
          {/* A group chat at month end: someone asks, BashaBook answers, someone replies. */}
          <figure className="overflow-hidden rounded-3xl border border-line bg-surface">
            <figcaption className="flex items-center gap-3 border-b border-line px-5 py-3 font-semibold">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-paper text-[15px]">4B</span>
              {t.chat.group}
            </figcaption>
            <div className="space-y-4 bg-paper p-5">
              <div>
                <p className="mb-1 text-[15px] text-muted">{t.chat.askBy}</p>
                <p className="inline-block rounded-2xl rounded-tl-sm border border-line bg-surface px-4 py-2">{t.chat.ask}</p>
              </div>
              <div className="flex items-start gap-2">
                <Image src="/logo-mark.png" alt="" width={31} height={32} className="mt-7 shrink-0" />
                <div className="w-full max-w-xs">
                  <p className="mb-1 text-[15px] text-muted">{t.chat.sender}</p>
                  <div className="rounded-2xl rounded-tl-sm bg-turmeric px-4 py-3 text-on-turmeric">
                    <p className="font-bold">{t.settleMsg[0]}</p>
                    <ul className="mt-2 space-y-1 tabular-nums">
                      {t.settleMsg.slice(1).map(line => {
                        const at = line.includes('৳') ? line.indexOf('৳') : line.length;   // no amount: the whole line is the label
                        return (
                          <li key={line} className="flex justify-between gap-4">
                            <span>{line.slice(0, at).trim()}</span>
                            <span className="font-semibold">{line.slice(at)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <p className="mt-1 text-[15px] text-muted">{t.chat.time}</p>
                </div>
              </div>
              <p className="ml-auto w-fit rounded-2xl rounded-tr-sm bg-ink px-4 py-2 text-paper">{t.chat.reply}</p>
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

      <footer className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="space-y-4 border-t border-line py-8 text-[15px] text-muted">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-semibold text-ink">{t.footer.tagline}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {WHATSAPP && (
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center font-semibold text-turmeric-ink underline-offset-4 hover:underline ${focus}`}>
                  {t.footer.whatsapp}
                </a>
              )}
              {EMAIL && (
              <a href={EMAIL} className={`inline-flex min-h-11 items-center font-semibold text-turmeric-ink underline-offset-4 hover:underline ${focus}`}>
                  {t.footer.email}
                </a>
              )}
            </div>
          </div>
          <p>{t.footer.privacy}</p>
        </div>
      </footer>
    </>
  );
}
