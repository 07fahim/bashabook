import { describe, it, expect, beforeAll } from 'vitest';
import { db, migrate, pg } from '../db/test-db';
import { createFlat, memberBySession, createSession, newFlatCode } from './auth';
import { openMonth } from './money-db';
import { markNoticesSeen } from './notices';

/** Every realtime.send the triggers made, in order. */
const sent = async () => (await db<{ topic: string; event: string; payload: unknown; private: boolean }>(`select * from realtime.calls order by n`));
const clear = () => db(`delete from realtime.calls`);
const topicOf = async (flatId: string) => (await db<{ t: string }>(`select live_topic as t from flats where id = $1`, [flatId]))[0].t;

describe('live pings (migration 022)', { timeout: 30000 }, () => {
  beforeAll(async () => {
    await migrate();
    await pg.exec(`create schema realtime;
      create table realtime.calls (n serial, topic text, event text, payload jsonb, private boolean);
      create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql
        as $$ insert into realtime.calls (topic, event, payload, private) values (topic, event, payload, private) $$;`);
  }, 60000);   // migrating takes longer than the 10 s hook default when every test file boots its PGlite at once
  const mk = (name: string) => createFlat(db, { flatName: name, name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-10-01', lang: 'en' });

  it('gives every flat its own secret topic, 32 hex characters, on the signed-in member', async () => {
    const a = await mk('Live A'), b = await mk('Live B');
    const ta = await topicOf(a.flatId);
    expect(ta).toMatch(/^[0-9a-f]{32}$/);
    expect(ta).not.toBe(await topicOf(b.flatId));
    const me = await memberBySession(db, await createSession(db, a.memberId));
    expect(me?.liveTopic).toBe(ta);
  });

  it('sends one empty signal per flat for a statement that writes many rows', async () => {
    const a = await mk('Live C');
    await db(`insert into bill_templates (flat_id, name, amount_poisha, split, selected_member_ids) values ($1, 'Gas', 100000, 'equal', '{}'), ($1, 'Wifi', 80000, 'equal', '{}')`, [a.flatId]);
    await clear();
    await openMonth(db, a.flatId, '2026-11-01');   // months rows + 2 bills + history, one statement
    expect(await sent()).toEqual([{ n: expect.any(Number), topic: await topicOf(a.flatId), event: 'changed', payload: {}, private: false }]);
  });

  it('sends one signal per flat in a transaction that writes to two flats', async () => {
    const a = await mk('Live D'), b = await mk('Live E');
    await clear();
    await pg.transaction(async tx => {
      await tx.query(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'W', 100)`, [a.flatId]);
      await tx.query(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'X', 100), ($1, 'Y', 100), ($2, 'Z', 100)`, [a.flatId, b.flatId]);
    });
    expect((await sent()).map(s => s.topic).sort()).toEqual([await topicOf(a.flatId), await topicOf(b.flatId)].sort());
  });

  it('sends again for the next write: once per transaction, not once per session', async () => {
    const a = await mk('Live I');
    await clear();
    await db(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'P', 100)`, [a.flatId]);
    await db(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'Q', 100)`, [a.flatId]);
    expect((await sent()).map(s => s.topic)).toEqual([await topicOf(a.flatId), await topicOf(a.flatId)]);
  });

  it('has the trigger on all 15 tables a page shows', async () => {
    expect((await db<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname = 'live_ping'`))[0].n).toBe(15);
  });

  it('sends nothing when the Notices page marks itself seen, nor for an update that changes nothing', async () => {
    const a = await mk('Live F');
    await clear();
    await markNoticesSeen(db, a.flatId, a.memberId);
    await db(`update members set name = name where flat_id = $1`, [a.flatId]);
    expect(await sent()).toEqual([]);
  });

  it('sends nothing for an email write (migration 027), but still for a real change made with it', async () => {
    const a = await mk('Live J');
    await clear();
    await db(`update members set email = 'nafis@gmail.com' where id = $1`, [a.memberId]);
    await expect(db(`select email_ok from members`)).rejects.toThrow();   // no confirmation link any more: an email is proven before it is saved
    await expect(db(`select email_token from members`)).rejects.toThrow();
    expect(await sent()).toEqual([]);
    await db(`update members set name = 'Nafis R', email = 'nafis2@gmail.com' where id = $1`, [a.memberId]);
    expect((await sent()).map(s => s.topic)).toEqual([await topicOf(a.flatId)]);
  });

  it('still saves the write when the send fails', async () => {
    const a = await mk('Live G');
    await pg.exec(`create or replace function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language plpgsql
      as $$ begin raise exception 'realtime down'; end $$;`);
    try {
      await db(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'Saved', 100)`, [a.flatId]);
      expect((await db(`select 1 from rooms where flat_id = $1 and name = 'Saved'`, [a.flatId])).length).toBe(1);
    } finally {
      await pg.exec(`create or replace function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql
        as $$ insert into realtime.calls (topic, event, payload, private) values (topic, event, payload, private) $$;`);
    }
  });

  it('gives the flat a new topic with a new join code, and tells pages on the old topic once', async () => {
    const a = await mk('Live H');
    const before = await topicOf(a.flatId);
    await clear();
    expect(await newFlatCode(db, a.flatId, { memberId: a.memberId, role: 'manager' })).toBeTruthy();
    const after = await topicOf(a.flatId);
    expect(after).toMatch(/^[0-9a-f]{32}$/);
    expect(after).not.toBe(before);
    expect((await sent()).map(s => [s.topic, s.event, s.payload])).toEqual([[before, 'changed', {}], [after, 'changed', {}]]);
  });
});
