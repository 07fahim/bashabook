import { describe, it, expect, vi } from 'vitest';
import { sendEmail, siteUrl } from './email';

describe('sending email', () => {
  it('posts one plain-text email to Resend with the key', async () => {
    const f = vi.fn<(...a: unknown[]) => Promise<Response>>(async () => new Response('{}', { status: 200 }));
    expect(await sendEmail('a@b.co', 'S', 'T', { RESEND_API_KEY: 'k' }, f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer k', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ from: 'BashaBook <noreply@bashabook.fahimfaiyaz.dev>', to: ['a@b.co'], subject: 'S', text: 'T' });
  });

  it('a refused or failed send returns false and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendEmail('a@b.co', 'S', 'T', { RESEND_API_KEY: 'k' }, (async () => new Response('{}', { status: 422 })) as unknown as typeof fetch)).toBe(false);
    expect(await sendEmail('a@b.co', 'S', 'T', { RESEND_API_KEY: 'k' }, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('a@b.co');
    warn.mockRestore();
  });

  it('a stalled send gives up after 10 seconds', async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => real(10));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stalled = (...a: unknown[]) => new Promise<Response>((_, reject) => {
      const s = (a[1] as RequestInit).signal;
      s?.addEventListener('abort', () => reject(s.reason));
    });
    expect(await sendEmail('a@b.co', 'S', 'T', { RESEND_API_KEY: 'k' }, stalled as unknown as typeof fetch)).toBe(false);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(warn).toHaveBeenCalledWith('email failed', 'TimeoutError');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('a@b.co');
    timeout.mockRestore(); warn.mockRestore();
  });

  it('without a key: prints the mail when EMAIL_LOG=1 (local checks), else only warns; nothing is posted', async () => {
    const f = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {}), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendEmail('a@b.co', 'Code: 123456', 'Body', { EMAIL_LOG: '1' }, f as unknown as typeof fetch)).toBe(false);
    expect(String(log.mock.calls[0][0])).toContain('Code: 123456');
    expect(await sendEmail('a@b.co', 'S', 'T', {}, f as unknown as typeof fetch)).toBe(false);
    expect(warn).toHaveBeenCalledWith('email not sent: no RESEND_API_KEY');
    expect(f).not.toHaveBeenCalled();
    log.mockRestore(); warn.mockRestore();
  });

  it('links point to production, to a preview or to this machine, never the request host', () => {
    expect(siteUrl({ VERCEL_ENV: 'production', VERCEL_URL: 'x.vercel.app' })).toBe('https://bashabook.fahimfaiyaz.dev');
    expect(siteUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'x.vercel.app' })).toBe('https://x.vercel.app');
    expect(siteUrl({})).toBe('http://localhost:3000');
  });
});
