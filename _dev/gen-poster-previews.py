"""Poster previews for the share page.

The share page displays each 1080x1350 poster in a box that is ~350 CSS px wide
on a phone and ~530 on a desktop, so shipping the print-resolution PNG to the
browser cost ~977 KB and pushed first paint past four seconds on mobile. The
full PNG stays the download; these are what the page actually shows.

Run:  python _dev/gen-poster-previews.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHARE = os.path.join(ROOT, 'localphototool', 'share')

# 720 px covers a 350 px phone at ~2x and a 530 px desktop card at 1.35x.
# The posters are flat colour, type and a high-error-correction QR, so WebP at
# quality 88 is visually indistinguishable from the PNG at a fraction of it.
WIDTH = 720
QUALITY = 88

def main():
    for name in ('poster-cn', 'poster-en'):
        src = os.path.join(SHARE, name + '.png')
        dst = os.path.join(SHARE, name + '-preview.webp')
        im = Image.open(src).convert('RGB')
        h = round(im.height * WIDTH / im.width)
        im = im.resize((WIDTH, h), Image.LANCZOS)
        im.save(dst, 'WEBP', quality=QUALITY, method=6)
        print('%-14s %6.1f KB -> %-26s %6.1f KB  (%dx%d)' % (
            name + '.png', os.path.getsize(src) / 1024,
            name + '-preview.webp', os.path.getsize(dst) / 1024, WIDTH, h))

if __name__ == '__main__':
    main()
