import { Easing, interpolate } from 'remotion';
import type { CSSProperties } from 'react';

const out = Easing.out(Easing.cubic);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0 → 1 between `start` and `start + dur` frames, eased out. */
export const ease = (frame: number, start: number, dur: number) => interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing: out });

/** The one motion grammar: rise 12 px and fade in over `dur` frames (default 400 ms). */
export const rise = (frame: number, start: number, dur = 12): CSSProperties => {
  const p = ease(frame, start, dur);
  return { opacity: p, transform: `translateY(${(1 - p) * 12}px)` };
};

/** Fade only. */
export const fade = (frame: number, start: number, dur = 12): CSSProperties => ({ opacity: ease(frame, start, dur) });

/** Fade out between start and start + dur. */
export const fadeOut = (frame: number, start: number, dur = 12): CSSProperties => ({ opacity: 1 - ease(frame, start, dur) });

/** The landing page's write-in: the element is revealed left to right. */
export const writeIn = (frame: number, start: number, dur = 15): CSSProperties => ({ clipPath: `inset(0 ${(1 - ease(frame, start, dur)) * 100}% 0 0)` });

/** A number that counts from a to b with the same easing. */
export const count = (frame: number, start: number, dur: number, a: number, b: number) => Math.round(a + (b - a) * ease(frame, start, dur));

/** A slow camera push: scale 1 → 1 + amount over the whole scene. */
export const push = (frame: number, len: number, amount = 0.04): CSSProperties => ({
  transform: `scale(${1 + interpolate(frame, [0, len], [0, amount], clamp)})`,
});
