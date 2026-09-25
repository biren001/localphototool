"""Generate the probe image used by the upload-behaviour measurement.

The point of this file is that the measurement must be falsifiable, not a
matter of opinion. A unique UUID is embedded in the JPEG's EXIF
ImageDescription. If that exact byte string shows up in an outbound request
body, then bytes that came from this file left the browser, and no amount of
"we process locally" copy can argue with it.

The UUID is also written to probe-meta.json so the measurement script can
search for it without ever re-deriving it, and so the published report can
quote the marker that was actually used.

The image content is deliberately photo-like (gradients plus detail) so that
compressors behave the way they would with a real photograph, rather than
with a flat test pattern that encodes suspiciously well.
"""

import io
import json
import os
import random
import uuid

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, ".tmp")
OUT_IMG = os.path.join(OUT_DIR, "probe.jpg")
OUT_META = os.path.join(OUT_DIR, "probe-meta.json")

os.makedirs(OUT_DIR, exist_ok=True)

MARKER = "LPTPROBE-" + uuid.uuid4().hex
W, H = 1600, 1200


def build_image():
    """A photo-like image: smooth gradients plus fine detail plus edges."""
    rng = random.Random(20260925)
    img = Image.new("RGB", (W, H))
    px = img.load()

    # Large scale gradient - gives smooth areas compressors handle well.
    for y in range(H):
        for x in range(0, W, 4):
            r = int(120 + 110 * (x / W))
            g = int(90 + 120 * (y / H))
            b = int(150 - 60 * ((x + y) / (W + H)))
            for dx in range(4):
                if x + dx < W:
                    px[x + dx, y] = (r, g, b)

    draw = ImageDraw.Draw(img)
    # Hard edges - these are what make real photos expensive to encode.
    for _ in range(180):
        x0 = rng.randrange(W)
        y0 = rng.randrange(H)
        w = rng.randrange(20, 220)
        h = rng.randrange(20, 220)
        col = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
        draw.rectangle([x0, y0, x0 + w, y0 + h], outline=col, width=rng.randrange(1, 5))

    # Fine grain - stops the image from being unrealistically compressible.
    grain = Image.effect_noise((W, H), 24).convert("RGB")
    img = Image.blend(img, grain, 0.18)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    return img


def main():
    img = build_image()

    exif = Image.Exif()
    exif[0x010E] = MARKER          # ImageDescription - the searchable marker
    exif[0x0110] = "LocalPhotoTool Probe"   # Model
    exif[0x0131] = "LocalPhotoTool"          # Software

    # GPS, because "does my location leave the browser" is the question a
    # reader actually cares about, and it gives a second thing to look for.
    gps = exif.get_ifd(0x8825)
    # GPS coordinates are RATIONAL, and Pillow's rational writer takes floats,
    # not (numerator, denominator) tuples. Passing tuples raises
    # "bad operand type for abs(): tuple" deep inside TiffImagePlugin.
    gps[1] = "N"
    gps[2] = (37.0, 46.0, 12.34)
    gps[3] = "W"
    gps[4] = (122.0, 25.0, 43.21)
    gps[5] = 0                     # GPSAltitudeRef is a single BYTE, not a rational

    img.save(OUT_IMG, "JPEG", quality=88, exif=exif.tobytes(), optimize=False)

    raw = open(OUT_IMG, "rb").read()
    meta = {
        "marker": MARKER,
        "path": OUT_IMG,
        "bytes": len(raw),
        "sha256": __import__("hashlib").sha256(raw).hexdigest(),
        "dimensions": [W, H],
        "format": "JPEG",
        "quality": 88,
        "has_gps": True,
        "note": "Unique per generation. Published alongside the report so the "
                "measurement can be reproduced by anyone with the script.",
    }

    # Sanity check: the marker must really be inside the bytes we ship.
    assert MARKER.encode("ascii") in raw, "marker missing from generated JPEG"
    assert raw[:2] == b"\xff\xd8", "not a JPEG"

    with io.open(OUT_META, "w", encoding="utf-8", newline="") as fh:
        fh.write(json.dumps(meta, indent=2) + "\n")

    print("marker :", MARKER)
    print("bytes  :", len(raw))
    print("sha256 :", meta["sha256"])
    print("meta   :", OUT_META)


if __name__ == "__main__":
    main()
