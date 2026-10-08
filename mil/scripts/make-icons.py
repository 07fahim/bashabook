"""Draws the Mil app icon: a cooking pot (hari) with steam on turmeric.
Content stays inside the maskable safe zone. Run from mil/: python scripts/make-icons.py"""
from PIL import Image, ImageDraw

S = 1024  # draw large, then downscale for smooth edges
TURMERIC, INK, PAPER = '#D9901A', '#1C1A16', '#FBF7F0'

img = Image.new('RGB', (S, S), TURMERIC)
d = ImageDraw.Draw(img)
d.pieslice((302, 340, 722, 760), 0, 180, fill=INK)                  # bowl
d.rounded_rectangle((272, 520, 752, 575), radius=27, fill=INK)     # rim
for x in (422, 512, 602):                                           # steam
    d.rounded_rectangle((x - 17, 300, x + 17, 450), radius=17, fill=PAPER)

for size, path in ((512, 'public/icon-512.png'), (192, 'public/icon-192.png'), (180, 'public/apple-icon.png')):
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print('wrote', path)
