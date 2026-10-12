"""Voice lines → public/audio/{en,bn}/NN.mp3 with Microsoft neural voices (edge-tts). Run: python scripts/voice.py"""
import asyncio, pathlib, edge_tts

VOICES = {'en': 'en-US-AndrewNeural', 'bn': 'bn-BD-PradeepNeural'}
LINES = {
    'en': [
        'Every shared flat runs on a notebook.',
        'And every month, the notebook starts an argument.',
        'Everyone sets their own plates before the lock.',
        'The cook gets one number.',
        'Bazar, bills, deposits. Every entry says who paid.',
        'Money between two people waits for a tap.',
        'And every balance shows how it adds up.',
        'At month end, the collector counts the cash.',
        'When it matches, the month closes. Everyone gets their line.',
        'BashaBook. Run your flat without the daily hassle.',
    ],
    'bn': [
        'প্রতিটা শেয়ার করা ফ্ল্যাট চলে একটা খাতায়।',
        'আর মাস শেষে সেই খাতা থেকেই শুরু হয় ঝগড়া।',
        'সবাই নিজের মিল ঠিক করে লক হওয়ার আগে।',
        'রাঁধুনি পান একটাই সংখ্যা।',
        'বাজার, বিল, জমা। প্রতিটা হিসাবে লেখা থাকে কে দিয়েছে।',
        'দুজনের মধ্যে টাকা এক ট্যাপের অপেক্ষায় থাকে।',
        'আর প্রতিটা হিসাব দেখায়, কীভাবে এটা মিলল।',
        'মাস শেষে হাতে থাকা টাকা গোনা হয়।',
        'মিলে গেলে মাস বন্ধ হয়। সবাই পান নিজের লাইন।',
        'বাসাবুক। ফ্ল্যাটের হিসাব নিয়ে আর ঝামেলা নেই।',
    ],
}

async def main():
    for lang, lines in LINES.items():
        out = pathlib.Path(__file__).resolve().parents[1] / 'public' / 'audio' / lang
        out.mkdir(parents=True, exist_ok=True)
        for i, text in enumerate(lines, 1):
            f = out / f'{i:02d}.mp3'
            if f.exists(): continue
            for attempt in range(4):   # the service drops a request now and then
                try:
                    await edge_tts.Communicate(text, VOICES[lang], rate='-5%').save(str(f)); break
                except edge_tts.exceptions.NoAudioReceived:
                    if attempt == 3: raise
                    await asyncio.sleep(2)
            print(lang, f'{i:02d}', text)

asyncio.run(main())
