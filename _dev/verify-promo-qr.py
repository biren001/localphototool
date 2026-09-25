"""Prove the promo QR survives what WeChat does to an uploaded image.

WeChat re-encodes everything posted to Moments as JPEG and downsizes it, which
softens module edges. A QR code that scans perfectly on this PC but not after
that treatment is useless, so every poster is decoded again after being pushed
through the same pipeline (JPEG + downscale).
"""

import io
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PROMO = os.path.join(ROOT, "promo")
EXPECT = "https://localphototool.com/"

detector = cv2.QRCodeDetector()
results = []


def decode(img, label, expect=EXPECT):
    arr = np.array(img.convert("RGB"))[:, :, ::-1].copy()
    text, _, _ = detector.detectAndDecode(arr)
    good = text.strip() == expect
    results.append(good)
    mark = "PASS" if good else "FAIL"
    print(f"  [{mark}] {label:<44} -> {text.strip() or '(nothing decoded)'}")
    return good


print("\nQR code scan-survival check\n")

# 1. the raw asset
decode(Image.open(os.path.join(PROMO, "qr-code.png")), "qr-code.png (480px, as generated)")
decode(Image.open(os.path.join(PROMO, "qr-code-1024.png")), "qr-code-1024.png (standalone)")

# 2. the posters, untouched
for name in ("poster-cn.png", "poster-en.png"):
    decode(Image.open(os.path.join(PROMO, name)), name + " (lossless PNG)")

# 3. the posters after a WeChat-style pass: JPEG q75, redrawn at common sizes
for name in ("poster-cn.png", "poster-en.png"):
    src = Image.open(os.path.join(PROMO, name)).convert("RGB")
    for width, quality in ((1080, 75), (900, 70), (720, 65), (540, 60)):
        scaled = src.resize((width, round(src.height * width / src.width)), Image.LANCZOS)
        buf = io.BytesIO()
        scaled.save(buf, "JPEG", quality=quality, optimize=True)
        buf.seek(0)
        decode(
            Image.open(buf),
            f"{name} → JPEG q{quality} @ {width}px",
        )

# 4. a picture that has been forwarded and re-compressed a few times
for name in ("poster-cn.png",):
    src = Image.open(os.path.join(PROMO, name)).convert("RGB")
    for width, quality in ((600, 60), (480, 55)):
        scaled = src.resize((width, round(src.height * width / src.width)), Image.LANCZOS)
        buf = io.BytesIO()
        scaled.save(buf, "JPEG", quality=quality, optimize=True)
        buf.seek(0)
        decode(Image.open(buf), f"{name} → re-shared, JPEG q{quality} @ {width}px")

# 5. the previews the share page actually displays. These are a downscaled
#    WebP rather than the print PNG, so "the print file scans" is not the same
#    claim — this is the one a visitor points a camera at.
SHARE = os.path.join(ROOT, "localphototool", "share")
for name in ("poster-cn-preview.webp", "poster-en-preview.webp"):
    path = os.path.join(SHARE, name)
    if not os.path.exists(path):
        results.append(False)
        print(f"  [FAIL] {name:<44} -> missing; run _dev/gen-poster-previews.py")
    else:
        decode(Image.open(path), name + " (the displayed preview)")

passed = sum(1 for r in results if r)
print(f"\n{passed}/{len(results)} decodes returned {EXPECT}")
print("All good." if passed == len(results) else "SOME VARIANTS FAILED - enlarge the QR or raise contrast.")
raise SystemExit(0 if passed == len(results) else 1)
