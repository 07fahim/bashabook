import webpush from 'web-push';
import type { Db } from './db';
import { subsFor } from './push-db';

export type Msg = { title: string; body: string; url: string };

let configured = false;
const configure = () => {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:hello@example.com', process.env.VAPID_PUBLIC_KEY ?? '', process.env.VAPID_PRIVATE_KEY ?? '');
  configured = true;
};

/** Best effort: one push per browser of these members. A browser that answers 404/410 is gone and its row is deleted; any
 *  other failure is counted and logged (endpoint host only) and never thrown, so a caller's write is never undone by it. */
export async function sendPush(db: Db, memberIds: string[], msg: Msg, send: typeof webpush.sendNotification = (s, p) => { configure(); return webpush.sendNotification(s, p); }) {
  const subs = await subsFor(db, memberIds), out = { sent: 0, gone: 0, failed: 0 };
  const payload = JSON.stringify(msg);
  await Promise.all(subs.map(async s => {
    try { await send(s, payload); out.sent++; }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await db(`delete from push_subs where endpoint = $1`, [s.endpoint]); out.gone++; }
      else { out.failed++; console.warn('push failed', new URL(s.endpoint).host, code ?? String(e)); }
    }
  }));
  return out;
}
