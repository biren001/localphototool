"""Generate the scannable QR code for localphototool.com.

High error correction + a generous quiet zone, because WeChat re-compresses
every image uploaded to Moments and a tight QR code is the first thing to
stop scanning after that.
"""

import io
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_H

URL = "https://localphototool.com/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "promo")
OUT = os.path.abspath(OUT)


def make(size, border, path):
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=size,
        border=border,
    )
    qr.add_data(URL)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0f172a", back_color="white").convert("RGB")
    img.save(path)
    return img.size


def main():
    os.makedirs(OUT, exist_ok=True)

    # Poster asset: big, crisp, kept lossless.
    big = make(size=16, border=4, path=os.path.join(OUT, "qr-code-1024.png"))

    # Standalone: white background, ready to drop anywhere.
    make(size=12, border=4, path=os.path.join(OUT, "qr-code.png"))

    print("qr-code-1024.png ->", big[0], "x", big[1])
    print("qr-code.png      -> 480 x 480")
    print("url:", URL)


if __name__ == "__main__":
    main()
