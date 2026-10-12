import { staticFile } from 'remotion';
import { useCurrentFrame } from 'remotion';
import type { Data } from '../data';
import { ease, rise } from '../ui/anim';
import { primary } from '../ui/classes';
import { Stage } from '../ui/Stage';

/** Scene 10. The notebook cover closes, then the lockup, the address and Create a flat. */
export function Brand({ d }: { d: Data }) {
  const frame = useCurrentFrame(), t = d.t;
  const cover = ease(frame, 0, 15), gone = ease(frame, 30, 12);
  return (
    <Stage style={{ display: 'grid', placeItems: 'center' }}>
      <div className="col-start-1 row-start-1 h-[300px] w-[520px] rounded-3xl border border-line bg-surface shadow-card" style={{ opacity: 1 - gone, transform: `perspective(1200px) rotateY(${-90 + 90 * cover}deg) scale(${1 - gone * 0.1})`, transformOrigin: 'left' }} />
      <div className="col-start-1 row-start-1 flex flex-col items-center text-center" style={{ opacity: gone }}>
        <p className="flex items-center gap-3 font-display text-6xl font-bold" style={rise(frame, 36, 14)}>
          <img src={staticFile('logo-mark.png')} alt="" width={62} height={64} />
          <span>{t.brand}<span className="text-turmeric-ink">{t.brandAccent}</span></span>
        </p>
        <p className="mt-4 text-2xl text-muted" style={rise(frame, 50, 14)}>bashabook.fahimfaiyaz.dev</p>
        <div className={`mt-8 ${primary} text-xl`} style={{ width: 'auto', ...rise(frame, 64, 14) }}>{t.create}</div>
      </div>
    </Stage>
  );
}
