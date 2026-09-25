"""Derive the "camera JPEG" corpus from the pinned originals.

Why two profiles: "how much smaller will my photo get?" has two very different
honest answers depending on what you feed in, and a benchmark table that only
reports the flattering one is not worth citing.

    photo-N.jpg      already through a CMS / a chat app / an earlier
                     compression pass — 0.09-0.20 bytes per pixel
    photo-N-hq.jpg   the same pixels re-encoded at Q96 — stands in for a
                     straight-out-of-camera or phone JPEG, which is what most
                     people actually upload

The originals are pinned by sha256 in measure-compression-matrix.cjs. These are
derived deterministically from them, and the matrix prints the hash of every
file it measures, so a Pillow upgrade that changes the encoder shows up as a
changed hash instead of as a silent shift in the published numbers.

Run: python _dev/gen-corpus-hq.py
"""
import glob
import hashlib
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")


def digest(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:12]


def main():
    originals = sorted(glob.glob(os.path.join(CORPUS, "photo-[0-9].jpg")))
    if not originals:
        raise SystemExit("no photo-N.jpg in _dev/corpus — nothing to derive from")

    for src in originals:
        img = Image.open(src).convert("RGB")
        dst = src[:-4] + "-hq.jpg"
        img.save(dst, "JPEG", quality=96, subsampling=0, optimize=True)
        pixels = img.width * img.height
        for path in (src, dst):
            size = os.path.getsize(path)
            print(
                "  %-20s %7.0f KB  bpp=%.3f  sha=%s"
                % (os.path.basename(path), size / 1024, size / pixels, digest(path))
            )


if __name__ == "__main__":
    main()
