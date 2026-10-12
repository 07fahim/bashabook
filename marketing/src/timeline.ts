/** One place for every cut, in frames at 30 fps. Scene order and lengths follow the approved storyboard. */
export const FPS = 30;
const sec = (s: number) => Math.round(s * FPS);

const lengths = [
  ['khata', 4],      // 1  the notebook writes itself
  ['argument', 6],   // 2  a crossed-out line, the headline
  ['meals', 6],      // 3  a dinner chip goes off
  ['plates', 6],     // 4  the cook's number drops 9 → 8
  ['bazar', 7],      // 5  Add bazar, who paid the shop
  ['confirm', 5],    // 6  Waiting for you → confirmed
  ['breakdown', 6],  // 7  How this adds up
  ['close', 7],      // 8  cash counted, it matches
  ['settle', 5],     // 9  settle-up lines → group chat
  ['brand', 4],      // 10 lockup, URL, Create a flat
  ['maker', 4],      // 11 maker card
] as const;

export type SceneId = (typeof lengths)[number][0];
// each scene starts where the one before ends, so one edited length moves every later cut
export const SCENES = lengths.map(([id, s], i) => ({ id, len: sec(s), from: sec(lengths.slice(0, i).reduce((n, [, l]) => n + l, 0)) }));
export const scene = (id: SceneId) => SCENES.find(s => s.id === id)!;
export const TOTAL = SCENES.reduce((n, s) => n + s.len, 0);   // 1800

/** Voice lines: which scene each starts in and how long after the cut (seconds). */
export const VOICE: { id: SceneId; at: number; file: string }[] = [
  { id: 'khata', at: 1.2, file: '01' },
  { id: 'argument', at: 0.3, file: '02' },
  { id: 'meals', at: 0.4, file: '03' },
  { id: 'plates', at: 0.6, file: '04' },
  { id: 'bazar', at: 0.4, file: '05' },
  { id: 'confirm', at: 0.3, file: '06' },
  { id: 'breakdown', at: 0.4, file: '07' },
  { id: 'close', at: 0.4, file: '08' },
  { id: 'settle', at: 0, file: '09' },
  { id: 'brand', at: 0.3, file: '10' },
];
