"""Build clean character artwork from the approved HQ mockup (design/approved-hq-mockup.png).

Crops each character card inside its border, removes the baked-in UI text (names, roles, status, chevrons)
by inpainting, and writes optimised WebP files to app/assets/agents/. Live UI text is drawn over the
cleared areas by the app. Requires: pip install pillow opencv-python-headless (build-time only).
Usage: python3 tools/make-agent-art.py [path/to/mockup.png]
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "design" / "approved-hq-mockup.png"
OUT = ROOT / "public" / "assets" / "agents"

# Card interiors in the 941 x 1672 mockup (inset from the rounded cyan borders).
CARDS = {
    "vektor": (16, 128, 925, 711),
    "quill": (16, 744, 454, 1439),
    "prism": (479, 744, 925, 1439),
}
# Baked UI text to remove, in mockup coordinates: (box, mode). "bright" masks only light text pixels
# (dark backgrounds); "box" masks the whole rectangle (text over detailed metal).
TEXT = {
    "vektor": [((44, 186, 380, 348), "bright"), ((872, 632, 908, 676), "bright")],
    "quill": [((32, 1276, 214, 1418), "bright"), ((402, 1346, 440, 1394), "bright")],
    "prism": [((504, 1276, 790, 1418), "box"), ((876, 1346, 914, 1394), "box")],
}


def clean(img, name):
    x0, y0, x1, y1 = CARDS[name]
    crop = img[y0:y1, x0:x1].copy()
    mask = np.zeros(crop.shape[:2], np.uint8)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    for (bx0, by0, bx1, by1), mode in TEXT[name]:
        sl = (slice(by0 - y0, by1 - y0), slice(bx0 - x0, bx1 - x0))
        if mode == "box":
            mask[sl] = 255
        else:
            v = hsv[..., 2][sl]
            s = hsv[..., 1][sl]
            mask[sl] = np.where((v > 95) | ((s > 120) & (v > 70)), 255, 0).astype(np.uint8)
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=2)
    return cv2.inpaint(crop, mask, 9, cv2.INPAINT_TELEA)


def main():
    img = cv2.imread(str(SRC))
    if img is None or img.shape[:2] != (1672, 941):
        sys.exit(f"Expected the 941 x 1672 approved mockup at {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)
    for name in CARDS:
        out = clean(img, name)
        rgb = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
        path = OUT / f"{name}.webp"
        rgb.save(path, "WEBP", quality=84, method=6)
        print(f"{path.relative_to(ROOT)}: {rgb.size[0]}x{rgb.size[1]}, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
