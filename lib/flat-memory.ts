/** The last flat opened on this phone, kept in the browser (never sent anywhere) so a lost code is one tap away. The value
 *  is the visitor's own and may be anything: only a real join code and a short name are used. */
export const FLAT_KEY = 'flat';
export type Remembered = { code: string; name: string };

export function readFlat(raw: string | null): Remembered | null {
  try {
    const v = JSON.parse(raw ?? '') as { code?: unknown; name?: unknown } | null;
    const { code, name } = v ?? {};
    return typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code) && typeof name === 'string' && name.trim() !== '' && name.length < 100
      ? { code, name } : null;
  } catch { return null; }
}
