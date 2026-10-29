/** Instant page updates (spec 2026-10-29). One Supabase Realtime socket (Phoenix protocol) on the flat's secret topic. The
 *  database sends an empty 'changed' signal after any write (migration 022); the page refreshes 300 ms later (a burst gives
 *  one refresh), never while someone is typing. A dropped socket comes back after 1, 2, 4 ... 30 s and refreshes once after
 *  the rejoin, since a signal may have been missed meanwhile (the probe lost 2 of 6 once). */
export type Sock = { send(data: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: string }) => void) | null; onclose: (() => void) | null };
export type Field = { tagName: string; type?: string; value?: string; defaultValue?: string; checked?: boolean; defaultChecked?: boolean };

/** Someone is filling in a form: a text field, text area or select has focus, or a field differs from what the page rendered.
 *  ponytail: a changed select with no focus counts as not busy (a select's first option has no defaultSelected); add if a
 *  half-filled form loses a picked option. */
export function busy(active: Field | null, fields: Iterable<Field>) {
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'SELECT'
    || (active.tagName === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden'].includes(active.type ?? '')))) return true;
  for (const f of fields)
    if (f.type === 'checkbox' || f.type === 'radio' ? f.checked !== f.defaultChecked : f.value !== f.defaultValue) return true;
  return false;
}

/** Runs `run` after `ms`, or once nobody is typing (checked every second). Returns a cancel. */
export function whenFree(isBusy: () => boolean, run: () => void, ms = 300) {
  let t = setTimeout(function go() { if (isBusy()) t = setTimeout(go, 1000); else run(); }, ms);
  return () => clearTimeout(t);
}

/** Listens until the returned stop is called. */
export function live(o: { url: string; key: string; topic: string; open: (url: string) => Sock; refresh: () => void; busy: () => boolean }) {
  const ch = `realtime:${o.topic}`;
  let ws: Sock | null = null, tries = 0, again = false, stopped = false;
  let beat: ReturnType<typeof setInterval> | undefined, wait: ReturnType<typeof setTimeout> | undefined, joinBy: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined;
  const later = () => { pending ??= whenFree(o.busy, () => { pending = undefined; o.refresh(); }); };

  const connect = () => {
    const s = ws = o.open(`${o.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(o.key)}&vsn=1.0.0`);
    let ref = 0, unanswered: string | null = null;
    const send = (topic: string, event: string, payload: object) => {
      const r = String(++ref);
      s.send(JSON.stringify({ topic, event, payload, ref: r, ...(topic === ch ? { join_ref: '1' } : {}) }));
      return r;
    };
    s.onopen = () => {
      send(ch, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: o.key });
      joinBy = setTimeout(() => s.close(), 10000);
      beat = setInterval(() => { if (unanswered) s.close(); else unanswered = send('phoenix', 'heartbeat', {}); }, 20000);
    };
    s.onmessage = e => {
      const m = JSON.parse(e.data) as { topic?: string; event?: string; ref?: string; payload?: { status?: string } };
      if (m.topic === 'phoenix' && m.ref === unanswered) unanswered = null;
      if (m.topic !== ch) return;
      if (m.event === 'phx_reply' && m.ref === '1') {
        clearTimeout(joinBy);
        if (m.payload?.status !== 'ok') return s.close();
        tries = 0;
        if (again) later();
      } else if (m.event === 'broadcast') later();
      else if (m.event === 'phx_error' || m.event === 'phx_close') s.close();
    };
    s.onclose = () => {
      clearInterval(beat); clearTimeout(joinBy);
      if (stopped || ws !== s) return;
      again = true;
      wait = setTimeout(connect, Math.min(30, 2 ** tries++) * 1000);
    };
  };
  connect();
  return () => { stopped = true; clearTimeout(wait); clearTimeout(joinBy); clearInterval(beat); pending?.(); ws?.close(); };
}
