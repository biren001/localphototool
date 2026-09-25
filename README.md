# LocalPhotoTool

**Compress images in your browser — nothing is uploaded**

Free image compressor that runs in your browser. Nothing is uploaded — HEIC, JPEG, PNG, WebP and AVIF are processed on your own device, in batches.

**Live: https://localphototool.com**

## Why this one is different

Most image compressors upload your photos to a server and send them back. LocalPhotoTool has no server to upload to: decoding and re-encoding run in your browser via WebAssembly builds of MozJPEG, libheif (iPhone HEIC) and AVIF, so a file cannot leave your device even by accident.

"Your files are deleted after an hour" is a promise. This is a property — there is no upload endpoint in the codebase to delete files from.

## What it does

- Compresses JPEG, PNG, WebP and AVIF, and converts between them
- Reads iPhone HEIC files, decoded locally rather than through a CDN build
- **Auto mode** measures each image and picks the lowest quality that still clears a ~40 dB fidelity floor, instead of applying one preset to everything
- Can target an exact size, e.g. get a photo under 100 KB
- Batch processing with ZIP export on desktop; the mobile version withholds ZIP on iOS on purpose, because the Files app does not unpack archives into the photo library
- EXIF and GPS stripped, with camera orientation applied to the pixels first so portrait photos stay upright
- Installable as a PWA and works offline
- Free, no account, no watermark, no file-count limit

## Measured, not claimed

The figures on the site are reproducible from the measurement scripts, not copied from a comparison table:

| Case | Result |
| --- | --- |
| Camera JPEG to WebP, Auto mode | 24–54% smaller |
| Camera JPEG to AVIF, Auto mode | 41–68% smaller |
| An already-optimised photo | returned unchanged rather than re-compressed larger |

Auto mode aims at ~40 dB PSNR. That floor is why an already-optimised photo comes back unchanged: there is no quality left to give without dropping below it.

## Privacy

- No upload endpoint, no cookies, no third-party analytics or fonts
- The only server-side component is an aggregate daily-unique visit counter that stores a salted hash and nothing else — no IP, no user agent, no per-file data
- Blocking all network requests after the page loads still leaves the tool working
