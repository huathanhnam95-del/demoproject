from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "skill-icons"


@dataclass(frozen=True)
class IconSpec:
    skill_id: str
    title: str


SKILLS = [
    IconSpec("slow_audio", "Slow Audio"),
    IconSpec("hint_reveal", "Hint Reveal"),
]


def _soft_shadow(img: Image.Image, offset: tuple[int, int] = (0, 6), blur: int = 8, alpha: int = 140) -> Image.Image:
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    mask = img.split()[-1]
    shadow.paste((0, 0, 0, alpha), (0, 0), mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    shadow = ImageChops.offset(shadow, offset[0], offset[1])
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(shadow)
    out.alpha_composite(img)
    return out


def _draw_hourglass_pixel() -> Image.Image:
    # Base pixel art at 32x32, then upscale.
    w = h = 32
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    outline = (34, 24, 16, 255)
    gold = (186, 140, 62, 255)
    gold_hi = (230, 200, 120, 255)
    glass = (120, 200, 255, 120)
    sand = (90, 170, 255, 255)
    sand_hi = (180, 230, 255, 255)
    shadow = (0, 0, 0, 90)

    # Shadow
    d.ellipse((8, 26, 24, 30), fill=shadow)

    # Frame outline
    d.rectangle((10, 5, 21, 26), outline=outline, width=1)
    d.rectangle((8, 4, 23, 7), outline=outline, width=1, fill=gold)
    d.rectangle((8, 24, 23, 27), outline=outline, width=1, fill=gold)

    # Inner glass
    d.polygon([(11, 8), (20, 8), (17, 14), (14, 14)], fill=glass)
    d.polygon([(14, 16), (17, 16), (20, 22), (11, 22)], fill=glass)

    # Sand top + bottom
    d.polygon([(12, 9), (19, 9), (16, 13), (15, 13)], fill=sand)
    d.rectangle((12, 20, 19, 22), fill=sand)
    d.point((16, 15), fill=sand_hi)

    # Rune pixels
    d.point((9, 6), fill=gold_hi)
    d.point((22, 25), fill=gold_hi)
    d.point((16, 6), fill=gold_hi)

    # Highlight edge
    d.line((9, 5, 9, 25), fill=gold_hi, width=1)

    return img.resize((128, 128), resample=Image.Resampling.NEAREST)


def _draw_book_pixel() -> Image.Image:
    w = h = 32
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    outline = (28, 18, 12, 255)
    leather = (120, 52, 36, 255)
    leather_hi = (170, 90, 60, 255)
    clasp = (170, 140, 70, 255)
    glow = (255, 220, 120, 200)
    glow2 = (255, 245, 200, 200)
    shadow = (0, 0, 0, 90)

    d.ellipse((8, 26, 24, 30), fill=shadow)

    # Book body
    d.rounded_rectangle((7, 6, 24, 24), radius=2, outline=outline, fill=leather, width=1)
    d.line((9, 7, 9, 23), fill=leather_hi, width=1)  # spine highlight

    # Clasp
    d.rectangle((23, 12, 26, 18), outline=outline, fill=clasp, width=1)
    d.point((24, 15), fill=(255, 255, 210, 255))

    # Crack glow
    d.polygon([(10, 10), (14, 12), (12, 16), (16, 18), (12, 20)], fill=glow)
    d.point((13, 16), fill=glow2)

    # Rune glyph
    d.point((16, 12), fill=glow2)
    d.point((15, 13), fill=glow2)
    d.point((17, 13), fill=glow2)

    return img.resize((128, 128), resample=Image.Resampling.NEAREST)


def _draw_hourglass_runescape() -> Image.Image:
    size = 128
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Slightly skewed hourglass with chunky shading.
    outline = (18, 12, 10, 255)
    gold_dark = (122, 85, 36, 255)
    gold = (192, 140, 62, 255)
    gold_hi = (245, 220, 150, 255)
    blue = (70, 170, 255, 210)
    blue_hi = (170, 230, 255, 220)

    # Shadow
    d.ellipse((26, 94, 102, 114), fill=(0, 0, 0, 90))

    # Frame
    d.rounded_rectangle((32, 18, 96, 32), radius=10, outline=outline, fill=gold, width=4)
    d.rounded_rectangle((28, 92, 92, 106), radius=10, outline=outline, fill=gold, width=4)
    d.rounded_rectangle((40, 30, 88, 96), radius=26, outline=outline, fill=(255, 255, 255, 0), width=4)

    # Glass core
    d.polygon([(44, 36), (84, 36), (70, 58), (58, 58)], fill=(140, 220, 255, 90))
    d.polygon([(58, 66), (70, 66), (84, 88), (44, 88)], fill=(140, 220, 255, 90))

    # Sand
    d.polygon([(48, 38), (80, 38), (66, 56), (62, 56)], fill=blue)
    d.rectangle((48, 80, 80, 88), fill=blue)
    d.ellipse((61, 60, 69, 68), fill=blue_hi)

    # Highlights
    d.arc((26, 12, 104, 40), 200, 330, fill=gold_hi, width=3)
    d.arc((22, 86, 100, 114), 20, 140, fill=gold_hi, width=3)

    # Rune marks
    d.ellipse((46, 22, 54, 30), outline=gold_hi, width=2)
    d.line((50, 24, 50, 28), fill=gold_hi, width=2)

    return _soft_shadow(img, offset=(0, 4), blur=10, alpha=120)


def _draw_book_runescape() -> Image.Image:
    size = 128
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    outline = (18, 12, 10, 255)
    leather = (116, 48, 34, 255)
    leather_dark = (84, 34, 24, 255)
    leather_hi = (176, 88, 58, 255)
    brass = (190, 150, 70, 255)
    glow = (255, 210, 120, 210)

    d.ellipse((26, 96, 104, 116), fill=(0, 0, 0, 90))

    # Book with perspective
    d.polygon([(28, 28), (94, 22), (104, 84), (38, 92)], fill=leather, outline=outline, width=4)
    d.polygon([(28, 28), (38, 92), (30, 96), (20, 32)], fill=leather_dark, outline=outline, width=4)
    d.line((34, 32, 44, 90), fill=leather_hi, width=3)

    # Clasp
    d.polygon([(86, 46), (98, 44), (100, 62), (88, 64)], fill=brass, outline=outline, width=3)
    d.ellipse((92, 52, 96, 56), fill=(255, 245, 210, 255))

    # Glow crack
    d.line((44, 40, 70, 70), fill=glow, width=6)
    d.line((58, 46, 52, 68), fill=glow, width=4)
    d.ellipse((56, 54, 62, 60), fill=(255, 245, 210, 255))

    return _soft_shadow(img, offset=(0, 5), blur=10, alpha=120)


def _painted_background(size: int, hue: str) -> Image.Image:
    # Simple painterly radial gradient with noise.
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cx = cy = size / 2
    pix = base.load()
    if hue == "blue":
        inner = (120, 200, 255)
        outer = (20, 40, 80)
    else:
        inner = (255, 220, 140)
        outer = (70, 30, 20)

    for y in range(size):
        for x in range(size):
            dx = (x - cx) / size
            dy = (y - cy) / size
            r = math.sqrt(dx * dx + dy * dy)
            t = min(1.0, max(0.0, (r - 0.05) / 0.55))
            rr = int(inner[0] * (1 - t) + outer[0] * t)
            gg = int(inner[1] * (1 - t) + outer[1] * t)
            bb = int(inner[2] * (1 - t) + outer[2] * t)
            n = random.randint(-8, 8)
            alpha = int(220 * (1 - min(1.0, r / 0.7)))
            pix[x, y] = (max(0, min(255, rr + n)), max(0, min(255, gg + n)), max(0, min(255, bb + n)), max(0, min(255, alpha)))
    return base.filter(ImageFilter.GaussianBlur(1.5))


def _draw_hourglass_painted() -> Image.Image:
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.alpha_composite(_painted_background(size, "blue"))
    d = ImageDraw.Draw(img)

    outline = (20, 12, 10, 255)
    gold1 = (214, 170, 80, 255)
    gold2 = (130, 92, 40, 255)
    glass = (160, 230, 255, 70)
    sand = (90, 180, 255, 210)
    glow = (120, 220, 255, 140)

    # Frame (painted bands)
    d.rounded_rectangle((70, 34, 186, 62), radius=18, outline=outline, fill=gold1, width=6)
    d.rounded_rectangle((66, 190, 182, 218), radius=18, outline=outline, fill=gold1, width=6)
    d.rounded_rectangle((92, 56, 170, 196), radius=42, outline=outline, fill=(0, 0, 0, 0), width=6)

    # Shadows / depth
    d.arc((56, 22, 200, 84), 210, 340, fill=gold2, width=8)
    d.arc((52, 178, 196, 240), 20, 140, fill=gold2, width=8)

    # Glass
    d.polygon([(104, 74), (156, 74), (138, 110), (122, 110)], fill=glass)
    d.polygon([(122, 130), (138, 130), (156, 168), (104, 168)], fill=glass)

    # Sand + glow
    d.polygon([(110, 78), (150, 78), (134, 108), (126, 108)], fill=sand)
    d.rectangle((110, 154, 150, 168), fill=sand)
    d.ellipse((122, 114, 138, 130), fill=glow)

    # Rune etchings
    d.line((86, 48, 96, 52), fill=(255, 240, 200, 180), width=3)
    d.line((88, 54, 98, 58), fill=(255, 240, 200, 180), width=3)

    img = _soft_shadow(img, offset=(0, 8), blur=16, alpha=120)
    return img.resize((128, 128), resample=Image.Resampling.LANCZOS)


def _draw_book_painted() -> Image.Image:
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.alpha_composite(_painted_background(size, "warm"))
    d = ImageDraw.Draw(img)

    outline = (20, 12, 10, 255)
    leather = (120, 54, 38, 255)
    leather2 = (80, 34, 24, 255)
    brass = (210, 170, 80, 255)
    glow = (255, 220, 140, 200)

    # Book perspective
    d.polygon([(58, 70), (188, 56), (206, 186), (76, 202)], fill=leather, outline=outline, width=6)
    d.polygon([(58, 70), (76, 202), (62, 210), (44, 78)], fill=leather2, outline=outline, width=6)

    # Clasp
    d.polygon([(164, 108), (190, 104), (194, 140), (168, 144)], fill=brass, outline=outline, width=5)
    d.ellipse((174, 120, 182, 128), fill=(255, 245, 210, 255))

    # Crack glow
    d.line((92, 94, 156, 162), fill=glow, width=14)
    d.line((124, 100, 110, 160), fill=(255, 245, 210, 200), width=10)
    d.ellipse((120, 122, 136, 138), fill=(255, 255, 240, 220))

    img = _soft_shadow(img, offset=(0, 10), blur=18, alpha=120)
    return img.resize((128, 128), resample=Image.Resampling.LANCZOS)


def _write_svg_hourglass(path: Path) -> None:
    svg = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F5DFA8"/>
      <stop offset="1" stop-color="#B57A2F"/>
    </linearGradient>
    <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B7ECFF"/>
      <stop offset="1" stop-color="#4AAEFF"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="28" y="18" width="72" height="16" rx="8" fill="url(#gold)" stroke="#1A0F0A" stroke-width="3"/>
    <rect x="28" y="94" width="72" height="16" rx="8" fill="url(#gold)" stroke="#1A0F0A" stroke-width="3"/>
    <rect x="40" y="30" width="48" height="72" rx="24" fill="none" stroke="#1A0F0A" stroke-width="3"/>
    <path d="M48 36h32l-12 20H60z" fill="rgba(140,220,255,0.25)"/>
    <path d="M60 70h8l12 18H48z" fill="rgba(140,220,255,0.25)"/>
    <path d="M50 38h28l-12 18h-4z" fill="url(#sand)"/>
    <rect x="50" y="82" width="28" height="10" rx="4" fill="url(#sand)"/>
    <circle cx="64" cy="64" r="4" fill="#E9FBFF"/>
    <path d="M36 26h10" stroke="#FFF2CF" stroke-width="3" stroke-linecap="round"/>
    <path d="M38 30h10" stroke="#FFF2CF" stroke-width="3" stroke-linecap="round"/>
  </g>
</svg>
"""
    path.write_text(svg, encoding="utf-8")


def _write_svg_book(path: Path) -> None:
    svg = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="leather" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#C56E4A"/>
      <stop offset="1" stop-color="#6B2A1C"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF1C8"/>
      <stop offset="1" stop-color="#F4B96A"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <path d="M28 34L92 28l10 64-64 10z" fill="url(#leather)" stroke="#1A0F0A" stroke-width="3" stroke-linejoin="round"/>
    <path d="M28 34l10 68-8 4-10-66z" fill="#4D1B12" stroke="#1A0F0A" stroke-width="3" stroke-linejoin="round"/>
    <path d="M82 50l16-2 2 22-16 2z" fill="#CFA44A" stroke="#1A0F0A" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="90" cy="61" r="3" fill="#FFF7E5"/>
    <path d="M46 46l30 34" stroke="url(#glow)" stroke-width="10" stroke-linecap="round"/>
    <path d="M58 50l-6 18" stroke="#FFF7E5" stroke-width="7" stroke-linecap="round"/>
    <circle cx="60" cy="64" r="5" fill="#FFFBEF"/>
  </g>
</svg>
"""
    path.write_text(svg, encoding="utf-8")


def main() -> None:
    (OUT / "pixel").mkdir(parents=True, exist_ok=True)
    (OUT / "painted").mkdir(parents=True, exist_ok=True)
    (OUT / "runescape").mkdir(parents=True, exist_ok=True)
    (OUT / "vector").mkdir(parents=True, exist_ok=True)

    # Deterministic-ish output for reproducibility.
    random.seed(1337)

    pixel_hourglass = _draw_hourglass_pixel()
    pixel_book = _draw_book_pixel()
    rs_hourglass = _draw_hourglass_runescape()
    rs_book = _draw_book_runescape()
    painted_hourglass = _draw_hourglass_painted()
    painted_book = _draw_book_painted()

    # Save PNGs
    pixel_hourglass.save(OUT / "pixel" / "slow_audio.png")
    pixel_book.save(OUT / "pixel" / "hint_reveal.png")
    rs_hourglass.save(OUT / "runescape" / "slow_audio.png")
    rs_book.save(OUT / "runescape" / "hint_reveal.png")
    painted_hourglass.save(OUT / "painted" / "slow_audio.png")
    painted_book.save(OUT / "painted" / "hint_reveal.png")

    # Save SVGs
    _write_svg_hourglass(OUT / "vector" / "slow_audio.svg")
    _write_svg_book(OUT / "vector" / "hint_reveal.svg")

    print("Generated placeholder icons in:", OUT)


if __name__ == "__main__":
    main()

