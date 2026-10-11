import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { removePush, savePush, subsFor } from './push-db';

const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

describe('push subscriptions', { timeout: 30000 }, () => {
  it('saves per member, moves a re-used endpoint, removes only the caller row, skips leavers', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'P', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-10-01', lang: 'bn' });
    const [t] = await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'member'`, [f.flatId]);
    await savePush(db, f.flatId, f.memberId, sub(1));
    await savePush(db, f.flatId, f.memberId, sub(2));
    await savePush(db, f.flatId, t.id, sub(3));
    expect((await subsFor(db, [f.memberId])).map(s => s.endpoint).sort()).toEqual(['https://push.example/1', 'https://push.example/2']);
    // the same browser subscribes as Tahsin: the endpoint now belongs to Tahsin
    await savePush(db, f.flatId, t.id, sub(1));
    expect((await subsFor(db, [f.memberId])).map(s => s.endpoint)).toEqual(['https://push.example/2']);
    expect((await subsFor(db, [t.id])).length).toBe(2);
    // removing with the wrong member changes nothing
    await removePush(db, f.memberId, 'https://push.example/3');
    expect((await subsFor(db, [t.id])).length).toBe(2);
    await removePush(db, t.id, 'https://push.example/3');
    expect((await subsFor(db, [t.id])).map(s => s.endpoint)).toEqual(['https://push.example/1']);
    // a leaver gets nothing from the day after left_on
    await db(`update members set left_on = '2026-10-02' where id = $1`, [t.id]);
    expect(await subsFor(db, [t.id])).toEqual([]);
    expect(await subsFor(db, [])).toEqual([]);
  });
});
