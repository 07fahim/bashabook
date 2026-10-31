type Env = Record<string, string | undefined>;

const FROM = 'BashaBook <noreply@bashabook.fahimfaiyaz.dev>';

/** Where links in emails point: production's own address, a preview's own, else this machine. Never the request's Host. */
export const siteUrl = (env: Env = process.env) =>
  env.VERCEL_ENV === 'production' ? 'https://bashabook.fahimfaiyaz.dev' : env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000';

/** Sends one plain-text email through Resend (free plan: 100 a day). Never throws: a failure is logged without the address
 *  and returns false. No key: EMAIL_LOG=1 prints the mail (local checks read codes there; never on Vercel, where logs are
 *  kept), else a warning. */
export async function sendEmail(to: string, subject: string, text: string, env: Env = process.env, f: typeof fetch = fetch) {
  const key = env.RESEND_API_KEY;
  if (!key) {
    if (env.EMAIL_LOG === '1' && !env.VERCEL) console.log(`email to ${to}: ${subject}\n${text}`);
    else console.warn('email not sent: no RESEND_API_KEY');
    return false;
  }
  try {
    const r = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000), // a stalled send must not hold the after() invocation
    });
    if (!r.ok) console.warn('email failed', r.status);
    return r.ok;
  } catch (e) {
    console.warn('email failed', (e as Error).name);
    return false;
  }
}
