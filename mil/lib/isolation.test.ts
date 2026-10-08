import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { addMember, createFlat, createSession, listMembers, login, memberBySession, resetPin } from './auth';

const today = '2026-10-09';

describe('flat isolation', { timeout: 30000 }, () => {
  it('a session from flat A cannot read or change flat B', async () => {
    await migrate();
    const a = await createFlat(db, { flatName: 'A', name: 'Nafis', pin: '1234', others: ['Tahsin'], today, lang: 'bn' });
    const b = await createFlat(db, { flatName: 'B', name: 'Zarif', pin: '1234', others: ['Rafi'], today, lang: 'bn' });

    const me = (await memberBySession(db, await createSession(db, a.memberId)))!;
    expect(me.flatId).toBe(a.flatId);
    expect((await listMembers(db, me.flatId)).map(m => m.name)).toEqual(['Nafis', 'Tahsin']);
    expect(await resetPin(db, me.flatId, b.memberId, '0000')).toBe(false);
    expect(await addMember(db, me.flatId, 'Zarif', today)).toBe(true);
    expect((await listMembers(db, b.flatId)).map(m => m.name)).toEqual(['Zarif', 'Rafi']);

    const [{ join_code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [a.flatId]);
    expect(await login(db, join_code, b.memberId, '1234', null)).toEqual({ error: 'notFound' });
  });
});
