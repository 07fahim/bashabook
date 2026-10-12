# BashaBook marketing film

A 60-second launch film, 1920×1080, 30 fps, light theme, built with Remotion. Every screen is rebuilt in code from the app's own tokens (`app/globals.css`), class strings (`app/[lang]/ui.tsx`) and copy (`app/[lang]/dictionaries.ts`), with synthetic data. No screen recordings. Two compositions: `BashaBookEN` and `BashaBookBN`.

This folder is isolated from the app: its own `package.json`, no app code is changed.

## Layout

- `src/timeline.ts` — every cut in frames, and where each voice line starts.
- `src/Video.tsx` — scenes in sequence, voice and music tracks, the cross-fade on cuts.
- `src/scenes/` — one file per scene, in storyboard order: Khata (1–2), Meals, Plates, Bazar, Confirm, Breakdown, Close, Settle, Brand, Maker.
- `src/ui/` — the app's class strings, the motion helpers (rise, write-in, count, push), the stage and top bar.
- `src/data.ts` — the synthetic flat (Nafis, Tahsin, Zarif …) and its numbers.
- `scripts/voice.py` — voice lines → `public/audio/{en,bn}/NN.mp3` (Microsoft neural voices via `edge-tts`).
- `scripts/music.mjs` — the ambient bed → `public/audio/music.wav`.
- `public/` — logo mark and audio.

## Commands (run in `marketing/`)

```bash
npm install                 # once
pip install edge-tts        # once, for the voice
python scripts/voice.py     # regenerate voice lines (skips files that exist)
node scripts/music.mjs      # regenerate the music bed
npm run studio              # preview in the browser
npm run render:en           # out/bashabook-en.mp4
npm run render:bn           # out/bashabook-bn.mp4
```

Check a render: `ffprobe -show_entries format=duration:stream=width,height,r_frame_rate out/bashabook-en.mp4`.

## Replacing the audio

Drop your own recordings as `public/audio/en/01.mp3` … `10.mp3` (same numbering as `scripts/voice.py`), or a music track as `public/audio/music.wav`, and re-render. Shift a line's start in `src/timeline.ts` (`VOICE[].at`, seconds after its scene's cut).

## Maker card

`src/scenes/Maker.tsx`, the `MAKER` constant.
