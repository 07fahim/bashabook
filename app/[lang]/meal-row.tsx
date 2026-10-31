import { indexChanges, isPresent, mealCount, MEALS, ownPlate, todayDhaka, type Decision } from '@/lib/meals';
import type { FlatInfo, Member, NoCook, SavedChange } from '@/lib/meals-db';
import { setMealAction } from './actions';
import { ChipButton } from './chip-button';
import type { Dict, Locale } from './dictionaries';
import { fmtDay } from './format';

type Props = {
  lang: Locale; m: Dict['meals']; meId: string; date: string; decision: Decision;
  flat: FlatInfo; members: Member[]; changes: SavedChange[]; noCook: NoCook[];
  /** On wider screens the chips become cells of the week chart, the row label names the meal. */
  chart?: boolean;
};

/** My three meals for one date. No-cooking meals are closed and labelled. */
export function MealRow({ lang, m, meId, date, decision, members, changes, noCook, chart }: Props) {
  const self = members.find(x => x.id === meId)!;
  const idx = indexChanges(changes);
  const closed = decision === 'closed' || !isPresent(self, date);
  return (
    <div className={`mt-3 grid grid-cols-3 gap-2 ${chart ? 'md:contents' : ''}`}>
      {MEALS.map(meal => {
        const late = changes.some(c => c.memberId === meId && c.date === date && c.meal === meal && c.late);
        const count = mealCount(self, idx, date, meal);
        const own = ownPlate(self, changes, date, meal), guests = count - own;
        const off = noCook.some(n => n.date === date && n.meal === meal);
        // a same-day change: made on the meal's own day (or the collector's later fix)
        const badge = off ? m.noCook : late && date <= todayDhaka() ? m.lateSameDay : null;
        return (
          <form key={meal} action={setMealAction}>
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="meal" value={meal} />
            <input type="hidden" name="own" value={own > 0 ? 0 : 1} />
            <ChipButton on={own > 0} disabled={closed || off} badge={!!badge}>
              <span className="sr-only">{fmtDay(date, lang)}, </span>
              {/* 'Breakfast' is the longest name: below 360 px three buttons in a card leave it 2 px short, so it steps down a size */}
              <span className={`font-semibold max-[359px]:text-[15px] ${chart ? 'md:sr-only' : ''}`}>{m.names[meal]}</span>
              <span aria-hidden="true" className={`text-[15px] ${chart ? 'md:font-semibold' : ''}`}>{own ? m.on : m.off}</span>
              {guests > 0 && <span className="text-[15px]">{guests === 1 ? m.guestOne : m.guestMany.replace('{n}', String(guests))}</span>}
              {badge && <span className="mt-1 rounded-full bg-paper px-2 text-[15px] text-ink max-[359px]:px-1 md:basis-full md:text-center">{badge}</span>}
            </ChipButton>
          </form>
        );
      })}
    </div>
  );
}
