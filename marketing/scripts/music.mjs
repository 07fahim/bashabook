// A restrained ambient bed: a slow pad on two chords and a soft pulse at 72 bpm, 60 s, 44.1 kHz, 16-bit mono WAV.
// Run: node scripts/music.mjs   →  public/audio/music.wav
import { writeFileSync } from 'node:fs';

const SR = 44100, LEN = 60, N = SR * LEN, out = new Int16Array(N);
const chords = [[220, 277.18, 329.63, 415.3], [196, 246.94, 293.66, 392]];   // A major add 7 → G major, swapped every 8 s
const beat = 60 / 72;
for (let i = 0; i < N; i++) {
  const t = i / SR, c = chords[Math.floor(t / 8) % 2];
  let pad = 0;
  for (const f of c) pad += Math.sin(2 * Math.PI * f * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.07 * t + f));
  pad *= 0.09 * (1 + 0.15 * Math.sin(2 * Math.PI * 0.11 * t));
  const b = (t % beat) / beat, pulse = t > 4 && t < 52 ? Math.exp(-b * 9) * Math.sin(2 * Math.PI * 110 * t) * 0.07 : 0;
  const env = Math.min(1, t / 2, (LEN - t) / 3);
  out[i] = Math.max(-1, Math.min(1, (pad + pulse) * env)) * 32767;
}
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + N * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(N * 2, 40);
writeFileSync(new URL('../public/audio/music.wav', import.meta.url), Buffer.concat([h, Buffer.from(out.buffer)]));
console.log('music.wav', LEN, 's');
