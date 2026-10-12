import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate } from 'remotion';
import { loadFont } from '@remotion/google-fonts/HindSiliguri';
import type { Locale } from '../../app/[lang]/dictionaries';
import { dataFor } from './data';
import { FPS, SCENES, TOTAL, VOICE, scene } from './timeline';
import { Khata } from './scenes/Khata';
import { Meals } from './scenes/Meals';
import { Plates } from './scenes/Plates';
import { Bazar } from './scenes/Bazar';
import { Confirm } from './scenes/Confirm';
import { Breakdown } from './scenes/Breakdown';
import { Close } from './scenes/Close';
import { Settle } from './scenes/Settle';
import { Brand } from './scenes/Brand';
import { Maker } from './scenes/Maker';

loadFont('normal', { weights: ['400', '600', '700'], subsets: ['bengali', 'latin'] });

export function Video({ lang }: { lang: Locale }) {
  const d = dataFor(lang), frame = useCurrentFrame();
  const parts = {
    khata: <Khata d={d} part="write" />, argument: <Khata d={d} part="argue" />, meals: <Meals d={d} lang={lang} />, plates: <Plates d={d} lang={lang} />,
    bazar: <Bazar d={d} lang={lang} />, confirm: <Confirm d={d} lang={lang} />, breakdown: <Breakdown d={d} />, close: <Close d={d} />,
    settle: <Settle d={d} />, brand: <Brand d={d} />, maker: <Maker />,
  };
  // one soft cross-fade on every cut, so no scene pops in
  const dip = SCENES.slice(1).reduce((v, s) => Math.max(v, interpolate(frame, [s.from - 6, s.from, s.from + 6], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })), 0);
  return (
    <AbsoluteFill className="bg-paper">
      {SCENES.map(s => <Sequence key={s.id} from={s.from} durationInFrames={s.len} name={s.id}>{parts[s.id]}</Sequence>)}
      <AbsoluteFill className="bg-paper" style={{ opacity: dip, pointerEvents: 'none' }} />
      {VOICE.map(v => <Sequence key={v.file} from={scene(v.id).from + Math.round(v.at * FPS)} name={`voice ${v.file}`}><Audio src={staticFile(`audio/${lang}/${v.file}.mp3`)} /></Sequence>)}
      <Audio src={staticFile('audio/music.wav')} volume={f => interpolate(f, [0, 30, TOTAL - 90, TOTAL], [0, 0.5, 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
    </AbsoluteFill>
  );
}
