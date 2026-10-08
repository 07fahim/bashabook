import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDictionary, hasLocale } from './dictionaries';
import { Khata } from './khata';
import { ThemeToggle } from './theme-toggle';

const focus = 'rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
const h2 = 'font-display text-3xl font-bold';

export default async function Landing({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang);
  const other = lang === 'bn' ? 'en' : 'bn';

  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <span className="flex items-center gap-2 font-display text-2xl font-bold">
          <Image src="/logo-mark.png" alt="" width={31} height={32} priority />
          <span>
            {t.brand}
            <span className="text-turmeric-ink">{t.brandAccent}</span>
          </span>
        </span>
        <div className="flex items-center gap-1">
          <ThemeToggle label={t.themeToggle} />
          <Link href={`/${other}`} hrefLang={other} lang={other} className={`px-3 py-2 text-muted underline-offset-4 hover:underline ${focus}`}>
            {t.switchLang}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5">
        <section className="grid items-center gap-10 py-6 md:grid-cols-2 md:py-14">
          <div>
            <h1 className="font-display text-4xl leading-tight font-bold text-balance sm:text-5xl md:text-6xl">{t.heroTitle}</h1>
            <p className="mt-5 max-w-prose text-lg text-muted">{t.heroBody}</p>
            <Link href={`/${lang}/new`} prefetch={false} className={`mt-8 inline-flex min-h-12 items-center bg-turmeric px-6 text-lg font-semibold text-on-turmeric hover:brightness-95 ${focus}`}>
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

        <section className="grid items-center gap-8 border-t border-line py-14 md:grid-cols-2">
          <div>
            <h2 className={h2}>{t.cookTitle}</h2>
            <p className="mt-3 text-muted">{t.cookBody}</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-muted">{t.cookCard.when}</p>
            <dl className="mt-2 grid grid-cols-3 text-center">
              {(['b', 'l', 'd'] as const).map((m, i) => (
                <div key={m}>
                  <dt className="text-muted">{t.cookCard[m]}</dt>
                  <dd className="font-display text-6xl font-bold tabular-nums">{t.cookCard.counts[i]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="grid items-center gap-8 border-t border-line py-14 md:grid-cols-2">
          <div>
            <h2 className={h2}>{t.settleTitle}</h2>
            <p className="mt-3 text-muted">{t.settleBody}</p>
          </div>
          <p className="max-w-xs justify-self-start rounded-2xl rounded-bl-sm bg-turmeric px-5 py-4 whitespace-pre-line text-on-turmeric md:justify-self-end">
            {t.settleMsg.join('\n')}
          </p>
        </section>

        <section className="border-t border-line py-14">
          <h2 className={h2}>{t.modesTitle}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {t.modes.map(mode => (
              <div key={mode.name} className="rounded-2xl border border-line bg-surface p-6">
                <h3 className="text-xl font-semibold">{mode.name}</h3>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
                  {mode.points.map(p => <li key={p}>{p}</li>)}
                </ul>
              </div>
            ))}
          </div>
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
        <p className="border-t border-line py-8 text-sm text-muted">{t.footer}</p>
      </footer>
    </>
  );
}
