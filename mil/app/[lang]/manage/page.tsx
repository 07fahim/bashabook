import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { listMembers } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireManager } from '@/lib/session';
import { ActionForm } from '../action-form';
import { addMemberAction, resetPinAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { Field, link, PinField, primary } from '../ui';

export default function Manage({ params }: PageProps<'/[lang]/manage'>) {
  return <Suspense><ManageBody params={params} /></Suspense>;
}

async function ManageBody({ params }: Pick<PageProps<'/[lang]/manage'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireManager(lang);
  const members = await listMembers(db, me.flatId);
  const t = getDictionary(lang), a = t.app;
  return (
    <>
      <Header t={t} lang={lang} path="/manage" />
      <main className="mx-auto max-w-md px-5 pb-16">
        <Link href={`/${lang}/home`} className={link}>← {a.back}</Link>
        <h1 className="mt-4 font-display text-3xl font-bold">{a.members}</h1>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {members.map(m => (
            <li key={m.id} className="py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-lg font-semibold">{m.name}</span>
                <span className={`text-[15px] ${m.locked ? 'font-semibold text-chili' : 'text-muted'}`}>
                  {!m.claimed ? a.notJoined : m.locked ? a.lockedBadge : m.failed > 0 ? `${a.failed}: ${m.failed}` : ''}
                </span>
              </div>
              {m.claimed && m.id !== me.memberId && (
                <details className="mt-2">
                  <summary className={`cursor-pointer text-[15px] ${link}`}>{a.resetPin}</summary>
                  <p className="mt-2 text-[15px] text-muted">{a.resetLead}</p>
                  <ActionForm action={resetPinAction} className="mt-3">
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <PinField label={a.oneTimePin} name="pin" autoComplete="off" />
                    <button className={primary}>{a.resetBtn}</button>
                  </ActionForm>
                </details>
              )}
            </li>
          ))}
        </ul>
        <h2 className="mt-10 text-xl font-bold">{a.addMember}</h2>
        <ActionForm action={addMemberAction} className="mt-4">
          <input type="hidden" name="lang" value={lang} />
          <Field label={a.memberName} name="name" required maxLength={40} autoComplete="off" />
          <button className={primary}>{a.addBtn}</button>
        </ActionForm>
      </main>
    </>
  );
}
