import { db } from '@/lib/db';
import { monthCsv } from '@/lib/export';
import { loadMonth, monthOf } from '@/lib/money-db';
import { todayDhaka } from '@/lib/meals';
import { currentMember } from '@/lib/session';
import { getDictionary, hasLocale } from '../../dictionaries';
import { fmtMonth } from '../../format';

/** One closed month as a CSV, for the collector only: the entries, then each person's lines, as Money shows them. */
export async function GET(req: Request, ctx: RouteContext<'/[lang]/money/export'>) {
  const { lang } = await ctx.params;
  const m = new URL(req.url).searchParams.get('m') ?? '';
  const me = await currentMember();
  if (!hasLocale(lang) || !me || me.role !== 'manager' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return new Response(null, { status: me ? 404 : 401 });
  const month = `${m}-01`;
  if (month >= monthOf(todayDhaka())) return new Response(null, { status: 404 });
  const mo = await loadMonth(db, me.flatId, month, todayDhaka());
  if (mo.info?.status !== 'closed') return new Response(null, { status: 404 });
  const t = getDictionary(lang), x = t.money, name = (id: string | null) => (id ? mo.all.find(p => p.id === id)?.name ?? '?' : '');
  const body = monthCsv(x.csv,
    mo.entries.filter(e => e.status === 'ok').map(e => ({ date: e.date, type: x.types[e.type], amount: e.amount, paidBy: name(e.paidBy),
      note: [e.forMonth && x.correctionFor.replace('{month}', fmtMonth(e.forMonth)), e.note].filter(Boolean).join(' · ') || null,   // as Money shows it
      who: e.type === 'adjustment' ? `${name(e.memberId)} → ${name(e.moves)}`   // as Money shows it: from → to
        : e.type === 'deposit' ? (e.memberId === e.heldBy ? name(e.heldBy) : `${name(e.memberId)} → ${name(e.heldBy)}`)
        : e.type === 'payout' ? `${name(e.heldBy)} → ${name(e.memberId)}` : name(e.memberId) })),
    mo.result.perMember.map(p => ({ name: name(p.id), meals: mo.meals.get(p.id) ?? 0, food: p.foodCost, bills: p.billShare, paidIn: p.paidIn, earlier: p.opening, advances: p.payouts, corrections: p.adjustments, line: p.balance })));
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bashabook-${m}.csv"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
