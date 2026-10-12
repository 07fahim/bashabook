import { useCurrentFrame } from 'remotion';
import { fadeOut, rise } from '../ui/anim';
import { Stage } from '../ui/Stage';

/** Scene 11. Maker card, three lines plus the address. */
export const MAKER = { lead: 'Designed and built by', name: 'Fahim Faiyaz', role: 'AI/ML Engineer · AI agents, automation, computer vision & RAG', url: 'fahimfaiyaz.dev' };

export function Maker() {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <div className="text-center" style={fadeOut(frame, 100, 20)}>
        <p className="text-xl text-muted" style={rise(frame, 4, 14)}>{MAKER.lead}</p>
        <p className="mt-2 font-display text-5xl font-bold" style={rise(frame, 10, 14)}>{MAKER.name}</p>
        <p className="mt-3 text-xl text-muted" style={rise(frame, 18, 14)}>{MAKER.role}</p>
        <p className="mt-6 text-2xl font-semibold text-turmeric-ink" style={rise(frame, 26, 14)}>{MAKER.url}</p>
      </div>
    </Stage>
  );
}
