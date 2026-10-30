import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { monthChecks, monthTotals, toCheck } from '@/lib/bazar';
import { cashSeen, closeInfo, latestClosed, maySeeCash } from '@/lib/close';
import { db } from '@/lib/db';
import { flatMoney, handoverHistory } from '@/lib/handover';
import { addDays, daysOfMonth, todayDhaka } from '@/lib/meals';
import { settleLines } from '@/lib/money';
import { loadMonth, monthOf, toConfirm, type Entry } from '@/lib/money-db';
import { requireMember } from '@/lib/session';
import { noticeCount } from '@/lib/notices';
import { ActionForm } from '../action-form';
import { correctionAction, entryAction, payDueAction, putBackAction, removeAction, seeCashAction } from '../actions';
import { CloseCard } from '../close-card';
import { DateField } from '../date-field';
import { getDictionary, hasLocale } from '../dictionaries';
import { dhakaDate, fmtDay, fmtExact, fmtMeals, fmtMonth, fmtRate, fmtSigned, fmtTaka, fmtTaka2, names } from '../format';
import { Header, withQuery } from '../header';
import { Nav } from '../nav';
import { PendingButton } from '../pending-button';
import { PayerSelect } from '../payer-select';
import { ReceiptPicker } from '../receipt-picker';
import { ShareButton } from '../share-button';
import { card, checkChip, field, Field, focal, Fold, focus, link, LongList, MethodField, PageSkeleton, primary, secondary } from '../ui';
import { balanceText, CheckList, ConfirmList, lookText, StatusChip } from './bits';
import { breakdownOf, breakdownText, pickWho, type Labels } from './breakdown';

export default function Money({ params, searchParams }: PageProps<'/[lang]/money'>) {
  return <Suspense fallback={<PageSkeleton />}><MoneyBody params={params} searchParams={searchParams} /></Suspense>;
}

async function MoneyBody({ params, searchParams }: Pick<PageProps<'/[lang]/money'>, 'params' | 'searchParams'>) {
  const { lang } = await params;
  const sp = await searchParams;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), x = t.money, boss = me.role === 'manager';
  const noticesP = noticeCount(db, me.flatId, me.memberId, me.role === 'manager');   // the bell's count, read alongside the page
  const today = todayDhaka(), thisMonth = monthOf(today);
  // ?m=2026-09 picks a month; never later than this month
  const asked = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? `${sp.m}-01` : thisMonth;
  const month = asked > thisMonth ? thisMonth : asked, mine = sp.mine === '1';
  const [mo, waiting, closing, history, checks] = await Promise.all([loadMonth(db, me.flatId, month, today), toConfirm(db, me.flatId, me.memberId),
    boss && month < thisMonth ? closeInfo(db, me.flatId, today) : null, handoverHistory(db, me.flatId), toCheck(db, me.flatId, me.memberId, today)]);   // the card only shows on the month to close
  const closed = mo.info?.status === 'closed';
  // a closed month's cash seen and checks (trust features 1 and 4): one more round trip, only for a closed month
  const [seen, maySee, mc, latest] = closed
    ? await Promise.all([cashSeen(db, me.flatId, month), maySeeCash(db, me.flatId, month, me.memberId), monthChecks(db, me.flatId, month), latestClosed(db, me.flatId, month)])
    : [[], false, null, false] as const;
  // where entries can be added: this month for everyone; an earlier month still open for the collector only
  const canAdd = month === thisMonth ? !closed : boss && mo.info?.status === 'open';
  const due = boss && !closed ? mo.entries.filter(e => e.status === 'due') : [];
  // money with the collector: a month's own fund, but for this month what they hold now. While last month is still open,
  // this month's own fund starts from 0, so it would show a false gap: add up every open month instead (flatMoney)
  const held = month === thisMonth && mo.earlierOpen ? await flatMoney(db, me.flatId, today) : mo.result.fund;
  const name = (id: string | null) => mo.all.find(p => p.id === id)?.name ?? '?';
  const collector = mo.all.find(p => p.role === 'manager')!;
  const totals = monthTotals(mo.entries), waitingBazar = closed ? 0 : mo.entries.filter(e => e.type === 'bazar' && !e.check).length;   // a closed month's no longer wait
  const prev = monthOf(addDays(month, -1)), next = addDays(daysOfMonth(month).at(-1)!, 1);
  const href = (m: string, only: boolean, who?: string) => `/${lang}/money?${new URLSearchParams({ ...(m !== thisMonth ? { m: m.slice(0, 7) } : {}), ...(only ? { mine: '1' } : {}), ...(who ? { who } : {}) })}`;
  const arrow = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-muted font-semibold hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 ${focus}`;

  // ?who= : the collector opens someone else's "How this adds up" (to explain or settle it, e.g. with someone moving out).
  // Only the collector, and only a person in this flat's month: anyone else, or an unknown id, gets their own.
  const whoId = pickWho(boss, me.memberId, sp.who, mo.result.perMember);
  const r = mo.result.perMember.find(p => p.id === (whoId ?? me.memberId));
  const own: Labels = { meals: x.myMeals, share: x.share, deposited: x.deposited, spent: x.spent, received: x.received, paidIn: x.paidIn };
  const bd = breakdownOf(mo, whoId ?? me.memberId, x, whoId ? x.of : own, mo.carriedFrom ?? prev, !!whoId);
  // meal counts are the engine's own numbers (hundredths, guests inside the host's count); the flat total is their sum
  const totalMeals = [...mo.meals.values()].reduce((a, b) => a + b, 0);
  const meals = (h: number) => (h === 100 ? x.mealsOne : x.mealsN).replace('{n}', fmtMeals(h));

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
    e.type === 'deposit' ? (e.memberId === e.heldBy ? name(e.heldBy) : `${name(e.memberId)} → ${name(e.heldBy)}`)
    : e.type === 'payout' ? `${name(e.heldBy)} → ${name(e.memberId)}`
    : e.type === 'adjustment' ? `${name(e.memberId)} → ${name(e.moves)}`
    : e.paidBy ? x.paidBy.replace('{name}', name(e.paidBy)) : x.fundPaid;
  const settle = mo.result.perMember.filter(p => p.balance !== 0).map(p => {
    const a = name(p.id), amt = fmtExact(p.balance);   // settle-up amounts to the poisha, as a shared breakdown says them
    if (p.id === collector.id) return (p.balance > 0 ? x.takes : x.adds).replace('{a}', a).replace('{t}', amt);
    return x.paysTo.replace('{a}', p.balance < 0 ? a : collector.name).replace('{b}', p.balance < 0 ? collector.name : a).replace('{t}', amt);
  });

  // a fresh one-time id each render: a save calls refresh(), so the next entry never reuses it; a failed save keeps it
  const hidden = (type: Entry['type']) => (<><input type="hidden" name="lang" value={lang} /><input type="hidden" name="type" value={type} /><input type="hidden" name="key" value={randomUUID()} /></>);
  // this month: from the 1st to today; an earlier month still open (the collector only): its own days, its last day first
  const [dFrom, dTo] = month === thisMonth ? [thisMonth, today] : [month, daysOfMonth(month).at(-1)!];
  const amountDate = (<>
    <Field label={x.amount} name="amount" inputMode="decimal" required placeholder="2450" />
    <DateField lang={lang} label={x.date} name="date" required min={dFrom} max={dTo} defaultValue={dTo} />
  </>);
  const whoPaid = (label: string) => (
    <PayerSelect label={label} fundLabel={x.flatMoney.replace('{name}', collector.name)} today={dTo} initial={boss ? 'fund' : me.memberId}
      people={mo.members.filter(p => p.id !== collector.id).map(p => ({ id: p.id, name: p.name, joinedOn: p.joinedOn, leftOn: p.leftOn }))} />
  );
  const balance = r && (whoId ? {
    text: (r.balance < 0 ? x.of.owes : r.balance > 0 ? x.of.gets : x.of.even).replace('{name}', name(whoId)).replace('{t}', fmtExact(r.balance)),
    tone: balanceText(x, r.balance).tone,
  } : balanceText(x, r.balance, mo.info?.status === 'closed'));
  // a closed month's fund was held by whoever closed it, not by today's collector if a handover happened since
  const holder = closed && mo.info?.cash ? name(mo.info.cash.by) : collector.name;

  return (
    <>
      <Header t={t} lang={lang} path={withQuery('/money', sp)} notices={await noticesP}><Nav t={t} lang={lang} topic={me.liveTopic} current="money" showFlat={boss} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        {sp.why === 'notSaved' && <p role="status" className="mb-4 font-semibold text-chili">{t.app.notSavedNote}</p>}
        <nav aria-label={x.monthNav} className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold">{fmtMonth(month)}</h1>
          <span className="flex gap-2">
            {/* at the ends a plain span, not a link: keyboard users can't follow a link that only looks disabled */}
            {month <= mo.first ? <span aria-disabled="true" aria-label={x.prevMonth} className={arrow}>←</span>
              : <Link href={href(prev, mine, whoId ?? undefined)} aria-label={x.prevMonth} className={arrow}>←</Link>}
            {month >= thisMonth ? <span aria-disabled="true" aria-label={x.nextMonth} className={arrow}>→</span>
              : <Link href={href(next, mine, whoId ?? undefined)} aria-label={x.nextMonth} className={arrow}>→</Link>}
          </span>
        </nav>
        {closed && <p className="mt-1 text-muted">{x.closedOn.replace('{d}', fmtDay(dhakaDate(mo.info!.closedAt!), lang))}</p>}
        {closed && boss && <a href={`/${lang}/money/export?m=${month.slice(0, 7)}`} download className={`mt-1 inline-flex min-h-11 items-center ${link}`}>{x.exportCsv}</a>}
        {mo.earlierOpen && !closed && (
          <p role="status" className="mt-4 rounded-2xl bg-paper p-4 font-semibold">{x.notClosedYet.replace('{month}', fmtMonth(mo.earlierOpen)).replace('{name}', collector.name)}</p>
        )}

        {closing && closing.month === month && <div className="mt-6"><CloseCard lang={lang} x={x} c={closing} collector={collector.name} warn={closing.looks.map(l => lookText(t, lang, l))} /></div>}

        {waiting.length > 0 && <div className="mt-6"><ConfirmList lang={lang} a={t.app} x={x} items={waiting} collector={collector.name} /></div>}
        {checks.length > 0 && <div className="mt-6"><CheckList lang={lang} a={t.app} x={x} items={checks} /></div>}
        {/* monthly bills copied into this month count nowhere until the collector pays them: the amount may differ this month */}
        {due.length > 0 && (
          <section className={`mt-6 ${card}`}>
            <h2 className="text-xl font-bold">{x.dueTitle}</h2>
            <p className="mt-1 max-w-prose text-[15px] text-muted">{x.dueLead}</p>
            <ul className="mt-2 divide-y divide-line">
              {due.map(e => (
                <li key={e.id} className="py-3">
                  <ActionForm action={payDueAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="id" value={e.id} />
                    <div className="min-w-0 grow"><Field label={e.note ?? x.types.bill} name="amount" inputMode="decimal" required defaultValue={String(e.amount / 100)} /></div>
                    <button className={`${primary} sm:w-auto`}>{x.paidBtn}</button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* desktop: my balance and the three forms on the left; the flat summary over the entries on the right, two thirds wide,
            so both sides grow downward together and no column leaves a hole */}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* balance, forms and everyone's balances (8 to 10 people): about as tall as the summary and entries beside them */}
          <div>
            <section id="balance" className={`${focal} scroll-mt-24`}>
              <h2 className="text-xl font-bold">{whoId ? x.of.title.replace('{name}', name(whoId)) : `${t.app.hi}, ${me.name}`}</h2>
              {!r || !balance || !bd ? <p className="mt-2 text-muted">{x.notHere}</p> : (<>
                <p className={`mt-2 text-2xl font-bold ${balance.tone}`}>{balance.text}</p>
                <details className="mt-3" open={!!whoId}>
                  <summary className={`inline-flex min-h-11 cursor-pointer items-center ${link}`}>{x.breakdown}</summary>
                  <dl className="mt-2 space-y-1 [&>div]:flex [&>div]:justify-between [&>div]:gap-4 [&_dd]:tabular-nums">
                    {bd.rows.map((row, i) => (
                      <div key={i} className={row.kind === 'head' ? 'font-semibold' : row.kind === 'sub' ? 'pl-4' : row.kind === 'total' ? 'border-t border-line pt-1 font-bold' : ''}>
                        <dt>{row.label}</dt><dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {/* rent split by room counts the whole month by one room: say so where each person reads their share */}
                  {mo.entries.some(e => e.split === 'room') && <p className="mt-2 max-w-prose text-[15px] text-muted">{x.roomMonthNote}</p>}
                </details>
                {/* sending it is always a deliberate tap: opening someone's breakdown shares nothing */}
                {whoId && (<>
                  <p className="mt-3 max-w-prose text-[15px] text-muted">{closed ? x.of.final.replace('{month}', fmtMonth(month)) : x.of.soFar.replace('{d}', fmtDay(today, lang)).replace('{month}', fmtMonth(month))}</p>
                  <div className="mt-3 sm:max-w-xs"><ShareButton text={breakdownText(mo.flat.name, month, name(whoId), bd, closed, today, x, lang, mo.earlierOpen, collector.name)} label={t.meals.share} copied={t.meals.copied} /></div>
                </>)}
              </>)}
              {whoId && <Link href={`${href(month, mine)}#balance`} scroll={false} className={`mt-2 inline-flex min-h-11 items-center ${link}`}>{x.of.back}</Link>}
            </section>
            {/* Add bazar lives on the Bazar list, with its item lines and receipt; the count says what still waits */}
            <Link href={`/${lang}/money/bazar${month !== thisMonth ? `?m=${month.slice(0, 7)}` : ''}`}
              className={`mt-3 flex min-h-11 items-center justify-between gap-4 ${card} hover:bg-paper ${focus}`}>
              <span className="min-w-0">
                <span className="block text-lg font-bold">{x.bazar.list}</span>
                <span className="block text-[15px] text-muted">{canAdd && `${x.bazar.addHere} `}{x.bazar.listLead}</span>
                {waitingBazar > 0 && <span className="block text-[15px] font-semibold text-turmeric-ink">{x.bazar.waitingN.replace('{n}', String(waitingBazar))}</span>}
              </span>
              <span aria-hidden="true" className="text-2xl leading-none text-muted">→</span>
            </Link>
            {canAdd && (<>
              {month !== thisMonth && <p className="max-w-prose text-[15px] text-muted">{x.lateLead.replaceAll('{month}', fmtMonth(month))}</p>}
              <Fold title={x.addBill} lead={x.billLead}>
                <ActionForm action={entryAction} className="mt-4" clearOnDone>
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
                  {boss && month === thisMonth && (
                    <label className="flex items-start gap-3">
                      <input type="checkbox" name="repeat" value="1" className="mt-1 size-5 shrink-0 accent-turmeric" />
                      <span><span className="font-semibold">{x.repeat}</span><span className="block text-[15px] text-muted">{x.repeatHint}</span></span>
                    </label>
                  )}
                  <ReceiptPicker label={x.bazar.addReceipt} change={x.bazar.changeReceipt} added={x.bazar.receiptAdded} failed={x.bazar.receiptFailed} hint={x.bazar.receiptHint} />
                  <button className={primary}>{x.save}</button>
                </ActionForm>
              </Fold>
              <Fold title={x.iPaid} lead={boss ? x.iPaidLeadSelf : x.iPaidLead.replaceAll('{name}', collector.name)}>
                {/* "I paid" only credits me; money paid for a friend must be recorded by the collector under the friend's name */}
                {!boss && <p className="mt-2 font-semibold">{x.forSomeone.replaceAll('{name}', collector.name)}</p>}
                <ActionForm action={entryAction} className="mt-4" clearOnDone>
                  {hidden('deposit')}{amountDate}
                  <MethodField label={x.method} labels={x.cashMethods} />
                  <Field label={x.noteRef} name="note" maxLength={100} />
                  <button className={primary}>{x.save}</button>
                </ActionForm>
              </Fold>
              {boss && month === thisMonth && mo.closedMonths.length > 0 && (
                <Fold title={x.correctTitle} lead={x.correctLead}>
                  <ActionForm action={correctionAction} className="group/c mt-4" clearOnDone>
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="key" value={randomUUID()} />
                    <label className="block font-semibold">{x.forMonth}
                      <select name="forMonth" className={field}>{mo.closedMonths.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}</select>
                    </label>
                    <fieldset>
                      <legend className="font-semibold">{x.whatHappened}</legend>
                      {(['bazar', 'bill', 'move'] as const).map(k => (
                        <label key={k} className="flex min-h-11 items-center gap-3">
                          <input type="radio" name="kind" value={k} id={`fix-${k}`} defaultChecked={k === 'bazar'} className="size-5 shrink-0 accent-turmeric" />{x.correctKinds[k]}
                        </label>
                      ))}
                    </fieldset>
                    <Field label={x.amount} name="amount" inputMode="decimal" required placeholder="2450" />
                    {/* no person preselected; not `required`: a hidden select would block the form, so the server answers an empty pick */}
                    <label className="block font-semibold group-has-[#fix-move:checked]/c:hidden">{x.whoPaid}
                      <select name="who" className={field} defaultValue=""><option value="" disabled>—</option>{mo.all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    </label>
                    <fieldset className="hidden space-y-1 group-has-[#fix-bill:checked]/c:block">
                      <legend className="font-semibold">{x.whoShares}</legend>
                      {(['equal', 'meals', 'selected'] as const).map(s => (
                        <label key={s} className="flex min-h-11 items-center gap-3">
                          <input type="radio" name="split" value={s} id={s === 'selected' ? 'fix-some' : undefined} defaultChecked={s === 'equal'} className="size-5 shrink-0 accent-turmeric" />{s === 'equal' ? x.splitEqualThatMonth : x.splits[s]}
                        </label>
                      ))}
                      <div className="hidden grid-cols-2 gap-2 group-has-[#fix-some:checked]/c:grid">
                        {mo.all.map(p => <label key={p.id} className={`${checkChip} px-3`}><input type="checkbox" name="people" value={p.id} className="size-5 shrink-0 accent-on-turmeric" />{p.name}</label>)}
                      </div>
                    </fieldset>
                    <div className="hidden gap-3 group-has-[#fix-move:checked]/c:grid sm:grid-cols-2">
                      {(['from', 'to'] as const).map(k => (
                        <label key={k} className="block font-semibold">{k === 'from' ? x.moveFrom : x.moveTo}
                          <select name={k} className={field} defaultValue=""><option value="" disabled>—</option>{mo.all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                        </label>
                      ))}
                    </div>
                    <Field label={x.reason} name="note" required maxLength={100} />
                    <button className={primary}>{x.save}</button>
                  </ActionForm>
                </Fold>
              )}
            </>)}
            {/* everyone's balance grows with the flat (8 to 10 people): here it fills the side column beside the long list */}
            <section className={`mt-3 ${card}`}>
              <h2 className="text-xl font-bold">{x.everyone}</h2>
              {boss && <p className="mt-1 text-[15px] text-muted">{x.of.tapHint}</p>}
              <ul className="mt-1 divide-y divide-line">
                {mo.result.perMember.map(p => {
                  const row = (<>
                    <span className="min-w-0">
                      <span className={boss && p.id !== me.memberId ? 'font-semibold text-turmeric-ink' : ''}>{name(p.id)}</span>
                      <span className="block text-[15px] text-muted">{meals(mo.meals.get(p.id) ?? 0)}</span>
                      {!mo.members.some(m => m.id === p.id) && <span className="block text-[15px] text-muted">{x.movedOut}</span>}
                    </span>
                    <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${balanceText(x, p.balance).tone}`}>{Math.round(Math.abs(p.balance) / 100) ? (p.balance > 0 ? '+' : '−') : ''}{fmtTaka(p.balance)}</span>
                  </>);
                  // the collector's rows open that person's breakdown: the whole row is the tap target, so every row keeps one height
                  return (
                    <li key={p.id}>
                      {boss && p.id !== me.memberId
                        ? <Link href={`${href(month, mine, p.id)}#balance`} scroll={false} aria-current={p.id === whoId || undefined}
                            className={`flex min-h-11 justify-between gap-4 rounded-lg py-2 hover:bg-paper ${focus}`}>{row}</Link>
                        : <div className="flex justify-between gap-4 py-2">{row}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <div className="flex flex-col gap-6 lg:col-span-2">
          <section className={card}>
            <h2 className="text-xl font-bold">{x.summary}</h2>
            <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2 lg:grid-cols-3">
              {([[x.totalBazar, fmtTaka(totals.bazar)], [x.totalBills, fmtTaka(totals.bills)], [x.totalSpent, fmtTaka(totals.spent)], [x.paidInMonth, fmtTaka(totals.paidIn)],
                [x.mealRate, fmtRate(mo.result.mealRate, totalMeals), (month === thisMonth ? (totalMeals === 100 ? x.mealSoFar : x.mealsSoFar) : totalMeals === 100 ? x.mealsOne : x.mealsN).replace('{n}', fmtMeals(totalMeals))],
                [x.withName.replace('{name}', holder), `${held < 0 ? '−' : ''}${fmtTaka(held)}`]] as const).map(([k, v, sub]) => (
                <div key={k} className="rounded-xl bg-paper p-3">
                  <dt className="text-[15px] text-muted">{k}</dt>
                  <dd className="text-2xl font-bold tabular-nums [overflow-wrap:anywhere]">{v}</dd>
                  {sub && <dd className="text-[15px] text-muted">{sub}</dd>}
                </div>
              ))}
            </dl>
            {/* who holds the money now and how they got it; the newest row explains today's collector, older ones fold away */}
            {month === thisMonth && history.length > 0 && (() => {
              const [h, ...older] = history;
              const line = (r: typeof h) => (r.status === 'accepted' ? x.holds : x.holdsOverride)
                .replace('{name}', r.to).replace('{from}', r.from).replace('{d}', fmtDay(dhakaDate(r.at), lang)).replace('{t}', fmtTaka2(r.amount ?? 0));
              const past = (r: typeof h) => (r.status === 'accepted' ? x.handedPast : x.overridePast)
                .replace('{name}', r.to).replace('{from}', r.from).replace('{d}', fmtDay(dhakaDate(r.at), lang)).replace('{t}', fmtTaka2(r.amount ?? 0));
              return (
                <div className="mt-3 text-[15px]">
                  <p>{line(h)}</p>
                  {older.length > 0 && <details className="mt-1"><summary className={`inline-flex min-h-11 cursor-pointer items-center ${link}`}>{x.earlierHandovers}</summary>
                    <ul className="mt-1 space-y-1 text-muted">{older.map(r => <li key={r.at}>{past(r)}</li>)}</ul></details>}
                </div>
              );
            })()}
            {held < 0 && <p className="mt-3 font-semibold">{x.flatOwes.replace('{name}', holder).replace('{t}', fmtTaka(held))}</p>}
            {!mo.result.invariantOk && <p className="mt-3 font-semibold text-chili">{x.problem}</p>}
            {closed ? (() => {
              const lines = settleLines(mo.result.perMember, collector.id).map(l => {
                const a = name(l.id), amt = fmtExact(l.amount);
                return l.kind === 'collectorTakes' ? x.takes.replace('{a}', a).replace('{t}', amt)
                  : l.kind === 'collectorAdds' ? x.adds.replace('{a}', a).replace('{t}', amt)
                  : x.paysTo.replace('{a}', l.kind === 'pays' ? a : collector.name).replace('{b}', l.kind === 'pays' ? collector.name : a).replace('{t}', amt);
              });
              const note = x.settleNote.replaceAll('{name}', collector.name).replace('{next}', fmtMonth(next));
              // who counted the cash and who saw it, who checked the bazars and bills: on the page and in the shared text
              const cr = mo.info?.cash ?? null, counter = cr ? name(cr.by) : '';
              const seenNames = names(seen.map(p => p.name), x.and);
              // nobody saw it yet only where a tap is still possible: the latest closed month
              const cashLine = cr ? (seen.length ? x.shareCash.replace('{names}', seenNames) : latest ? x.shareCashNobody : x.shareCashOnly)
                .replace('{t}', fmtExact(cr.actual)).replace('{name}', counter) : null;
              const checkLines = mc ? [
                mc.by.length ? x.shareChecked.replace('{list}', mc.by.map(c => `${c.name} ${c.n}`).join(' · ')) : null,
                mc.none ? x.shareUnchecked.replace('{n}', String(mc.none)) : null,
                mc.fix ? x.shareFixClosed.replace('{n}', String(mc.fix)) : null].filter((l): l is string => !!l) : [];
              // the count was of everything held on the day of the close, later entries too: say why it differs from the month's end
              const split = cr && cr.actual !== mo.result.fund ? x.heldSplit.replace('{month}', fmtMonth(month)).replace('{a}', fmtSigned(mo.result.fund)).replace('{b}', fmtSigned(cr.actual - mo.result.fund)) : null;
              const trust = cashLine ? [cashLine, ...(split ? [split] : []), ...checkLines] : checkLines;
              const text = [`${mo.flat.name} · ${fmtMonth(month)}`, ...lines, `${x.withName.replace('{name}', holder)}: ${fmtSigned(mo.result.fund)}`,
                `${x.mealRate}: ${fmtExact(mo.result.mealRate)}`, ...(trust.length ? ['', ...trust] : []), ...(lines.length ? ['', note] : [])].join('\n');
              return (<>
                <h3 className="mt-5 font-semibold">{x.settleUp}</h3>
                {lines.length ? <ul className="mt-1 list-disc space-y-1 pl-5 md:columns-2 md:gap-10">{lines.map(s => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted">{x.nobodyOwes}</p>}
                {lines.length > 0 && <p className="mt-3 max-w-prose text-[15px] text-muted">{note}</p>}
                {cr && (
                  <div className="mt-4 text-[15px]">
                    <p>{x.cashCounted.replace('{name}', counter).replace('{t}', fmtExact(cr.actual)).replace('{d}', fmtDay(dhakaDate(mo.info!.closedAt!), lang))}{' '}
                      {seen.length ? x.seenBy.replace('{names}', seenNames) : latest ? x.seenNobody : null}</p>
                    {/* a second, deliberate tap that names the amount: I saw this much with this person */}
                    {maySee && (
                      <div className="group mt-2">
                        <details><summary className={`${secondary} cursor-pointer list-none sm:inline-flex sm:w-auto [&::-webkit-details-marker]:hidden`}>{x.iSaw}</summary></details>
                        <form action={seeCashAction} className="mt-2 hidden flex-wrap items-center gap-3 group-has-[details[open]]:flex">
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="month" value={month} />
                          <span id="see-cash">{x.iSawConfirm.replace('{t}', fmtExact(cr.actual)).replace('{name}', counter)}</span>
                          <PendingButton aria-describedby="see-cash" className={`${primary} sm:w-auto`}>{x.yesSaw}</PendingButton>
                        </form>
                      </div>
                    )}
                  </div>
                )}
                {checkLines.length > 0 && <ul className="mt-2 space-y-1 text-[15px] text-muted">{checkLines.map(l => <li key={l}>{l}</li>)}</ul>}
                <div className="mt-4 sm:max-w-xs"><ShareButton text={text} label={t.meals.share} copied={t.meals.copied} /></div>
              </>);
            })() : (<>
              <h3 className="mt-5 font-semibold">{x.settleTitle}</h3>
              {settle.length ? <ul className="mt-1 list-disc space-y-1 pl-5 md:columns-2 md:gap-10">{settle.map(s => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted">{x.nobodyOwes}</p>}
            </>)}
          </section>

          <section id="entries" className={`flex flex-1 flex-col scroll-mt-24 ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">{x.entries}</h2>
              <Link href={href(month, !mine)} aria-current={mine ? 'true' : undefined} className={`inline-flex min-h-11 items-center rounded-full border border-muted px-4 font-semibold ${mine ? 'bg-turmeric text-on-turmeric border-turmeric' : ''} ${focus}`}>{x.onlyMine}</Link>
            </div>
            {!dates.length ? <p className="mt-3 text-muted">{x.noEntries}</p> : <LongList fill label={x.entries} keep={keep} more={t.app.showAll.replace('{n}', String(shown.length))} less={t.app.showLess} items={dates.map(d => (
                <li key={d}>
                  <h3 className="pt-4 text-[15px] font-semibold text-muted">{fmtDay(d, lang)}</h3>
                  <ul className="divide-y divide-line">
                    {shown.filter(e => e.date === d).map(e => (
                      <li key={e.id} className="group py-3">
                        {/* the text keeps room for the widest chip (Needs correction); a big amount wraps under it instead */}
                        <div className="flex flex-wrap items-start justify-between gap-x-3">
                        <div className="min-w-36 flex-1">
                          <p className="font-semibold">{x.types[e.type]} · {who(e)}</p>
                          {(e.forMonth || e.method || e.note) && <p className="text-[15px]">{[e.forMonth && x.correctionFor.replace('{month}', fmtMonth(e.forMonth)), e.method && x.cashMethods[e.method], e.note].filter(Boolean).join(' · ')}</p>}
                          {(e.type === 'bazar' || e.type === 'bill') && e.status !== 'due' && (
                            <p className="flex flex-wrap items-center gap-x-3">
                              <Link href={`/${lang}/money/bazar/${e.id}`} aria-label={`${x.types[e.type]} ${fmtExact(e.amount)}: ${e.check === 'ok' ? x.bazar.ok : e.check === 'fix' ? x.bazar.fix : closed ? x.bazar.closedUnchecked : x.bazar.waiting}`}
                                className={`inline-flex min-h-11 items-center rounded-full ${focus}`}><StatusChip state={e.check} b={x.bazar} closed={closed} /></Link>
                              {e.receiptV && <a href={`/api/receipt/${e.id}?v=${e.receiptV}`} target="_blank" rel="noopener" aria-label={`${x.bazar.viewReceipt}: ${x.types[e.type]} ${fmtExact(e.amount)} (${x.bazar.newTab})`}
                                className={`inline-flex min-h-11 items-center text-[15px] ${link}`}>{x.bazar.viewReceipt}</a>}
                            </p>
                          )}
                          <p className="text-[15px] text-muted">
                            {x.addedBy.replace('{name}', name(e.createdBy))}
                            {e.status === 'pending' && <> · <span className="font-semibold text-ink">{x.pending}</span></>}
                            {e.status === 'due' && <> · <span className="font-semibold text-ink">{x.dueTag}</span></>}
                            {/* counted without their answer: memberId is the other person (lib/money-db.ts addEntry) */}
                            {e.notJoined && <> · {x.atOnce.replace('{name}', name(e.memberId))}</>}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-bold tabular-nums">{fmtExact(e.amount)}</span>
                          {/* a waiting entry someone else wrote is answered in Waiting for you (That’s not right tells them), not removed here;
                              the collector still removes one nobody can answer (both people moved out after a role change) */}
                          {!closed && (month === thisMonth || e.status === 'pending' || boss) && (boss || (e.createdBy === me.memberId && (e.type !== 'deposit' || e.status === 'pending')))
                            && (e.status !== 'pending' || e.createdBy === me.memberId || (boss && !waiting.some(w => w.id === e.id))) && (
                            <details>
                              <summary aria-label={`${x.remove}: ${x.types[e.type]} ${fmtExact(e.amount)}, ${fmtDay(e.date, lang)}`} className={`inline-flex min-h-11 cursor-pointer list-none items-center px-2 ${link}`}>{x.remove}</summary>
                            </details>
                          )}
                        </div>
                        </div>
                        {/* shown only while this entry's Remove fold is open: a second, deliberate tap */}
                        <form action={removeAction} className="mt-2 hidden flex-wrap items-center justify-end gap-3 group-has-[details[open]]:flex">
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="id" value={e.id} />
                          <span id={`rm-${e.id}`}>{x.confirmRemove.replace('{what}', `${x.types[e.type]} ${fmtExact(e.amount)}`)}</span>
                          <PendingButton aria-describedby={`rm-${e.id}`} className={`inline-flex min-h-11 items-center rounded-full border border-chili px-5 font-semibold text-chili hover:bg-paper ${focus}`}>{x.yesRemove}</PendingButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                </li>
              ))} />}
            {/* removed entries are rarely needed: folded behind their count, still one tap from Put back */}
            {!mine && mo.removed.length > 0 && (
              <details className="group/rm mt-4 border-t border-line pt-2">
              {/* the same + (turning to ×) as every other fold, so open and closed are visible */}
              <summary className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden ${link}`}>
                {x.removedTitle.replace('{n}', String(mo.removed.length))}
                <span aria-hidden="true" className="text-xl leading-none transition-transform group-open/rm:rotate-45">+</span>
              </summary>
              <div className="text-[15px] text-muted">
              <LongList label={x.removedTitle.replace('{n}', String(mo.removed.length))} keep={5} more={t.app.showAll.replace('{n}', String(mo.removed.length))} less={t.app.showLess} items={mo.removed.map(rm => (
                  <li key={rm.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">{x.types[rm.type]} · {fmtDay(rm.date, lang)}{rm.note ? ` · ${rm.note}` : ''} · {(rm.rejected ? x.rejectedBy : x.removedBy).replace('{name}', rm.by)}</span>
                    <span className="flex items-center gap-2">
                      <s className="tabular-nums">{fmtTaka(rm.amount)}</s>
                      {!closed && (boss || (month === thisMonth && rm.byId === me.memberId)) && (
                        <form action={putBackAction}>
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="id" value={rm.id} />
                          <PendingButton aria-label={`${x.putBack}: ${x.types[rm.type]} ${fmtTaka(rm.amount)}`} className={`min-h-11 px-2 ${link}`}>{x.putBack}</PendingButton>
                        </form>
                      )}
                    </span>
                  </li>
                ))} />
              </div>
              </details>
            )}
          </section>
          {closed && mo.corrections.length > 0 && (
            <section className={card}>
              <h2 className="text-xl font-bold">{x.correctionsLater}</h2>
              <ul className="mt-1 divide-y divide-line">
                {mo.corrections.map(c => (
                  <li key={c.id} className="flex justify-between gap-4 py-2">
                    <span className="min-w-0">{fmtDay(c.date, lang)} · {x.types[c.type]}{c.type === 'adjustment' ? ` · ${name(c.memberId)} → ${name(c.moves)}` : ''} · {c.note}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{fmtExact(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          </div>
        </div>
      </main>
    </>
  );
}
