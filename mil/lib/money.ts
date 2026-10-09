export type Split = 'equal' | 'meals' | 'room' | 'selected';

/** Split `total` poisha by integer `weights`; shares sum exactly to `total`.
 *  Largest remainder, ties to the lowest index. Null when every weight is 0. */
export function allocate(total: number, weights: number[]): number[] | null {
  if (!Number.isInteger(total) || !weights.every(Number.isInteger)) throw new TypeError('allocate needs integers');
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW === 0) return null;
  const shares = weights.map(w => Math.floor((total * w) / sumW));
  const order = weights.map((w, i) => ({ i, r: (total * w) % sumW })).sort((a, b) => b.r - a.r || a.i - b.i);
  let left = total - shares.reduce((a, b) => a + b, 0);
  for (const { i } of order) { if (left-- <= 0) break; shares[i]++; }
  return shares;
}

export interface LedgerRow {
  id: string;
  type: 'deposit' | 'bazar' | 'bill' | 'payout';
  amount: number;            // poisha, positive integer
  paidBy: string | null;     // bazar/bill: member id, null = paid from fund
  memberId: string | null;   // deposit: payer; payout: receiver
  split: Split | null;       // bills only
  selected: string[];        // split = 'selected'
  status: 'ok' | 'pending';
}

export interface MonthInput {
  memberIds: string[];                  // present this month, plus anyone with a non-zero opening balance
  opening: Map<string, number>;         // balances carried from the last closed month
  openingFund: number;                  // fund carried from the last closed month
  weightedMeals: Map<string, number>;   // hundredths of a meal
  daysPresent: Map<string, number>;
  roomOf: Map<string, string | null>;
  rooms: { id: string; rentShare: number }[];
  ledger: LedgerRow[];
}

export interface MemberResult {
  id: string;
  opening: number;
  paidIn: number;
  foodCost: number;
  billShare: number;
  payouts: number;
  balance: number;           // + flat owes them, - they owe
}

export interface MonthResult {
  mealRate: number;          // poisha per weighted meal, rounded, display only
  perMember: MemberResult[];
  fund: number;
  invariantOk: boolean;      // no problems (a balance/fund mismatch is itself a problem)
  problems: string[];        // reasons the month cannot close
  lines: { rowId: string; memberId: string; amount: number }[];   // each person's share of each row ('bazar' for all bazar)
}

export function monthBalances(input: MonthInput): MonthResult {
  const ids = input.memberIds;
  const res = new Map<string, MemberResult>(ids.map(id => {
    const opening = input.opening.get(id) ?? 0;
    return [id, { id, opening, paidIn: 0, foodCost: 0, billShare: 0, payouts: 0, balance: 0 }];
  }));
  const problems: string[] = [];
  const lines: MonthResult['lines'] = [];
  const rows = input.ledger.filter(l => l.status === 'ok');
  const daysOf = (id: string) => input.daysPresent.get(id) ?? 0;
  const meals = ids.map(id => input.weightedMeals.get(id) ?? 0);
  let fund = input.openingFund;

  const known = (rowId: string, who: (string | null)[]) => {
    const bad = who.filter(id => id !== null && !res.has(id));
    if (bad.length) problems.push(`${rowId}: unknown member ${bad.join(', ')}`);
    return bad.length === 0;
  };
  const charge = (field: 'foodCost' | 'billShare', rowId: string, amount: number, who: string[], weights: number[]) => {
    if (!known(rowId, who)) return;
    const shares = allocate(amount, weights);
    if (!shares) { problems.push(`${rowId}: nobody to split this between`); return; }
    shares.forEach((s, i) => { res.get(who[i])![field] += s; lines.push({ rowId, memberId: who[i], amount: s }); });
  };

  const totalBazar = rows.filter(l => l.type === 'bazar').reduce((a, l) => a + l.amount, 0);
  if (totalBazar > 0) charge('foodCost', 'bazar', totalBazar, ids, meals);

  const rentRooms = input.rooms.filter(room => room.rentShare > 0);
  const inRoom = (roomId: string) => ids.filter(id => input.roomOf.get(id) === roomId && daysOf(id) > 0);
  if (rows.some(l => l.split === 'room')) {
    const roomless = ids.filter(id => daysOf(id) > 0 && !input.rooms.some(room => room.id === input.roomOf.get(id)));
    if (roomless.length) problems.push(`rent: no room set for ${roomless.join(', ')}`);
  }

  for (const l of rows) {
    if (!known(l.id, [l.memberId, l.paidBy])) continue;
    if (l.type === 'deposit') { res.get(l.memberId!)!.paidIn += l.amount; fund += l.amount; continue; }
    if (l.type === 'payout') { res.get(l.memberId!)!.payouts += l.amount; fund -= l.amount; continue; }
    if (l.paidBy) res.get(l.paidBy)!.paidIn += l.amount; else fund -= l.amount;
    if (l.type !== 'bill') continue;
    if (l.split === 'equal') charge('billShare', l.id, l.amount, ids, ids.map(daysOf));
    else if (l.split === 'meals') charge('billShare', l.id, l.amount, ids, meals);
    else if (l.split === 'selected') charge('billShare', l.id, l.amount, l.selected, l.selected.map(() => 1));
    else if (l.split === 'room') {
      const occupied = rentRooms.filter(room => inRoom(room.id).length > 0);
      if (occupied.length < rentRooms.length) problems.push(`${l.id}: empty room(s) ${rentRooms.filter(x => !occupied.includes(x)).map(x => x.id).join(', ')}`);
      const roomShares = allocate(l.amount, occupied.map(room => room.rentShare));
      if (!roomShares) { problems.push(`${l.id}: no occupied rooms`); continue; }
      occupied.forEach((room, i) => charge('billShare', l.id, roomShares[i], inRoom(room.id), inRoom(room.id).map(daysOf)));
    }
  }

  for (const m of res.values()) m.balance = m.opening + m.paidIn - m.foodCost - m.billShare - m.payouts;
  const perMember = [...res.values()];
  const diff = perMember.reduce((a, m) => a + m.balance, 0) - fund;
  if (diff !== 0) problems.push(`balances differ from fund by ${diff}`);
  const totalMeals = meals.reduce((a, b) => a + b, 0);
  return {
    mealRate: totalMeals ? Math.round((totalBazar * 100) / totalMeals) : 0,
    perMember,
    fund,
    invariantOk: problems.length === 0,
    problems,
    lines,
  };
}

/** A member's food cost split into their own meals and their guests' (meals in hundredths). The two always add up exactly. */
export function foodSplit(foodCost: number, meals: number, guestMeals: number) {
  const guests = meals ? Math.round((foodCost * guestMeals) / meals) : 0;
  return { own: foodCost - guests, guests };
}

/** What someone typed as taka -> poisha. Takes commas, ৳ and Bangla digits; null unless 0 < amount <= ৳1,00,00,000 with at most 2 decimals. */
export function toPoisha(v: string): number | null {
  const s = v.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[,\s৳]/g, '');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null;
  const p = Math.round(Number(s) * 100);
  return p > 0 && p <= 1_000_000_000 ? p : null;
}
