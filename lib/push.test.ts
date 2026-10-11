import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { sendPush } from './push';
import { savePush, subsFor } from './push-db';

describe('sendPush', { timeout: 30000 }, () => {
  it('sends to every browser, deletes gone ones, keeps the rest on other errors, never throws', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'S', name: 'Nafis', pin: '1234', others: [], today: '2026-10-01', lang: 'bn' });
    for (const n of [1, 2, 3]) await savePush(db, f.flatId, f.memberId, { endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } });
    const seen: string[] = [];
    const fake = async (s: { endpoint: string }, payload: string) => {
      seen.push(`${s.endpoint} ${JSON.parse(payload).title}`);
      if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (s.endpoint.endsWith('/3')) throw new Error('network');
      return {} as never;
    };
    const r = await sendPush(db, [f.memberId], { title: 'T', body: 'B', url: '/bn/home' }, fake as never);
    expect(r).toEqual({ sent: 1, gone: 1, failed: 1 });
    expect(seen.sort()).toEqual(['https://push.example/1 T', 'https://push.example/2 T', 'https://push.example/3 T']);
    expect((await subsFor(db, [f.memberId])).map(s => s.endpoint)).toEqual(['https://push.example/1', 'https://push.example/3']);
    expect(await sendPush(db, [], { title: 'T', body: 'B', url: '/' }, fake as never)).toEqual({ sent: 0, gone: 0, failed: 0 });
    // the database itself failing is a count, not a throw: the caller's write and the cron run carry on
    const down = async () => { throw new Error('db down'); };
    expect(await sendPush(down as never, [f.memberId], { title: 'T', body: 'B', url: '/' }, fake as never)).toEqual({ sent: 0, gone: 0, failed: 1 });
  });
});
