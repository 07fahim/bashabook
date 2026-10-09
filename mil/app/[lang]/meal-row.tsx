import { indexChanges, isPresent, mealCount, MEALS, type Decision } from '@/lib/meals';
import type { Member, NoCook, SavedChange } from '@/lib/meals-db';
import { setMealAction } from './actions';
import { ChipButton } from './chip-button';
import type { Dict, Locale } from './dictionaries';
import { fmtDay } from './format';

type Props = {
  lang: Locale; m: Dict['meals']; meId: string; date: string; decision: Decision;
  members: Member[]; changes: SavedChange[]; noCook: NoCook[];
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
        const off = noCook.some(n => n.date === date && n.meal === meal);
        const badge = off ? m.noCook : late ? m.late : null;
        return (
          <form key={meal} action={setMealAction}>
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="meal" value={meal} />
            <input type="hidden" name="count" value={count > 0 ? 0 : 1} />
            <ChipButton on={count > 0} disabled={closed || off}>
              <span className="sr-only">{fmtDay(date, lang)}, </span>
              <span className={`font-semibold ${chart ? 'md:sr-only' : ''}`}>{m.names[meal]}</span>
              <span aria-hidden={count <= 1} className={`text-[15px] ${chart ? 'md:font-semibold' : ''}`}>{count > 1 ? `${count} ${m.platesShort}` : count ? m.on : m.off}</span>
              {badge && <span className="mt-1 rounded-full bg-paper md:mt-0 px-2 text-[15px] text-ink">{badge}</span>}
            </ChipButton>
          </form>
        );
      })}
    </div>
  );
}
