import { Composition } from 'remotion';
import { Video } from './Video';
import { FPS, TOTAL } from './timeline';
import './style.css';

export const Root = () => (
  <>
    <Composition id="BashaBookEN" component={Video} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} defaultProps={{ lang: 'en' as const }} />
    <Composition id="BashaBookBN" component={Video} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} defaultProps={{ lang: 'bn' as const }} />
  </>
);
