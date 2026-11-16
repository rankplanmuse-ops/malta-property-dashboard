#!/usr/bin/env python3
"""Generate PWA icons for the standalone Malta Property Dashboard.
Draws the app's house mark (same geometry as the header inline SVG, 24x24
viewBox) as a white outline on the brand dark tile (#14181d)."""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DARK = (20, 24, 29, 255)
WHITE = (255, 255, 255, 255)

ROOF = [(3, 11), (12, 4), (21, 11)]
WALLS = [(5.5, 9.5), (5.5, 20), (18.5, 20), (18.5, 9.5)]
DOOR = [(10, 20), (10, 14), (14, 14), (14, 20)]
STROKE = 1.8  # viewBox units, matches the header SVG


def render(size, house_frac):
    ss = 4  # supersample
    S = size * ss
    img = Image.new("RGBA", (S, S), DARK)
    d = ImageDraw.Draw(img)
    box = 24.0
    span = S * house_frac
    off = (S - span) / 2
    scale = span / box

    def pt(p):
        return (off + p[0] * scale, off + p[1] * scale)

    w = max(2, int(STROKE * scale))
    for path in (ROOF, WALLS, DOOR):
        d.line([pt(p) for p in path], fill=WHITE, width=w, joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def main():
    jobs = [
        ("icon-192.png", 192, 0.76),
        ("icon-512.png", 512, 0.76),
        ("icon-maskable-512.png", 512, 0.58),
        ("icon-180.png", 180, 0.76),
    ]
    for name, size, frac in jobs:
        out = os.path.join(ROOT, name)
        render(size, frac).save(out)
        print("wrote", out, size)


if __name__ == "__main__":
    main()
