import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { busy, live, whenFree, type Sock } from './live';

/** A fake socket: records what the page sent; the test plays the server. `dead`: close() never fires onclose, like a
 *  browser on a silently dead network. */
function fake(dead = false) {
  const socks: (Sock & { sent: { topic: string; event: string; ref: string; payload: Record<string, unknown> }[]; url: string; closed: boolean })[] = [];
  const open = (url: string) => {
    const s = { url, sent: [] as never[], closed: false, onopen: null, onmessage: null, onclose: null,
      send(d: string) { this.sent.push(JSON.parse(d) as never); },
      close() { if (this.closed) return; this.closed = true; if (!dead) this.onclose?.(); } } as (typeof socks)[number];
    socks.push(s);
    return s;
  };
  const say = (s: Sock, m: object) => s.onmessage!({ data: JSON.stringify(m) });
  return { socks, open, say };
}
const T = 'abc123', CH = `realtime:${T}`;
const joined = (f: ReturnType<typeof fake>, s: Sock) => { s.onopen!(); f.say(s, { topic: CH, event: 'phx_reply', ref: '1', payload: { status: 'ok' } }); };

describe('busy', () => {
  it('is busy while a text field, text area or select has focus, not a button, checkbox or radio', () => {
    expect(busy({ tagName: 'INPUT', type: 'text' }, [])).toBe(true);
    expect(busy({ tagName: 'TEXTAREA', type: 'textarea' }, [])).toBe(true);
    expect(busy({ tagName: 'SELECT', type: 'select-one' }, [])).toBe(true);
    expect(busy({ tagName: 'BUTTON', type: 'submit' }, [])).toBe(false);
    expect(busy({ tagName: 'INPUT', type: 'checkbox' }, [])).toBe(false);
    expect(busy({ tagName: 'INPUT', type: 'radio' }, [])).toBe(false);
    expect(busy(null, [])).toBe(false);
  });
  it('is busy while a field differs from what the page rendered', () => {
    expect(busy(null, [{ tagName: 'INPUT', type: 'text', value: '450', defaultValue: '' }])).toBe(true);
    expect(busy(null, [{ tagName: 'INPUT', type: 'checkbox', checked: true, defaultChecked: false }])).toBe(true);
    expect(busy(null, [{ tagName: 'INPUT', type: 'file', value: 'C:\\fakepath\\slip.jpg', defaultValue: '' }])).toBe(true);
    expect(busy(null, [{ tagName: 'INPUT', type: 'text', value: 'x', defaultValue: 'x' }, { tagName: 'INPUT', type: 'checkbox', checked: false, defaultChecked: false }])).toBe(false);
  });
});

describe('live', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const start = (isBusy = () => false, dead = false) => {
    const f = fake(dead), refresh = vi.fn();
    const stop = live({ url: 'https://ref.supabase.co', key: 'k', topic: T, open: f.open, refresh, busy: isBusy });
    return { f, refresh, stop };
  };

  it('joins the topic on the Realtime socket with the key', () => {
    const { f } = start();
    const s = f.socks[0];
    expect(s.url).toBe('wss://ref.supabase.co/realtime/v1/websocket?apikey=k&vsn=1.0.0');
    s.onopen!();
    expect(s.sent[0]).toMatchObject({ topic: CH, event: 'phx_join', ref: '1', payload: { config: { broadcast: { self: false }, private: false }, access_token: 'k' } });
  });

  it('refreshes once, 300 ms after the first of a burst of signals', () => {
    const { f, refresh } = start();
    const s = f.socks[0]; joined(f, s);
    f.say(s, { topic: CH, event: 'broadcast', payload: {} });
    vi.advanceTimersByTime(200);
    for (let i = 0; i < 4; i++) f.say(s, { topic: CH, event: 'broadcast', payload: {} });   // later signals do not push it back
    vi.advanceTimersByTime(99); expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(refresh).toHaveBeenCalledTimes(1);
    f.say(s, { topic: CH, event: 'broadcast', payload: {} });
    vi.advanceTimersByTime(300); expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores another topic and does not refresh on the first join', () => {
    const { f, refresh } = start();
    const s = f.socks[0]; joined(f, s);
    f.say(s, { topic: 'realtime:other', event: 'broadcast', payload: {} });
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('waits while someone is typing, then refreshes once', () => {
    let typing = true;
    const { f, refresh } = start(() => typing);
    const s = f.socks[0]; joined(f, s);
    f.say(s, { topic: CH, event: 'broadcast', payload: {} });
    vi.advanceTimersByTime(10000); expect(refresh).not.toHaveBeenCalled();
    typing = false;
    vi.advanceTimersByTime(1000); expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reconnects after 1, 2, 4 s up to 30 s, and refreshes once after a rejoin', () => {
    const { f, refresh } = start();
    f.socks[0].close();
    vi.advanceTimersByTime(999); expect(f.socks).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(f.socks).toHaveLength(2);
    f.socks[1].close(); vi.advanceTimersByTime(2000); expect(f.socks).toHaveLength(3);
    f.socks[2].close(); vi.advanceTimersByTime(4000); expect(f.socks).toHaveLength(4);
    for (const [i, d] of [8000, 16000, 30000, 30000, 30000].entries()) {   // then 8, 16, and 30 s each: the cap
      f.socks[3 + i].close();
      vi.advanceTimersByTime(d - 1); expect(f.socks).toHaveLength(4 + i);
      vi.advanceTimersByTime(1); expect(f.socks).toHaveLength(5 + i);
    }
    joined(f, f.socks[8]);
    vi.advanceTimersByTime(300); expect(refresh).toHaveBeenCalledTimes(1);
    f.socks[8].close(); vi.advanceTimersByTime(1000); expect(f.socks).toHaveLength(10);   // a good join starts the backoff over
  });

  it('closes a socket whose join is refused, or not answered in 10 s', () => {
    const { f } = start();
    f.socks[0].onopen!();
    f.say(f.socks[0], { topic: CH, event: 'phx_reply', ref: '1', payload: { status: 'error' } });
    expect(f.socks[0].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    f.socks[1].onopen!();
    vi.advanceTimersByTime(10000);
    expect(f.socks[1].closed).toBe(true);
  });

  it('sends a heartbeat every 20 s and closes when the last one was not answered', () => {
    const { f } = start();
    const s = f.socks[0]; joined(f, s);
    vi.advanceTimersByTime(20000);
    const hb = s.sent.at(-1)!;
    expect(hb).toMatchObject({ topic: 'phoenix', event: 'heartbeat' });
    f.say(s, { topic: 'phoenix', event: 'phx_reply', ref: hb.ref, payload: { status: 'ok' } });
    vi.advanceTimersByTime(20000); expect(s.closed).toBe(false);
    vi.advanceTimersByTime(20000); expect(s.closed).toBe(true);
  });

  it('gives up on a dead network at once: an unanswered heartbeat or join brings a new socket after the backoff', () => {
    const { f } = start(undefined, true);
    joined(f, f.socks[0]);
    vi.advanceTimersByTime(40000); expect(f.socks[0].closed).toBe(true);   // heartbeat at 20 s, unanswered at 40 s
    vi.advanceTimersByTime(1000); expect(f.socks).toHaveLength(2);
    f.socks[1].onopen!();
    vi.advanceTimersByTime(10000); expect(f.socks[1].closed).toBe(true);
    vi.advanceTimersByTime(1999); expect(f.socks).toHaveLength(2);
    vi.advanceTimersByTime(1); expect(f.socks).toHaveLength(3);
  });

  it('reconnects when the server errors or closes the channel', () => {
    const { f } = start();
    joined(f, f.socks[0]);
    f.say(f.socks[0], { topic: CH, event: 'phx_error', payload: {} });
    expect(f.socks[0].closed).toBe(true);
    vi.advanceTimersByTime(1000); expect(f.socks).toHaveLength(2);
    joined(f, f.socks[1]);
    f.say(f.socks[1], { topic: CH, event: 'phx_close', payload: {} });
    expect(f.socks[1].closed).toBe(true);
    vi.advanceTimersByTime(1000); expect(f.socks).toHaveLength(3);
  });

  it('ignores a frame that is not a JSON object', () => {
    const { f, refresh } = start();
    const s = f.socks[0]; joined(f, s);
    for (const data of ['not json', 'null', '5', '"x"']) expect(() => s.onmessage!({ data })).not.toThrow();
    expect(s.closed).toBe(false);
    f.say(s, { topic: CH, event: 'broadcast', payload: {} });
    vi.advanceTimersByTime(300); expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stops for good: no reconnect, no refresh', () => {
    const { f, refresh, stop } = start();
    const s = f.socks[0]; joined(f, s);
    f.say(s, { topic: CH, event: 'broadcast', payload: {} });
    stop();
    vi.advanceTimersByTime(60000);
    expect(s.closed).toBe(true);
    expect(f.socks).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('whenFree', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('runs once nobody is typing, and not after a cancel', () => {
    let typing = true; const run = vi.fn();
    whenFree(() => typing, run, 0);
    vi.advanceTimersByTime(3000); expect(run).not.toHaveBeenCalled();
    typing = false; vi.advanceTimersByTime(1000); expect(run).toHaveBeenCalledTimes(1);
    const cancel = whenFree(() => false, run, 300); cancel();
    vi.advanceTimersByTime(1000); expect(run).toHaveBeenCalledTimes(1);
  });
});
