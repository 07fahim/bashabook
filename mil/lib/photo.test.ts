import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat, listMembers } from './auth';
import { fromDataUrl, initials, photoOf, removePhoto, setPhoto } from './photo';

const jpeg = (n = 100) => Uint8Array.from({ length: n }, (_, i) => (i < 3 ? [0xff, 0xd8, 0xff][i] : i % 251));

async function flat(name = 'Flat 4B') {
  await migrate();
  const f = await createFlat(db, { flatName: name, name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-10-09', lang: 'bn' });
  const tahsin = (await listMembers(db, f.flatId)).find(m => m.name === 'Tahsin')!.id;
  const nafis = { flatId: f.flatId, memberId: f.memberId, role: 'manager' as const }, asTahsin = { flatId: f.flatId, memberId: tahsin, role: 'member' as const };
  return { ...f, tahsin, nafis, asTahsin };
}

describe('photos', { timeout: 30000 }, () => {
  it('makes initials from the first letters, Bangla too', () => {
    expect(initials('Nafis Rahman')).toBe('NR');
    expect(initials('Zarif')).toBe('Z');
    expect(initials('  tahsin   ahmed  khan ')).toBe('TA');
    expect(initials('তাহসিন আহমেদ')).toBe('তাআ');   // a consonant with its vowel sign is one letter
    expect(initials('Zarif "Z"')).toBe('ZZ');         // quotes, brackets and digits are not initials
    expect(initials('(Rahim) 2 Khan')).toBe('RK');
    expect(initials('42')).toBe('4');                   // no letters: never an empty circle
  });

  it('saves a small JPEG, shows its version in the members list, and refuses anything else', async () => {
    const { flatId, memberId } = await flat();
    expect((await listMembers(db, flatId)).find(m => m.id === memberId)!.photoV).toBeNull();
    expect(await setPhoto(db, memberId, jpeg())).toBe(true);
    const v1 = (await listMembers(db, flatId)).find(m => m.id === memberId)!.photoV;
    expect(v1).not.toBeNull();
    expect(Array.from((await photoOf(db, flatId, memberId))!.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(await setPhoto(db, memberId, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2]))).toBe(false);   // a PNG
    expect(await setPhoto(db, memberId, jpeg(70_000))).toBe(false);                                      // too big
    await setPhoto(db, memberId, jpeg(200));
    expect((await listMembers(db, flatId)).find(m => m.id === memberId)!.photoV).not.toBe(v1);           // a new photo, a new version
  });

  it('reads only a base64 JPEG data URL', () => {
    expect(Array.from(fromDataUrl('data:image/jpeg;base64,/9j/')!)).toEqual([0xff, 0xd8, 0xff]);
    expect(fromDataUrl('')).toBeNull();                                  // a photo the phone could not open
    expect(fromDataUrl('data:image/png;base64,iVBORw==')).toBeNull();
    expect(fromDataUrl('data:image/jpeg;base64,<script>')).toBeNull();
  });

  it('only the flat can see a photo', async () => {
    const a = await flat('A'), b = await flat('B');
    await setPhoto(db, a.memberId, jpeg());
    expect(await photoOf(db, a.flatId, a.memberId)).not.toBeNull();
    expect(await photoOf(db, b.flatId, a.memberId)).toBeNull();
  });

  it('I remove my own photo; the person who runs the flat removes anyone’s; others cannot', async () => {
    const { flatId, memberId, tahsin, nafis, asTahsin } = await flat();
    await setPhoto(db, memberId, jpeg());
    await setPhoto(db, tahsin, jpeg());
    expect(await removePhoto(db, asTahsin, memberId)).toBe(false);
    expect(await removePhoto(db, asTahsin, tahsin)).toBe(true);
    await setPhoto(db, tahsin, jpeg());
    expect(await removePhoto(db, nafis, tahsin)).toBe(true);
    expect(await photoOf(db, flatId, tahsin)).toBeNull();
  });

  it('the person who runs another flat cannot remove my photo', async () => {
    const a = await flat('A'), b = await flat('B');
    await setPhoto(db, a.memberId, jpeg());
    expect(await removePhoto(db, b.nafis, a.memberId)).toBe(false);
    expect(await photoOf(db, a.flatId, a.memberId)).not.toBeNull();
  });
});
