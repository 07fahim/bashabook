/** Instant page updates (spec 2026-10-29). One Supabase Realtime socket (Phoenix protocol) on the flat's secret topic. The
 *  database sends an empty 'changed' signal after any write (migration 022); the page refreshes 300 ms after the first signal
 *  (later signals share that refresh, never push it back, so a steady stream can't starve it), at most once per 3 s, never
 *  while someone is typing.
 *  A dropped socket comes back after 1, 2, 4 ... 30 s and refreshes once after the rejoin, since a signal may have been missed
 *  meanwhile (the probe lost 2 of 6 once). */
export type Sock = { send(data: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: string }) => void) | null; onclose: (() => void) | null };
export type Field = { tagName: string; type?: string; value?: string; defaultValue?: string; checked?: boolean; defaultChecked?: boolean; getClientRects?(): { length: number } };

/** Someone is filling in a form: a text field, text area or select has focus, or a rendered field differs from what the page
 *  rendered. A draft on a page you left (Next keeps it hidden) or inside a closed details doesn't hold the refresh: a refresh
 *  keeps every mounted field (its DOM value or React state). busy() only stops the page moving under someone typing; it
 *  cannot see a half-filled controlled field once it loses focus (React copies a controlled value into defaultValue).
 *  ponytail: a changed select with no focus counts as not busy (a select's first option has no defaultSelected); add if a
 *  half-filled form loses a picked option. */
export function busy(active: Field | null, fields: Iterable<Field>) {
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'SELECT'
    || (active.tagName === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden'].includes(active.type ?? '')))) return true;
  for (const f of fields)
    if (f.getClientRects?.().length !== 0 && (f.type === 'checkbox' || f.type === 'radio' ? f.checked !== f.defaultChecked : f.value !== f.defaultValue)) return true;
  return false;
}

/** Runs `run` after `ms`, or once nobody is typing (checked every second). Returns a cancel. */
export function whenFree(isBusy: () => boolean, run: () => void, ms = 300) {
  let t = setTimeout(function go() { if (isBusy()) t = setTimeout(go, 1000); else run(); }, ms);
  return () => clearTimeout(t);
}

/** Cost cap: a public channel takes broadcasts from anyone with the topic and the public key, so a flooded topic must not
 *  re-render every open page several times a second and burn the monthly function quota. */
const GAP = 3000;

/** Listens until the returned stop is called. */
export function live(o: { url: string; key: string; topic: string; open: (url: string) => Sock; refresh: () => void; busy: () => boolean }) {
  const ch = `realtime:${o.topic}`;
  let ws: Sock | undefined, tries = 0, again = false, stopped = false;
  let beat: ReturnType<typeof setInterval> | undefined, wait: ReturnType<typeof setTimeout> | undefined, joinBy: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined, lastRefresh = 0;
  /** The only path to o.refresh(): signals and the refresh after a rejoin. */
  const later = () => {
    pending ??= whenFree(o.busy, () => { pending = undefined; lastRefresh = Date.now(); o.refresh(); }, Math.max(300, lastRefresh + GAP - Date.now()));
  };

  /** Gives up on a socket at once: a browser fires onclose on a dead network only when the closing handshake times out. */
  const drop = (s: Sock) => {
    clearInterval(beat); clearTimeout(joinBy);
    s.onopen = s.onmessage = s.onclose = null;
    s.close();
    if (stopped) return;
    again = true;
    wait = setTimeout(connect, Math.min(30, 2 ** tries++) * 1000);
  };

  const connect = () => {
    const s = ws = o.open(`${o.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(o.key)}&vsn=1.0.0`);
    let ref = 0, unanswered: string | null = null;
    const send = (topic: string, event: string, payload: object) => {
      const r = String(++ref);
      s.send(JSON.stringify({ topic, event, payload, ref: r, ...(topic === ch ? { join_ref: '1' } : {}) }));
      return r;
    };
    joinBy = setTimeout(() => drop(s), 10000);   // covers both the open and the join
    s.onopen = () => {
      send(ch, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: o.key });
      beat = setInterval(() => { if (unanswered) drop(s); else unanswered = send('phoenix', 'heartbeat', {}); }, 20000);
    };
    s.onmessage = e => {
      let m: { topic?: string; event?: string; ref?: string; payload?: { status?: string } } | null;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m?.topic === 'phoenix' && m.ref === unanswered) unanswered = null;
      if (m?.topic !== ch) return;
      if (m.event === 'phx_reply' && m.ref === '1') {
        clearTimeout(joinBy);
        if (m.payload?.status !== 'ok') return drop(s);
        tries = 0;
        if (again) later();
      } else if (m.event === 'broadcast') later();
      else if (m.event === 'phx_error' || m.event === 'phx_close') drop(s);
    };
    s.onclose = () => drop(s);
  };
  connect();
  return () => { stopped = true; clearTimeout(wait); pending?.(); if (ws) drop(ws); };
}
