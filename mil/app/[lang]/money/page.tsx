import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, daysOfMonth, todayDhaka } from '@/lib/meals';
import { foodSplit } from '@/lib/money';
import { loadMonth, monthOf, toConfirm, type Entry } from '@/lib/money-db';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../action-form';
import { entryAction, removeAction } from '../actions';
import { DateField } from '../date-field';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay, fmtMonth, fmtTaka } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { checkChip, field, Field, Fold, focus, link, PageSkeleton, primary } from '../ui';
import { balanceText, ConfirmList } from './bits';

export default function Money({ params, searchParams }: PageProps<'/[lang]/money'>) {
  return <Suspense fallback={<PageSkeleton />}><MoneyBody params={params} searchParams={searchParams} /></Suspense>;
}

const sum = (rows: Entry[]) => rows.reduce((a, e) => a + e.amount, 0);
/** '+৳500' / '−৳300', so the breakdown reads as a sum; no sign on ৳0. */
const signed = (sign: '+' | '−', p: number) => `${p ? sign : ''}${fmtTaka(p)}`;

async function MoneyBody({ params, searchParams }: Pick<PageProps<'/[lang]/money'>, 'params' | 'searchParams'>) {
  const { lang } = await params;
  const sp = await searchParams;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), x = t.money, boss = me.role === 'manager';
  const today = todayDhaka(), thisMonth = monthOf(today);
  // ?m=2026-09 picks a month; never later than this month
  const asked = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? `${sp.m}-01` : thisMonth;
  const month = asked > thisMonth ? thisMonth : asked, mine = sp.mine === '1';
  const [mo, waiting] = await Promise.all([loadMonth(db, me.flatId, month, today), toConfirm(db, me.flatId, me.memberId, boss)]);
  const name = (id: string | null) => mo.all.find(p => p.id === id)?.name ?? '?';
  const collector = mo.all.find(p => p.role === 'manager')!;
  const prev = monthOf(addDays(month, -1)), next = addDays(daysOfMonth(month).at(-1)!, 1);
  const href = (m: string, only: boolean) => `/${lang}/money?${new URLSearchParams({ ...(m !== thisMonth ? { m: m.slice(0, 7) } : {}), ...(only ? { mine: '1' } : {}) })}`;
  const arrow = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-muted font-semibold hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 ${focus}`;
  const card = 'rounded-3xl border border-line bg-surface p-5';

  const ok = mo.entries.filter(e => e.status === 'ok');
  const r = mo.result.perMember.find(p => p.id === me.memberId);
  const deposited = sum(ok.filter(e => e.type === 'deposit' && e.memberId === me.memberId));
  const spent = sum(ok.filter(e => e.type !== 'deposit' && e.type !== 'payout' && e.paidBy === me.memberId));
  const myMeals = mo.meals.get(me.memberId) ?? 0;
  const guestFood = r ? foodSplit(r.foodCost, myMeals, mo.guestMeals.get(me.memberId) ?? 0).guests : 0;   // own + guests = food cost, tested
  const billLines = mo.result.lines.filter(l => l.memberId === me.memberId && l.rowId !== 'bazar')
    .map(l => ({ id: l.rowId, amount: l.amount, note: mo.entries.find(e => e.id === l.rowId)?.note ?? x.types.bill }));

  // Only mine = entries I added, paid, received, deposited, or was picked for. Bills shared by everyone (and bazar) are not
  // 'mine' here: they'd make the filter show nearly everything, and My balance already lists my share of each one by name.
  // A one-off bill for everyone living here is stored with every name ticked, so a full list doesn't count as picked.
  const picked = (e: Entry) => e.selected.length < mo.members.length && e.selected.includes(me.memberId);
  const shown = mine ? mo.entries.filter(e => [e.createdBy, e.paidBy, e.memberId].includes(me.memberId) || picked(e)) : mo.entries;
  const dates = [...new Set(shown.map(e => e.date))];
  const who = (e: Entry) =>
    e.type === 'deposit' ? (e.memberId === collector.id ? collector.name : `${name(e.memberId)} → ${collector.name}`)
    : e.type === 'payout' ? `${collector.name} → ${name(e.memberId)}`
    : e.paidBy ? x.paidBy.replace('{name}', name(e.paidBy)) : x.fundPaid;
  const settle = mo.result.perMember.filter(p => p.balance !== 0).map(p => {
    const a = name(p.id), amt = fmtTaka(p.balance);
    if (p.id === collector.id) return (p.balance > 0 ? x.takes : x.adds).replace('{a}', a).replace('{t}', amt);
    return x.paysTo.replace('{a}', p.balance < 0 ? a : collector.name).replace('{b}', p.balance < 0 ? collector.name : a).replace('{t}', amt);
  });

  const hidden = (type: Entry['type']) => (<><input type="hidden" name="lang" value={lang} /><input type="hidden" name="type" value={type} /></>);
  const amountDate = (<>
    <Field label={x.amount} name="amount" inputMode="decimal" required placeholder="2450" />
    <DateField lang={lang} label={x.date} name="date" required min={monthOf(today)} max={today} defaultValue={today} />
  </>);
  const whoPaid = (label: string) => (
    <label className="block font-semibold">
      {label}
      <select name="who" defaultValue={boss ? 'fund' : me.memberId} className={field}>
        <option value="fund">{x.flatMoney.replace('{name}', collector.name)}</option>
        {mo.members.filter(p => p.id !== collector.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
  const balance = r && balanceText(x, r.balance);

  return (
    <>
      <Header t={t} lang={lang} path="/money"><Nav t={t} lang={lang} current="money" showFlat={boss} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        <nav aria-label={x.monthNav} className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold">{fmtMonth(month)}</h1>
          <span className="flex gap-2">
            {/* at the ends a plain span, not a link: keyboard users can't follow a link that only looks disabled */}
            {month <= mo.first ? <span aria-disabled="true" aria-label={x.prevMonth} className={arrow}>←</span>
              : <Link href={href(prev, mine)} aria-label={x.prevMonth} className={arrow}>←</Link>}
            {month >= thisMonth ? <span aria-disabled="true" aria-label={x.nextMonth} className={arrow}>→</span>
              : <Link href={href(next, mine)} aria-label={x.nextMonth} className={arrow}>→</Link>}
          </span>
        </nav>

        {waiting.length > 0 && <div className="mt-6"><ConfirmList lang={lang} x={x} items={waiting} collector={collector.name} /></div>}

        <div className="mt-6 grid gap-6 md:grid-cols-2 md:items-start lg:grid-cols-3">
          <div>
            <section className={card}>
              <h2 className="text-xl font-bold">{t.app.hi}, {me.name}</h2>
              {!r || !balance ? <p className="mt-2 text-muted">{x.notHere}</p> : (<>
                <p className={`mt-2 text-2xl font-bold ${balance.tone}`}>{balance.text}</p>
                <details className="mt-3">
                  <summary className={`inline-flex min-h-11 cursor-pointer items-center ${link}`}>{x.breakdown}</summary>
                  <dl className="mt-2 space-y-1 [&>div]:flex [&>div]:justify-between [&>div]:gap-4 [&_dd]:tabular-nums">
                    <div className="font-semibold"><dt>{x.share}</dt><dd>{signed('−', r.foodCost + r.billShare)}</dd></div>
                    <div className="pl-4"><dt>{x.myMeals}</dt><dd>{fmtTaka(r.foodCost - guestFood)}</dd></div>
                    {guestFood > 0 && <div className="pl-4"><dt>{x.guestMeals}</dt><dd>{fmtTaka(guestFood)}</dd></div>}
                    {billLines.map(b => <div key={b.id} className="pl-4"><dt>{b.note}</dt><dd>{fmtTaka(b.amount)}</dd></div>)}
                    <div><dt>{x.deposited}</dt><dd>{signed('+', deposited)}</dd></div>
                    <div><dt>{x.spent}</dt><dd>{signed('+', spent)}</dd></div>
                    <div><dt>{x.received}</dt><dd>{signed('−', r.payouts)}</dd></div>
                    <div className="border-t border-line pt-1 font-bold"><dt>{x.balance}</dt><dd>{r.balance < 0 ? '−' : ''}{fmtTaka(r.balance)}</dd></div>
                  </dl>
                </details>
              </>)}
            </section>
            {month === thisMonth && (<>
              <Fold title={x.addBazar} lead={x.bazarLead}>
                <ActionForm action={entryAction} className="mt-4">
                  {hidden('bazar')}{amountDate}{whoPaid(x.whoPaidShop)}
                  <Field label={x.note} name="note" maxLength={100} />
                  <button className={primary}>{x.save}</button>
                </ActionForm>
              </Fold>
              <Fold title={x.addBill} lead={x.billLead}>
                <ActionForm action={entryAction} className="mt-4">
                  {hidden('bill')}
                  <Field label={x.billName} hint={x.billNameHint} name="note" required maxLength={100} />
                  {amountDate}{whoPaid(x.whoPaidBill)}
                  <fieldset className="group">
                    <legend className="font-semibold">{x.whoShares}</legend>
                    <div className="mt-2 space-y-1">
                      {(['here', 'equal', 'room', 'meals', 'selected'] as const).map(s => (
                        <label key={s} className="flex min-h-11 items-center gap-3">
                          <input type="radio" name="split" value={s} id={s === 'selected' ? 'split-some' : undefined} defaultChecked={s === 'here'} className="size-5 shrink-0 accent-turmeric" />
                          {x.splits[s]}
                        </label>
                      ))}
                    </div>
                    {/* the people only matter for Only some people */}
                    <div className="mt-2 hidden grid-cols-2 gap-2 group-has-[#split-some:checked]:grid">
                      {mo.members.map(p => (
                        <label key={p.id} className={`${checkChip} px-3`}>
                          <input type="checkbox" name="people" value={p.id} className="size-5 shrink-0 accent-on-turmeric" />{p.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {boss && (
                    <label className="flex items-start gap-3">
                      <input type="checkbox" name="repeat" value="1" className="mt-1 size-5 shrink-0 accent-turmeric" />
                      <span><span className="font-semibold">{x.repeat}</span><span className="block text-[15px] text-muted">{x.repeatHint}</span></span>
                    </label>
                  )}
                  <button className={primary}>{x.save}</button>
                </ActionForm>
              </Fold>
              <Fold title={x.iPaid} lead={boss ? x.iPaidLeadSelf : x.iPaidLead.replaceAll('{name}', collector.name)}>
                <ActionForm action={entryAction} className="mt-4">
                  {hidden('deposit')}{amountDate}
                  <Field label={x.noteRef} name="note" maxLength={100} />
                  <button className={primary}>{x.save}</button>
                </ActionForm>
              </Fold>
            </>)}
          </div>

          <section className={card}>
            <h2 className="text-xl font-bold">{x.summary}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {([[x.totalBazar, sum(ok.filter(e => e.type === 'bazar'))], [x.totalBills, sum(ok.filter(e => e.type === 'bill'))],
                [x.mealRate, mo.result.mealRate], [x.withName.replace('{name}', collector.name), Math.max(mo.result.fund, 0)]] as const).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-paper p-3">
                  <dt className="text-[15px] text-muted">{k}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{fmtTaka(v)}</dd>
                </div>
              ))}
            </dl>
            {mo.result.fund < 0 && <p className="mt-3 font-semibold">{x.flatOwes.replace('{name}', collector.name).replace('{t}', fmtTaka(mo.result.fund))}</p>}
            {!mo.result.invariantOk && <p className="mt-3 font-semibold text-chili">{x.problem}</p>}
            <h3 className="mt-5 font-semibold">{x.everyone}</h3>
            <ul className="mt-1 divide-y divide-line">
              {mo.result.perMember.map(p => (
                <li key={p.id} className="flex justify-between gap-4 py-2">
                  <span>{name(p.id)}</span>
                  <span className={`font-semibold tabular-nums ${balanceText(x, p.balance).tone}`}>{p.balance > 0 ? '+' : p.balance < 0 ? '−' : ''}{fmtTaka(p.balance)}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-5 font-semibold">{x.settleTitle}</h3>
            {settle.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{settle.map(s => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted">{x.nobodyOwes}</p>}
          </section>

          <section className={`${card} md:col-span-2 lg:col-span-1`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">{x.entries}</h2>
              <Link href={href(month, !mine)} aria-pressed={mine} className={`inline-flex min-h-11 items-center rounded-full border border-muted px-4 font-semibold ${mine ? 'bg-turmeric text-on-turmeric border-turmeric' : ''} ${focus}`}>{x.onlyMine}</Link>
            </div>
            {!dates.length && <p className="mt-3 text-muted">{x.noEntries}</p>}
            <ul>
              {dates.map(d => (
                <li key={d}>
                  <h3 className="mt-4 text-[15px] font-semibold text-muted">{fmtDay(d, lang)}</h3>
                  <ul className="divide-y divide-line">
                    {shown.filter(e => e.date === d).map(e => (
                      <li key={e.id} className="flex items-start justify-between gap-x-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{x.types[e.type]} · {who(e)}</p>
                          {e.note && <p className="text-[15px]">{e.note}</p>}
                          <p className="text-[15px] text-muted">
                            {x.addedBy.replace('{name}', name(e.createdBy))}
                            {e.status === 'pending' && <> · <span className="font-semibold text-ink">{x.pending}</span></>}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-bold tabular-nums">{fmtTaka(e.amount)}</span>
                          {(boss || (e.createdBy === me.memberId && (e.type !== 'deposit' || e.status === 'pending'))) && (
                            <form action={removeAction}>
                              <input type="hidden" name="lang" value={lang} />
                              <input type="hidden" name="id" value={e.id} />
                              <button aria-label={`${x.remove}: ${x.types[e.type]} ${fmtTaka(e.amount)}`} className={`min-h-11 px-2 ${link}`}>{x.remove}</button>
                            </form>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {!mine && mo.removed.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-t border-line text-[15px] text-muted">
                {mo.removed.map((rm, i) => (
                  <li key={i} className="flex justify-between gap-4 py-2">
                    <span>{x.types[rm.type]} · {fmtDay(rm.date, lang)}{rm.note ? ` · ${rm.note}` : ''} · {x.removedBy.replace('{name}', rm.by)}</span>
                    <s className="tabular-nums">{fmtTaka(rm.amount)}</s>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
