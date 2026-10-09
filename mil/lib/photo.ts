import type { Db } from './db';

export const MAX_PHOTO = 60_000;

/** A JPEG as the app's picker makes it (starts FF D8 FF), at most 60 KB. Anything else is refused. */
export const isJpeg = (b: Uint8Array) => b.length > 3 && b.length <= MAX_PHOTO && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** 'Nafis Rahman' → 'NR', 'তাহসিন আহমেদ' → 'তাআ': the first letter of the first two words (a Bangla letter with its vowel sign counts as one). */
export function initials(name: string) {
  const letters = new Intl.Segmenter('bn', { granularity: 'grapheme' });
  return name.trim().split(/\s+/).slice(0, 2).map(w => [...letters.segment(w)][0]?.segment ?? '').join('').toUpperCase();
}

/** My photo; a new one bumps photo_v so phones fetch it again. False if it isn't a small JPEG. */
export async function setPhoto(db: Db, memberId: string, bytes: Uint8Array) {
  if (!isJpeg(bytes)) return false;
  const done = await db(`update members set photo = $2, photo_v = photo_v + 1 where id = $1 returning 1`, [memberId, Buffer.from(bytes)]);
  return done.length > 0;
}

/** I remove my own photo; the person who runs the flat removes anyone's in the flat. */
export async function removePhoto(db: Db, flatId: string, by: { memberId: string; role: 'member' | 'manager' }, memberId: string) {
  const done = await db(
    `update members set photo = null, photo_v = photo_v + 1 where flat_id = $1 and id = $2 and photo is not null and ($3::boolean or id = $4) returning 1`,
    [flatId, memberId, by.role === 'manager', by.memberId]);
  return done.length > 0;
}

/** A photo, only for someone in the same flat. */
export async function photoOf(db: Db, flatId: string, memberId: string) {
  const [r] = await db<{ photo: Uint8Array | null }>(`select photo from members where flat_id = $1 and id = $2`, [flatId, memberId]);
  return r?.photo ?? null;
}
