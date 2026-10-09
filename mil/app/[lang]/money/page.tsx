import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, daysOfMonth, todayDhaka } from '@/lib/meals';
import { foodSplit } from '@/lib/money';
import { loadMonth, monthOf, toConfirm, type Entry } from '@/lib/money-db';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../action-form';
import { entryAction, putBackAction, removeAction } from '../actions';
import { DateField } from '../date-field';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay, fmtMeals, fmtMonth, fmtRate, fmtTaka } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { PayerSelect } from '../payer-select';
import { checkChip, Field, Fold, focus, link, LongList, PageSkeleton, primary } from '../ui';
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
  const myMeals = mo.meals.get(me.memberId) ?? 0, myGuests = mo.guestMeals.get(me.memberId) ?? 0;
  const guestFood = r ? foodSplit(r.foodCost, myMeals, myGuests).guests : 0;   // own + guests = food cost, tested
  // meal counts are the engine's own numbers (hundredths, guests inside the host's count); the flat total is their sum
  const totalMeals = [...mo.meals.values()].reduce((a, b) => a + b, 0);
  const meals = (h: number) => (h === 100 ? x.mealsOne : x.mealsN).replace('{n}', fmtMeals(h));
  const billLines = mo.result.lines.filter(l => l.memberId === me.memberId && l.rowId !== 'bazar')
    .map(l => ({ id: l.rowId, amount: l.amount, note: mo.entries.find(e => e.id === l.rowId)?.note ?? x.types.bill }));

  // Only mine = entries I added, paid, received, deposited, or was picked for. Bills shared by everyone (and bazar) are not
  // 'mine' here: they'd make the filter show nearly everything, and My balance already lists my share of each one by name.
  // A one-off bill for everyone living here is stored with every name ticked, so a full list doesn't count as picked.
  const picked = (e: Entry) => e.selected.length < mo.members.length && e.selected.includes(me.memberId);
  const shown = mine ? mo.entries.filter(e => [e.createdBy, e.paidBy, e.memberId].includes(me.memberId) || picked(e)) : mo.entries;
  const dates = [...new Set(shown.map(e => e.date))];
  // phones show whole days up to 15 entries (more only if the first day alone is bigger), never splitting a day: its
  // heading would show twice on wide screens, where both parts are visible
  let keep = 0;
  for (let n = 0; keep < dates.length && (n += shown.filter(e => e.date === dates[keep]).length) <= 15; keep++);
  keep = Math.max(1, keep);
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
    <PayerSelect label={label} fundLabel={x.flatMoney.replace('{name}', collector.name)} today={today} initial={boss ? 'fund' : me.memberId}
      people={mo.members.filter(p => p.id !== collector.id).map(p => ({ id: p.id, name: p.name, joinedOn: p.joinedOn, leftOn: p.leftOn }))} />
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

        {waiting.length > 0 && <div className="mt-6"><ConfirmList lang={lang} a={t.app} x={x} items={waiting} collector={collector.name} /></div>}

        {/* desktop: my balance and the three forms on the left; the flat summary over the entries on the right, two thirds wide,
            so both sides grow downward together and no column leaves a hole */}
        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* balance, forms and everyone's balances (8 to 10 people): about as tall as the summary and entries beside them */}
          <div>
            <section className={card}>
              <h2 className="text-xl font-bold">{t.app.hi}, {me.name}</h2>
              {!r || !balance ? <p className="mt-2 text-muted">{x.notHere}</p> : (<>
                <p className={`mt-2 text-2xl font-bold ${balance.tone}`}>{balance.text}</p>
                <details className="mt-3">
                  <summary className={`inline-flex min-h-11 cursor-pointer items-center ${link}`}>{x.breakdown}</summary>
                  <dl className="mt-2 space-y-1 [&>div]:flex [&>div]:justify-between [&>div]:gap-4 [&_dd]:tabular-nums">
                    <div className="font-semibold"><dt>{x.share}</dt><dd>{signed('−', r.foodCost + r.billShare)}</dd></div>
                    <div className="pl-4"><dt>{x.myMeals} · {meals(myMeals - myGuests)}</dt><dd>{fmtTaka(r.foodCost - guestFood)}</dd></div>
                    {myGuests > 0 && <div className="pl-4"><dt>{x.guestMeals} · {meals(myGuests)}</dt><dd>{fmtTaka(guestFood)}</dd></div>}
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
                {/* "I paid" only credits me; money paid for a friend must be recorded by the collector under the friend's name */}
                {!boss && <p className="mt-2 font-semibold">{x.forSomeone.replaceAll('{name}', collector.name)}</p>}
                <ActionForm action={entryAction} className="mt-4">
                  {hidden('deposit')}{amountDate}
                  <Field label={x.noteRef} name="note" maxLength={100} />
                  <button className={primary}>{x.save}</button>
                </ActionForm>
              </Fold>
            </>)}
            {/* everyone's balance grows with the flat (8 to 10 people): here it fills the side column beside the long list */}
            <section className={`mt-3 ${card}`}>
              <h2 className="text-xl font-bold">{x.everyone}</h2>
              <ul className="mt-1 divide-y divide-line">
                {mo.result.perMember.map(p => (
                  <li key={p.id} className="flex justify-between gap-4 py-2">
                    <span>{name(p.id)}<span className="block text-[15px] text-muted">{meals(mo.meals.get(p.id) ?? 0)}</span></span>
                    <span className={`font-semibold tabular-nums ${balanceText(x, p.balance).tone}`}>{p.balance > 0 ? '+' : p.balance < 0 ? '−' : ''}{fmtTaka(p.balance)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="flex flex-col gap-6 lg:col-span-2">
          <section className={card}>
            <h2 className="text-xl font-bold">{x.summary}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {([[x.totalBazar, fmtTaka(sum(ok.filter(e => e.type === 'bazar')))], [x.totalBills, fmtTaka(sum(ok.filter(e => e.type === 'bill')))],
                [x.mealRate, fmtRate(mo.result.mealRate, totalMeals), (month === thisMonth ? (totalMeals === 100 ? x.mealSoFar : x.mealsSoFar) : totalMeals === 100 ? x.mealsOne : x.mealsN).replace('{n}', fmtMeals(totalMeals))],
                [x.withName.replace('{name}', collector.name), `${mo.result.fund < 0 ? '−' : ''}${fmtTaka(mo.result.fund)}`]] as const).map(([k, v, sub]) => (
                <div key={k} className="rounded-xl bg-paper p-3">
                  <dt className="text-[15px] text-muted">{k}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{v}</dd>
                  {sub && <dd className="text-[15px] text-muted">{sub}</dd>}
                </div>
              ))}
            </dl>
            {mo.result.fund < 0 && <p className="mt-3 font-semibold">{x.flatOwes.replace('{name}', collector.name).replace('{t}', fmtTaka(mo.result.fund))}</p>}
            {!mo.result.invariantOk && <p className="mt-3 font-semibold text-chili">{x.problem}</p>}
            <h3 className="mt-5 font-semibold">{x.settleTitle}</h3>
            {settle.length ? <ul className="mt-1 list-disc space-y-1 pl-5 md:columns-2 md:gap-10">{settle.map(s => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted">{x.nobodyOwes}</p>}
          </section>

          <section className={`flex flex-1 flex-col ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">{x.entries}</h2>
              <Link href={href(month, !mine)} aria-pressed={mine} className={`inline-flex min-h-11 items-center rounded-full border border-muted px-4 font-semibold ${mine ? 'bg-turmeric text-on-turmeric border-turmeric' : ''} ${focus}`}>{x.onlyMine}</Link>
            </div>
            {!dates.length ? <p className="mt-3 text-muted">{x.noEntries}</p> : <LongList fill label={x.entries} keep={keep} more={t.app.showAll.replace('{n}', String(shown.length))} less={t.app.showLess} items={dates.map(d => (
                <li key={d}>
                  <h3 className="pt-4 text-[15px] font-semibold text-muted">{fmtDay(d, lang)}</h3>
                  <ul className="divide-y divide-line">
                    {shown.filter(e => e.date === d).map(e => (
                      <li key={e.id} className="group py-3">
                        <div className="flex items-start justify-between gap-x-3">
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
                          {(month === thisMonth || e.status === 'pending') && (boss || (e.createdBy === me.memberId && (e.type !== 'deposit' || e.status === 'pending'))) && (
                            <details>
                              <summary aria-label={`${x.remove}: ${x.types[e.type]} ${fmtTaka(e.amount)}`} className={`inline-flex min-h-11 cursor-pointer list-none items-center px-2 ${link}`}>{x.remove}</summary>
                            </details>
                          )}
                        </div>
                        </div>
                        {/* shown only while this entry's Remove fold is open: a second, deliberate tap */}
                        <form action={removeAction} className="mt-2 hidden flex-wrap items-center justify-end gap-3 group-has-[details[open]]:flex">
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="id" value={e.id} />
                          <span id={`rm-${e.id}`}>{x.confirmRemove.replace('{what}', `${x.types[e.type]} ${fmtTaka(e.amount)}`)}</span>
                          <button aria-describedby={`rm-${e.id}`} className={`inline-flex min-h-11 items-center rounded-full border border-chili px-5 font-semibold text-chili hover:bg-paper ${focus}`}>{x.yesRemove}</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </li>
              ))} />}
            {/* removed entries are rarely needed: folded behind their count, still one tap from Put back */}
            {!mine && mo.removed.length > 0 && (
              <details className="mt-4 border-t border-line pt-2">
              <summary className={`inline-flex min-h-11 cursor-pointer items-center ${link}`}>{x.removedTitle.replace('{n}', String(mo.removed.length))}</summary>
              <div className="text-[15px] text-muted">
              <LongList label={x.removedTitle.replace('{n}', String(mo.removed.length))} keep={5} more={t.app.showAll.replace('{n}', String(mo.removed.length))} less={t.app.showLess} items={mo.removed.map(rm => (
                  <li key={rm.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">{x.types[rm.type]} · {fmtDay(rm.date, lang)}{rm.note ? ` · ${rm.note}` : ''} · {x.removedBy.replace('{name}', rm.by)}</span>
                    <span className="flex items-center gap-2">
                      <s className="tabular-nums">{fmtTaka(rm.amount)}</s>
                      {month === thisMonth && (boss || rm.byId === me.memberId) && (
                        <form action={putBackAction}>
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="id" value={rm.id} />
                          <button aria-label={`${x.putBack}: ${x.types[rm.type]} ${fmtTaka(rm.amount)}`} className={`min-h-11 px-2 ${link}`}>{x.putBack}</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))} />
              </div>
              </details>
            )}
          </section>
          </div>
        </div>
      </main>
    </>
  );
}
