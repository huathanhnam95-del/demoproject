"""
Generate survival-mode power-up and upgrade icons with provider fallback order:
1) Nano Banana Pro
2) Vertex AI (Gemini image endpoint)
3) Imagen (Vertex predict endpoint)
4) Local deterministic placeholder as final fallback

Usage:
  python scripts/generate_survival_icons.py
  python scripts/generate_survival_icons.py --id freeze
  python scripts/generate_survival_icons.py --overwrite
"""

from __future__ import annotations

import argparse
import base64
import os
import time
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional

import requests
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_ROOT = ROOT / "public" / "assets" / "survival-icons"
POWERUPS_DIR = OUT_ROOT / "powerups"
UPGRADES_DIR = OUT_ROOT / "upgrades"
UI_DIR = OUT_ROOT / "ui"

for folder in (POWERUPS_DIR, UPGRADES_DIR, UI_DIR):
    folder.mkdir(parents=True, exist_ok=True)


STYLE_PREFIX = (
    "Game icon, transparent background, centered single subject, no text, no border, "
    "high-contrast stylized hand-painted action icon, consistent cohesive set, "
    "subtle ink/line accents, readable at 46x46."
)


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return default


NANO_KEY = _env("NANO_BANANA_PRO_API_KEY", "NANO_BANANA_API_KEY", default="AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg")
NANO_ENDPOINT = _env(
    "NANO_BANANA_PRO_ENDPOINT",
    "NANO_BANANA_ENDPOINT",
    default="https://api.nanobanana.pro/v1/images/generate",
)

# These are already present in local helper scripts; keep env override first.
VERTEX_KEY = _env("VERTEX_AI_API_KEY", "GOOGLE_VERTEX_API_KEY", default="AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg")
VERTEX_GEMINI_MODEL = _env("VERTEX_GEMINI_IMAGE_MODEL", default="gemini-2.5-flash-image")
VERTEX_PROJECT_ID = _env("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", default="gen-lang-client-0677756745")
IMAGEN_MODELS = [
    _env("VERTEX_IMAGEN_MODEL", default="imagen-4.0-generate-preview-06-06"),
    "imagen-3.0-generate-001",
]

REQUEST_TIMEOUT = 55


@dataclass
class IconSpec:
    id: str
    category: str  # powerups | upgrades | ui
    prompt: str
    symbol: str

    @property
    def output_path(self) -> Path:
        if self.category == "powerups":
            return POWERUPS_DIR / f"{self.id}.png"
        if self.category == "upgrades":
            return UPGRADES_DIR / f"{self.id}.png"
        return UI_DIR / f"{self.id}.png"


POWERUP_SPECS: List[IconSpec] = [
    IconSpec("loot", "powerups", "Treasure cache chest with arcane glow and small reward sparks.", "L"),
    IconSpec("shield", "powerups", "Energy shield crest with protective arc and spark impact.", "S"),
    IconSpec("freeze", "powerups", "Runed stopwatch frozen in ice with time-stop particles.", "F"),
    IconSpec("double_damage", "powerups", "Crossed blazing projectiles with red damage burst.", "D"),
    IconSpec("reroll", "powerups", "Looping reroll arrows around a glowing dice core.", "R"),
    IconSpec("health", "powerups", "Medical cross medallion with warm restoration glow.", "H"),
]


UPGRADE_SPECS: List[IconSpec] = [
    IconSpec("dmg_boost", "upgrades", "Overclocked impact core with bursting shards.", "DMG"),
    IconSpec("fire_rate", "upgrades", "Rapid-fire barrel ring with speed streaks.", "ROF"),
    IconSpec("multishot", "upgrades", "Three projectiles fanning outward in a split stream.", "3X"),
    IconSpec("pierce", "upgrades", "Needle projectile tunneling through layered plates.", "P"),
    IconSpec("speed", "upgrades", "High-speed round with aerodynamic wake trail.", "SPD"),
    IconSpec("drone_count", "upgrades", "Orbiting drone swarm with linked triangle paths.", "DRN"),
    IconSpec("drone_orbit", "upgrades", "Drone satellite ring with accelerated orbit arcs.", "ORB"),
    IconSpec("drone_damage", "upgrades", "Drone payload core with explosive spark burst.", "D+"),
    IconSpec("mine_capacity", "upgrades", "Mine rack with multiple armed capsules.", "M+"),
    IconSpec("mine_damage", "upgrades", "Charged mine detonation with shockwave bloom.", "MD"),
    IconSpec("mine_trigger", "upgrades", "Proximity lattice ring sensing intrusion.", "TRG"),
    IconSpec("broadcaster", "upgrades", "Spread-shot emitter with cone wave broadcast.", "BR"),
    IconSpec("heat_ray", "upgrades", "Focused heat beam lens with molten core.", "HR"),
    IconSpec("minefield", "upgrades", "Deployed minefield pattern across tactical grid.", "MF"),
    IconSpec("sentry", "upgrades", "Autonomous turret node scanning nearby targets.", "SE"),
    IconSpec("spectre", "upgrades", "Mobile spectre drones with ghost trails.", "SP"),
    IconSpec("tesla_mines", "upgrades", "Tesla mine pod with electric arcs between nodes.", "TM"),
    IconSpec("repeater_cryo", "upgrades", "Cryo repeater muzzle with frost projectile trail.", "CR"),
    IconSpec("heat_ray_reflector", "upgrades", "Heat ray ricochet reflecting off panel wall.", "RF"),
    IconSpec("loot_heat_damage", "upgrades", "Heat damage sigil with thermal flare.", "LH"),
    IconSpec("loot_dot_damage", "upgrades", "Damage-over-time ember chain burning steadily.", "LD"),
    IconSpec("loot_turret_clock", "upgrades", "Turret clockwork reducing cooldown interval.", "TC"),
    IconSpec("loot_freeze_weight", "upgrades", "Weighted freeze token increasing drop odds.", "LF"),
    IconSpec("loot_shield_weight", "upgrades", "Weighted shield token increasing drop odds.", "LS"),
    IconSpec("loot_reroll_weight", "upgrades", "Weighted reroll token with loop arrows.", "LR"),
    IconSpec("loot_item_life", "upgrades", "Stasis wrapping preserving item lifetime.", "LI"),
    IconSpec("default", "upgrades", "Neutral augment emblem with modular circuitry.", "UP"),
]

UI_SPECS: List[IconSpec] = [
    IconSpec("levelup_prompt", "ui", "Upgrade terminal glyph indicating level-up available.", "LV"),
]


ALL_SPECS = POWERUP_SPECS + UPGRADE_SPECS + UI_SPECS


def decode_b64_image(b64_data: str) -> Optional[Image.Image]:
    if not b64_data:
        return None
    try:
        raw = base64.b64decode(b64_data)
        return Image.open(BytesIO(raw)).convert("RGBA")
    except Exception:
        return None


def extract_image_from_json(payload: Dict) -> Optional[Image.Image]:
    # Nano Banana style variants
    if isinstance(payload, dict):
        if "image_base64" in payload:
            img = decode_b64_image(payload.get("image_base64", ""))
            if img:
                return img
        data = payload.get("data")
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                img = decode_b64_image(first.get("b64_json", ""))
                if img:
                    return img
                img = decode_b64_image(first.get("image_base64", ""))
                if img:
                    return img
        output = payload.get("output")
        if isinstance(output, list) and output:
            first = output[0]
            if isinstance(first, dict):
                img = decode_b64_image(first.get("b64", ""))
                if img:
                    return img
        # Vertex/Google inlineData style
        candidates = payload.get("candidates")
        if isinstance(candidates, list) and candidates:
            content = candidates[0].get("content", {})
            parts = content.get("parts", [])
            for part in parts:
                inline = part.get("inlineData", {})
                img = decode_b64_image(inline.get("data", ""))
                if img:
                    return img
        # Imagen predict style
        predictions = payload.get("predictions")
        if isinstance(predictions, list) and predictions:
            first = predictions[0]
            if isinstance(first, dict):
                img = decode_b64_image(first.get("bytesBase64Encoded", ""))
                if img:
                    return img
    return None


def remove_white_background(img: Image.Image, threshold: int = 242) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            if r >= threshold and g >= threshold and b >= threshold:
                px[x, y] = (255, 255, 255, 0)
    return rgba


def normalize_icon(img: Image.Image, size: int = 256) -> Image.Image:
    icon = remove_white_background(img)
    if icon.size != (size, size):
        icon = icon.resize((size, size), Image.LANCZOS)
    return icon


def provider_nanobanana(prompt: str) -> Optional[Image.Image]:
    if not NANO_KEY:
        return None
    headers = {
        "Authorization": f"Bearer {NANO_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "prompt": prompt,
        "size": "512x512",
        "transparent_background": True,
        "response_format": "b64_json",
    }
    try:
        resp = requests.post(NANO_ENDPOINT, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
        if resp.status_code >= 400:
            return None
        return extract_image_from_json(resp.json())
    except Exception:
        return None


def provider_vertex_gemini(prompt: str) -> Optional[Image.Image]:
    if not VERTEX_KEY:
        return None
    
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    }
    
    global_url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{VERTEX_GEMINI_MODEL}:generateContent?key={VERTEX_KEY}"
    project_url = (
        f"https://us-central1-aiplatform.googleapis.com/v1/projects/{VERTEX_PROJECT_ID}"
        f"/locations/us-central1/publishers/google/models/{VERTEX_GEMINI_MODEL}:generateContent?key={VERTEX_KEY}"
    )

    for url in (global_url, project_url):
        try:
            resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
            if resp.status_code < 400:
                img = extract_image_from_json(resp.json())
                if img: return img
            else:
                print(f"    Vertex/Gemini Failed ({resp.status_code}) at {url}")
        except Exception as e:
            print(f"    Vertex/Gemini Error: {e}")
            continue
    return None


def provider_imagen(prompt: str) -> Optional[Image.Image]:
    if not VERTEX_KEY:
        return None
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1}
    }
    tried = set()

    for model in IMAGEN_MODELS:
        if not model:
            continue

        global_url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:predict?key={VERTEX_KEY}"
        project_url = (
            f"https://us-central1-aiplatform.googleapis.com/v1/projects/{VERTEX_PROJECT_ID}"
            f"/locations/us-central1/publishers/google/models/{model}:predict?key={VERTEX_KEY}"
        )

        for url in (global_url, project_url):
            if url in tried:
                continue
            tried.add(url)
            try:
                resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
                if resp.status_code >= 400:
                    continue
                image = extract_image_from_json(resp.json())
                if image is not None:
                    return image
            except Exception:
                continue
    return None


def local_placeholder(spec: IconSpec) -> Image.Image:
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    outer = (18, 18, size - 18, size - 18)
    inner = (36, 36, size - 36, size - 36)
    accent = (178, 76, 76, 235)
    stroke = (47, 47, 47, 230)
    muted = (247, 246, 242, 200)

    draw.rounded_rectangle(outer, radius=42, fill=muted, outline=stroke, width=6)
    draw.rounded_rectangle(inner, radius=30, outline=accent, width=5)

    # Center symbol as deterministic fallback mark.
    symbol = (spec.symbol or spec.id[:2] or "?").upper()
    text = symbol[:4]
    tw = 14 * len(text)
    tx = (size - tw) / 2
    ty = size / 2 - 14
    draw.text((tx, ty), text, fill=stroke)
    return img


def build_prompt(spec: IconSpec) -> str:
    # Reference details come from the scraped guide (freeze stopwatch, shield crest, loot cache, etc.).
    return f"{STYLE_PREFIX} {spec.prompt}"


def generate_icon(spec: IconSpec, overwrite: bool = False) -> str:
    out = spec.output_path
    if out.exists() and not overwrite:
        return "skip"

    prompt = build_prompt(spec)

    # Requested fallback order.
    image = provider_nanobanana(prompt)
    if image is not None:
        normalize_icon(image).save(out)
        return "nano"

    image = provider_vertex_gemini(prompt)
    if image is not None:
        normalize_icon(image).save(out)
        return "vertex"

    image = provider_imagen(prompt)
    if image is not None:
        normalize_icon(image).save(out)
        return "imagen"

    local_placeholder(spec).save(out)
    return "local"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", type=str, default="", help="Generate one icon by id")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate existing files")
    parser.add_argument("--delay", type=float, default=0.8, help="Delay seconds between generations")
    args = parser.parse_args()

    wanted = args.id.strip().lower()
    specs = [s for s in ALL_SPECS if (not wanted or s.id == wanted)]
    if not specs:
        print(f"No icon spec found for id={wanted!r}")
        return 1

    stats = {"skip": 0, "nano": 0, "vertex": 0, "imagen": 0, "local": 0}
    for spec in specs:
        source = generate_icon(spec, overwrite=args.overwrite)
        stats[source] = stats.get(source, 0) + 1
        print(f"{spec.id:<24} -> {source:>6}  ({spec.output_path.as_posix()})")
        time.sleep(max(0, args.delay))

    print("\nSummary:")
    for key in ("nano", "vertex", "imagen", "local", "skip"):
        print(f"  {key:>6}: {stats.get(key, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
