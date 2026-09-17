"""Render the PNG icons from the same design as icons/favicon.svg.

Home-screen icons have to be PNG - iOS ignores an SVG favicon, and the web
manifest wants fixed sizes. The output is committed, so the app itself never
needs Pillow; this is a build tool, not a runtime dependency.

Run it only if you want a different character on your icon:

    pip install pillow
    python3 tools/make_icons.py --letter B

Then hard-refresh, or remove and re-add the home-screen shortcut - phones cache
these aggressively.
"""

import argparse
import os

from PIL import Image, ImageDraw, ImageFont

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(BASE_DIR, "icons")

TOP = (36, 38, 46)
BOTTOM = (16, 18, 22)
HINGE = (11, 12, 15)
AMBER = (216, 162, 74)

# Every output: (filename, pixel size, how much of the square the art fills).
# A maskable icon has to survive being cropped to a circle, so its artwork is
# inset to the safe zone rather than running to the edges.
OUTPUTS = [
    ("apple-touch-icon.png", 180, 1.0),
    ("icon-192.png", 192, 1.0),
    ("icon-512.png", 512, 1.0),
    ("icon-512-maskable.png", 512, 0.8),
]

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    raise SystemExit("No usable bold font found; add one to FONT_CANDIDATES.")


def render(size, letter, fill):
    """One tile: dark case, lighter upper half, hinge across the middle."""
    img = Image.new("RGB", (size, size), BOTTOM)
    draw = ImageDraw.Draw(img)

    art = int(size * fill)
    pad = (size - art) // 2
    mid = pad + art // 2

    draw.rectangle([pad, pad, pad + art, mid], fill=TOP)
    draw.rectangle([pad, mid, pad + art, pad + art], fill=BOTTOM)

    font = load_font(int(art * 0.72))
    box = draw.textbbox((0, 0), letter, font=font)
    draw.text(
        (pad + (art - (box[2] - box[0])) / 2 - box[0],
         pad + (art - (box[3] - box[1])) / 2 - box[1]),
        letter,
        font=font,
        fill=AMBER,
    )

    # Hinge last, so it cuts across the glyph exactly as the CSS flap does.
    hinge = max(2, size // 90)
    draw.rectangle([pad, mid - hinge, pad + art, mid + hinge // 2], fill=HINGE)
    return img


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--letter", default="0", help="the character on the tile (default: 0)")
    args = parser.parse_args()

    os.makedirs(ICON_DIR, exist_ok=True)
    for name, size, fill in OUTPUTS:
        path = os.path.join(ICON_DIR, name)
        render(size, args.letter[:1], fill).save(path)
        print(f"wrote {path} ({size}x{size})")

    print("\nIf you changed the character, update icons/favicon.svg to match.")


if __name__ == "__main__":
    main()
