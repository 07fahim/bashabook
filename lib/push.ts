import webpush from 'web-push';
import type { Db } from './db';
import { subsFor } from './push-db';

/** `ttl`: seconds the push service keeps it for a phone that is off (default a day); a meal reminder is useless after the lock. */
export type Msg = { title: string; body: string; url: string; ttl?: number };

let configured = false;
const configure = () => {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:hello@example.com', process.env.VAPID_PUBLIC_KEY ?? '', process.env.VAPID_PRIVATE_KEY ?? '');
  configured = true;
};

/** Best effort: one push per browser of these members. A browser that answers 404/410 is gone and its row is deleted; any
 *  other failure, the database included, is counted and logged (endpoint host only) and never thrown, so a caller's write
 *  is never undone by it and a cron run carries on with the next flat. */
export async function sendPush(db: Db, memberIds: string[], msg: Msg, send: typeof webpush.sendNotification = (s, p, o) => { configure(); return webpush.sendNotification(s, p, o); }) {
  const out = { sent: 0, gone: 0, failed: 0 };
  try {
    // timeout: a push service that hangs must not hold the cron run (25 s for every flat) until the function is killed
    const subs = await subsFor(db, memberIds), payload = JSON.stringify(msg), options = { TTL: msg.ttl ?? 86400, timeout: 5000 };
    await Promise.all(subs.map(async s => {
      try { await send(s, payload, options); out.sent++; }
      catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        out.failed++;
        if (code === 404 || code === 410) { await db(`delete from push_subs where endpoint = $1`, [s.endpoint]); out.failed--; out.gone++; }
        else console.warn('push failed', new URL(s.endpoint).host, code ?? String(e));
      }
    }));
  } catch (e) { out.failed++; console.warn('push failed', String(e)); }
  return out;
}
