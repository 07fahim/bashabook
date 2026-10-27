"""Cuts the B symbol out of the BashaBook logo and writes the navbar mark and app icons.
Run from the repo root: python scripts/make-icons.py"""
from PIL import Image, ImageChops

PAPER = '#FBF7F0'
logo = Image.open('asset/BashaBook_English_transparent.png').convert('RGBA')
mark = logo.crop((0, 0, 735, logo.height))   # the symbol ends at x=722, the wordmark starts at 748
# the transparent export was cut from a black background and keeps dark specks along its edges; the symbol itself has no
# dark colour (orange, yellow, white), so any dark pixel is left-over background
r, g, b, a = mark.split()
mark.putalpha(ImageChops.multiply(a, ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v >= 120 else 0)))
mark = mark.crop(mark.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox())  # ignore faint stray pixels

# navbar mark: 64 px tall (2x for a 32 px slot), transparent
w = round(mark.width * 64 / mark.height)
mark.resize((w, 64), Image.LANCZOS).save('public/logo-mark.png', optimize=True)
print('wrote public/logo-mark.png')

# app icons: symbol at 60% on paper, inside the maskable safe zone
S = 1024
icon = Image.new('RGBA', (S, S), PAPER)
side = int(S * 0.6)
scaled = mark.resize((round(mark.width * side / max(mark.size)), round(mark.height * side / max(mark.size))), Image.LANCZOS)
icon.alpha_composite(scaled, ((S - scaled.width) // 2, (S - scaled.height) // 2))
icon = icon.convert('RGB')
for size, path in ((512, 'public/icon-512.png'), (192, 'public/icon-192.png'), (180, 'public/apple-icon.png')):
    icon.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print('wrote', path)
# browsers ask for /favicon.ico on their own (and some pages carry no icon link): one file, three sizes
icon.save('public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('wrote public/favicon.ico')
