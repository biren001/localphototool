"""Generate the HEIC fixtures used by the browser tests.

A real iPhone photo is both copyrighted and irreproducible in a test run, so we
synthesise one: a photo-like image encoded to HEIC by libheif. Two files, because
the interesting failure is not "it crashed" but "it came out sideways".

  sample.heic    the plain case — 1200x900 landscape
  rotated.heic   the same pixels stored landscape but tagged EXIF Orientation 6,
                 which is exactly what an iPhone portrait photo looks like on
                 disk. A converter that ignores the tag hands back a sideways
                 JPEG, which for the "my phone photos won't open on Windows"
                 audience is worse than an error message.

Run: python _dev/gen-heic-fixture.py
"""
import os
import sys

from PIL import Image, ImageDraw

from pillow_heif import register_heif_opener

register_heif_opener()

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)

W, H = 1200, 900


def build():
    """A synthetic photo: smooth gradient (so JPEG quality is measurable) with
    some hard edges (so a bad downscale shows up)."""
    img = Image.new('RGB', (W, H), (14, 20, 38))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(14 + 60 * t), int(20 + 90 * t), int(38 + 140 * t)))
    for i in range(9):
        x = 80 + i * 122
        d.ellipse([x, 380, x + 190, 620], outline=(120 + i * 12, 220 - i * 10, 240), width=5)
    d.rectangle([60, 60, 520, 200], fill=(250, 250, 252))
    d.rectangle([80, 90, 500, 130], fill=(20, 24, 40))
    d.rectangle([80, 150, 380, 176], fill=(120, 130, 150))
    return img


def stored_dims(path):
    """The dimensions as they are written on disk (the `ispe` box), NOT what a
    viewer shows. This is the number that matters for the orientation fixture:
    if the encoder silently rotated the pixels, the fixture is not testing what
    it claims to test."""
    raw = open(path, 'rb').read()
    i = raw.find(b'ispe')
    if i < 0:
        return None
    return int.from_bytes(raw[i + 8:i + 12], 'big'), int.from_bytes(raw[i + 12:i + 16], 'big')


def main():
    img = build()

    plain = os.path.join(OUT, 'sample.heic')
    img.save(plain, format='HEIF', quality=90)

    exif = img.getexif()
    exif[274] = 6                       # Orientation: rotate 90° CW for display
    rotated = os.path.join(OUT, 'rotated.heic')
    img.save(rotated, format='HEIF', quality=90, exif=exif.tobytes())

    ok = True
    for path in (plain, rotated):
        size = os.path.getsize(path)
        stored = stored_dims(path)
        try:
            with Image.open(path) as back:
                dims = back.size
                orient = back.getexif().get(274)
        except Exception as e:          # noqa: BLE001 - report, do not hide
            print('FAIL  cannot re-read %s: %s' % (os.path.basename(path), e))
            ok = False
            continue
        print('%-13s %6d B  stored=%sx%s  reopened=%sx%s  orientation=%s' % (
            os.path.basename(path), size,
            stored[0], stored[1], dims[0], dims[1], orient))
        if size < 1000:
            print('FAIL  %s looks empty' % os.path.basename(path))
            ok = False

    if stored_dims(rotated) != (W, H):
        print('\nWARN  rotated.heic was re-encoded at %s — the encoder baked the\n'
              '      rotation into the pixels, so it no longer exercises the\n'
              '      "landscape on disk + orientation tag" path.' % (stored_dims(rotated),))

    if not ok:
        sys.exit(1)
    print('\nfixtures written to ' + OUT)


if __name__ == '__main__':
    main()
