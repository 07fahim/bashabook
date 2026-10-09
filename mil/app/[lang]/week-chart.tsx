import { addDays, MEALS, type Decision } from '@/lib/meals';
import type { Member, NoCook, SavedChange } from '@/lib/meals-db';
import type { Dict, Locale } from './dictionaries';
import { fmtDay } from './format';
import { MealRow } from './meal-row';

type Props = {
  lang: Locale; m: Dict['meals']; meId: string; today: string; week: string[]; decide: (date: string) => Decision; note: string;
  members: Member[]; changes: SavedChange[]; noCook: NoCook[];
};

/** My week: a list of days on phones, a days × meals chart on wider screens. Today gets a turmeric pill. */
export function WeekChart({ lang, m, meId, today, week, decide, note, ...meals }: Props) {
  const tomorrow = addDays(today, 1);
  const hasToday = week.includes(today);
  return (
    <section className="md:rounded-3xl md:border md:border-line md:bg-surface md:p-6">
      <ul className="space-y-6 md:grid md:grid-flow-col md:grid-cols-[auto_repeat(7,minmax(0,1fr))] md:grid-rows-[auto_repeat(3,auto)] md:gap-2 md:space-y-0">
        <li aria-hidden="true" className="hidden md:contents">
          <span />
          {MEALS.map(x => <span key={x} className="self-center pr-4 font-semibold">{m.names[x]}</span>)}
        </li>
        {week.map(date => (
          <li key={date} className="md:contents">
            <p className={`font-semibold md:pb-2 md:text-center md:text-[15px] md:leading-snug ${date === tomorrow ? 'md:text-turmeric-ink' : ''}`}>
              {date === today && <span className="mr-2 inline-block rounded-full bg-turmeric px-2.5 text-on-turmeric md:mr-0 md:mb-1">{m.today}</span>}
              {date === tomorrow && <span className="md:block">{m.tomorrow}<span className="md:hidden"> · </span></span>}
              <span className={date === today ? 'md:block' : ''}>{fmtDay(date, lang)}</span>
            </p>
            <MealRow lang={lang} m={m} meId={meId} date={date} decision={decide(date)} chart {...meals} />
            {date === today && <p className="mt-2 text-[15px] text-muted md:hidden">{note}</p>}
          </li>
        ))}
      </ul>
      {hasToday && <p className="mt-4 hidden text-[15px] text-muted md:block">{note}</p>}
    </section>
  );
}
