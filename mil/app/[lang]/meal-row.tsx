import { indexChanges, isPresent, mealCount, MEALS, type Decision } from '@/lib/meals';
import type { MealRequest, Member, SavedChange } from '@/lib/meals-db';
import { setMealAction } from './actions';
import { ChipButton } from './chip-button';
import type { Dict, Locale } from './dictionaries';

type Props = { lang: Locale; m: Dict['meals']; meId: string; date: string; decision: Decision; members: Member[]; changes: SavedChange[]; requests: MealRequest[] };

/** My three meals for one date. A waiting request shows its count with a Waiting badge. */
export function MealRow({ lang, m, meId, date, decision, members, changes, requests }: Props) {
  const self = members.find(x => x.id === meId)!;
  const idx = indexChanges(changes);
  const closed = decision === 'closed' || !isPresent(self, date);
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {MEALS.map(meal => {
        const req = requests.find(r => r.memberId === meId && r.date === date && r.meal === meal);
        const late = changes.some(c => c.memberId === meId && c.date === date && c.meal === meal && c.late);
        const count = req?.count ?? mealCount(self, idx, date, meal);
        return (
          <form key={meal} action={setMealAction}>
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="meal" value={meal} />
            <input type="hidden" name="count" value={count > 0 ? 0 : 1} />
            <ChipButton on={count > 0} disabled={closed}>
              <span className="font-semibold">{m.names[meal]}</span>
              <span className="text-[15px]">{count > 1 ? `${count} ${m.platesShort}` : count ? m.on : m.off}</span>
              {(req || late) && <span className="mt-1 rounded-full bg-paper px-2 text-[15px] text-ink">{req ? m.pending : m.late}</span>}
            </ChipButton>
          </form>
        );
      })}
    </div>
  );
}
