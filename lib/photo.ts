import type { Db } from './db';

export const MAX_PHOTO = 60_000;
/** A receipt (020): long side 1280 px at JPEG quality 0.7 on the phone, measured on real receipts (bazar-check plan, Task 10). */
export const MAX_RECEIPT = 250_000;

/** A JPEG as the app's pickers make it (starts FF D8 FF), at most `max` bytes (a profile photo: 60 KB). Anything else is refused. */
export const isJpeg = (b: Uint8Array, max = MAX_PHOTO) => b.length > 3 && b.length <= max && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** The picker's data URL as bytes, or null for anything that isn't a base64 JPEG data URL. */
export function fromDataUrl(s: string) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(s);
  return m ? Uint8Array.from(Buffer.from(m[1], 'base64')) : null;
}

/** 'Nafis Rahman' → 'NR', 'তাহসিন আহমেদ' → 'তাআ': the first letter of the first two words (a Bangla letter with its vowel sign
 *  counts as one). Quotes, brackets and digits are skipped, so 'Zarif "Z"' is 'ZZ', not 'Z"'. */
export function initials(name: string) {
  const letters = new Intl.Segmenter('bn', { granularity: 'grapheme' });
  return name.trim().split(/\s+/)
    .map(w => [...letters.segment(w)].find(g => /\p{L}/u.test(g.segment))?.segment)
    .filter(Boolean).slice(0, 2).join('').toUpperCase() || [...letters.segment(name.trim())][0]?.segment || '?';   // no letters at all: its first sign
}

/** My photo; a new one bumps photo_v so phones fetch it again. False if it isn't a small JPEG. */
export async function setPhoto(db: Db, memberId: string, bytes: Uint8Array) {
  if (!isJpeg(bytes)) return false;
  const done = await db(`update members set photo = $2, photo_v = photo_v + 1 where id = $1 returning 1`, [memberId, Buffer.from(bytes)]);
  return done.length > 0;
}

/** I remove my own photo; the person who runs the flat removes anyone's in the flat. */
export async function removePhoto(db: Db, by: { flatId: string; memberId: string; role: 'member' | 'manager' }, memberId: string) {
  const done = await db(
    `update members set photo = null, photo_v = photo_v + 1 where flat_id = $1 and id = $2 and photo is not null and ($3::boolean or id = $4) returning 1`,
    [by.flatId, memberId, by.role === 'manager', by.memberId]);
  return done.length > 0;
}

/** A photo, only for someone in the same flat. */
export async function photoOf(db: Db, flatId: string, memberId: string) {
  const [r] = await db<{ photo: Uint8Array | null }>(`select photo from members where flat_id = $1 and id = $2`, [flatId, memberId]);
  return r?.photo ?? null;
}
