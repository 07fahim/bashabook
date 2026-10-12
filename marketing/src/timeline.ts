/** One place for every cut, in frames at 30 fps. Scene order and lengths follow the approved storyboard. */
export const FPS = 30;
const sec = (s: number) => Math.round(s * FPS);

export const SCENES = [
  { id: 'khata', from: 0, len: sec(4) },        // 1  the notebook writes itself
  { id: 'argument', from: sec(4), len: sec(6) },   // 2  a crossed-out line, the headline
  { id: 'meals', from: sec(10), len: sec(6) },     // 3  a dinner chip goes off
  { id: 'plates', from: sec(16), len: sec(6) },    // 4  the cook's number drops 9 → 8
  { id: 'bazar', from: sec(22), len: sec(7) },     // 5  Add bazar, who paid the shop
  { id: 'confirm', from: sec(29), len: sec(5) },   // 6  Waiting for you → confirmed
  { id: 'breakdown', from: sec(34), len: sec(6) }, // 7  How this adds up
  { id: 'close', from: sec(40), len: sec(7) },     // 8  cash counted, it matches
  { id: 'settle', from: sec(47), len: sec(5) },    // 9  settle-up lines → group chat
  { id: 'brand', from: sec(52), len: sec(4) },     // 10 lockup, URL, Create a flat
  { id: 'maker', from: sec(56), len: sec(4) },     // 11 maker card
] as const;

export type SceneId = (typeof SCENES)[number]['id'];
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
