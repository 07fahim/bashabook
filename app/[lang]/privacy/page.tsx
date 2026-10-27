import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EMAIL, WHATSAPP } from '../contacts';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { focus } from '../ui';

export async function generateMetadata({ params }: PageProps<'/[lang]/privacy'>): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return { title: `${t.privacy.title} · ${t.brand}${t.brandAccent}` };
}

const link = `inline-flex min-h-11 items-center font-semibold text-turmeric-ink underline-offset-4 hover:underline ${focus}`;

export default async function Privacy({ params }: PageProps<'/[lang]/privacy'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), x = t.privacy;
  const section = ({ h, p }: { h: string; p: string[] }) => (
    <section className="mt-10">
      <h2 className="text-xl font-bold">{h}</h2>
      {p.map(s => <p key={s} className="mt-3">{s}</p>)}
    </section>
  );
  return (
    <>
      <Header t={t} lang={lang} path="/privacy" />
      {/* reading text: one column at a comfortable line length on every screen */}
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-6 text-[17px] leading-relaxed md:pt-16">
        <h1 className="font-display text-3xl font-bold md:text-4xl">{x.title}</h1>
        <p className="mt-2 text-muted">{x.updated}</p>
        <p className="mt-6 text-lg">{x.lead}</p>
        {section(x.keep)}
        {section(x.see)}
        {section(x.cookies)}
        {section(x.analytics)}
        <div className="mt-2 flex flex-wrap gap-x-6">
          <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" className={link}>{x.how}</a>
          <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className={link}>{x.optOut}</a>
        </div>
        {section(x.remove)}
        {section(x.contact)}
        <div className="mt-2 flex flex-wrap gap-x-6">
          {WHATSAPP && <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={link}>{t.footer.whatsapp}</a>}
          {EMAIL && <a href={EMAIL} className={link}>{t.footer.email}</a>}
        </div>
      </main>
    </>
  );
}
