import os
import textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

SRC_DIR = r"c:\Cursor AI\assets\speaker_portraits"
OUT_DIR = r"c:\Cursor AI\assets\speaker_portraits\backgrounds_4k"
os.makedirs(OUT_DIR, exist_ok=True)

FONT_DIR = r"C:\Windows\Fonts"
FONT_GEORGIA_I = os.path.join(FONT_DIR, "georgiai.ttf")
FONT_GEORGIA_B = os.path.join(FONT_DIR, "georgiab.ttf")
FONT_GEORGIA = os.path.join(FONT_DIR, "georgia.ttf")
FONT_SEGOE_B = os.path.join(FONT_DIR, "segoeuib.ttf")
FONT_SEGOE = os.path.join(FONT_DIR, "segoeui.ttf")

# 8 Figures Data with tailored crops to center the speaker on the right half (X ≈ 2600-3000)
FIGURES = [
    {
        "filename": "quote_4k_chet_faliszek.png",
        "src_img": "chet_faliszek_test.jpg",
        "crop_box": (450, 0, 1500, 1080),  # Centers Chet, excludes bottom logo
        "eyebrow": "PRIMARY SOURCE WISDOM • KIWI TALKZ #135",
        "quote": "“Nobody tells you what to do. You see a problem, you go fix it. The people who thrive are the ones who don't wait for permission — they build the prototype and let data speak.”",
        "name": "Chet Faliszek",
        "role": "Writer & VR Lead • Left 4 Dead, Portal, Half-Life 2: Episode One & Two",
        "takeaway_label": ">> FLATLAND PRINCIPLE: ZERO-PERMISSION BIAS",
        "takeaway_text": "Never submit a proposal to an administrative review committee before building a prototype. In educational R&D, permission gates are bottlenecks disguised as diligence.",
        "accent": (217, 83, 79),      # Terracotta
        "accent_soft": (45, 26, 25),
    },
    {
        "filename": "quote_4k_josh_weier.png",
        "src_img": "josh_weier_clean.jpg",
        "crop_box": (500, 0, 1550, 1080),
        "eyebrow": "PRIMARY SOURCE WISDOM • KIWI TALKZ #126",
        "quote": "“At Valve, if you're working until 2 AM, nobody thinks you're a hero. They think the process failed. Sustainable creative teams guard their focus, recharge, and sleep.”",
        "name": "Josh Weier",
        "role": "Project Lead • Portal 2, Half-Life 2",
        "takeaway_label": ">> FLATLAND PRINCIPLE: SUSTAINABLE CADENCE & DEFENDING REST",
        "takeaway_text": "Without managers setting explicit boundaries, dedicated professionals burn out from unspoken guilt. Six hours of deep Cabal collaboration beats sixty hours of exhausted grinding.",
        "accent": (59, 130, 246),     # Slate blue
        "accent_soft": (20, 32, 48),
    },
    {
        "filename": "quote_4k_mike_morasky.png",
        "src_img": "mike_morasky_raw.png",
        "crop_box": (450, 100, 1500, 1080),  # Excludes top YouTube title banner
        "eyebrow": "PRIMARY SOURCE WISDOM • KIWI TALKZ #140",
        "quote": "“The Cabal wasn't a meeting. It was sitting in the same room where audio, design, and code fed into each other every 10 seconds. You don't write music in a silo — you compose as it plays.”",
        "name": "Mike Morasky",
        "role": "Audio Director & Composer • Portal 2, Team Fortress 2, Half-Life: Alyx",
        "takeaway_label": ">> FLATLAND PRINCIPLE: CLOSED-LOOP INTERDISCIPLINARY CO-CREATION",
        "takeaway_text": "Synthesize Kokoro phonemes in 2 minutes right alongside the curriculum designer at the shared workbench. Zero lag between pedagogical intent and auditory reality.",
        "accent": (245, 158, 11),     # Warm amber
        "accent_soft": (48, 36, 18),
    },
    {
        "filename": "quote_4k_erik_wolpaw.png",
        "src_img": "erik_wolpaw_clean.jpg",
        "crop_box": (500, 0, 1550, 1080),
        "eyebrow": "PRIMARY SOURCE WISDOM • KIWI TALKZ #133",
        "quote": "“Writing for games is about leaving your ego at the door. You write dialogue, watch a playtester in silence, and if it slows them down or confuses them, you cut it on the spot.”",
        "name": "Erik Wolpaw",
        "role": "Lead Writer • Portal 1 & 2, Psychonauts, Half-Life 2 Episodes",
        "takeaway_label": ">> FLATLAND PRINCIPLE: EGO-FREE PLAYTESTING & RADICAL PRUNING",
        "takeaway_text": "If an intonation drill or phonetic rule confuses learners during silent observation, cut or redesign it immediately without defensiveness or committee debates.",
        "accent": (34, 197, 94),      # Forest green
        "accent_soft": (20, 42, 28),
    },
    {
        "filename": "quote_4k_rich_geldreich.png",
        "src_img": "rich_geldreich.jpg",
        "crop_box": (450, 0, 1150, 720),
        "eyebrow": "PRIMARY SOURCE KEYNOTE • STEAM DEV DAYS & RETROSPECTIVE",
        "quote": "“Never turn colleagues into rivals for a fixed reward pool. Valve ranked peers against each other for compensation, unintentionally breeding cutthroat politics and risk aversion.”",
        "name": "Rich Geldreich",
        "role": "Senior Software Engineer • Valve Corporation (2009–2014)",
        "takeaway_label": ">> FLATLAND DEFENSE: SHARED OBJECTIVE OUTCOMES (ZERO STACK RANKING)",
        "takeaway_text": "100% team alignment around student pronunciation mastery. Zero internal peer competition for fixed bonus pools. When learners win, the whole team wins.",
        "accent": (239, 68, 68),      # Crimson red
        "accent_soft": (45, 20, 22),
    },
    {
        "filename": "quote_4k_jo_freeman.png",
        "src_img": "jo_freeman.jpg",
        "crop_box": (0, 0, 639, 707),
        "eyebrow": "ORGANIZATIONAL SOCIOLOGY • ARCHIVAL CANON (1972)",
        "quote": "“Removing formal hierarchy does not abolish power; it merely pushes power underground into unaccountable social cliques. Cliques form in the dark; radical transparency keeps Flatland flat.”",
        "name": "Jo Freeman",
        "role": "Political Scientist & Author • The Tyranny of Structurelessness",
        "takeaway_label": ">> FLATLAND DEFENSE: RADICAL TRANSPARENCY & THE OPEN BIBLE",
        "takeaway_text": "All major curriculum and engineering decisions are logged openly in the living Bible. Technical merit and empirical learner telemetry override social seniority.",
        "accent": (217, 83, 79),      # Terracotta
        "accent_soft": (45, 24, 23),
    },
    {
        "filename": "quote_4k_frederic_laloux.png",
        "src_img": "frederic_laloux_clean.jpg",
        "crop_box": (250, 0, 1300, 1080),
        "eyebrow": "ORGANIZATIONAL DESIGN • REINVENTING ORGANIZATIONS",
        "quote": "“Anyone can make any decision, provided they seek advice from experts and those affected. Advice is NOT permission — ownership stays 100% with the decision-maker.”",
        "name": "Frédéric Laloux",
        "role": "Author & Organizational Pioneer • Reinventing Organizations",
        "takeaway_label": ">> FLATLAND ARCHITECTURE: THE 5-STAGE ADVICE PROCESS",
        "takeaway_text": "Spot friction → Tangible prototype → Seek advice (mandatory) → Decide & ship → Inform & audit. Zero administrative sign-off queues.",
        "accent": (16, 185, 129),     # Emerald
        "accent_soft": (18, 40, 32),
    },
    {
        "filename": "quote_4k_ken_birdwell.png",
        "src_img": "ken_birdwell.jpg",
        "crop_box": (150, 0, 850, 720),
        "eyebrow": "ENGINEERING CANON • THE VALVE CABAL (1999)",
        "quote": "“If the student struggles, the curriculum failed — not the learner. Six focused hours of Cabal collaboration beats sixty hours of isolated, exhausted grinding.”",
        "name": "Ken Birdwell",
        "role": "Author, The Cabal Methodology (1999) • Original Half-Life Core Engineer",
        "takeaway_label": ">> FLATLAND LAW: 100% DESIGNER ACCOUNTABILITY",
        "takeaway_text": "Never blame learner difficulty on lack of talent. When phoneme comprehension drops, redesign the acoustic bridge. Defend the 5th day for quiet reflection.",
        "accent": (245, 158, 11),     # Amber
        "accent_soft": (46, 34, 18),
    }
]

def render_4k_backgrounds():
    W, H = 3840, 2160

    font_eyebrow = ImageFont.truetype(FONT_SEGOE_B, 34)
    font_quote = ImageFont.truetype(FONT_GEORGIA_I, 60)
    font_name = ImageFont.truetype(FONT_GEORGIA_B, 52)
    font_role = ImageFont.truetype(FONT_SEGOE, 32)
    font_lbl = ImageFont.truetype(FONT_SEGOE_B, 30)
    font_txt = ImageFont.truetype(FONT_SEGOE, 30)

    for item in FIGURES:
        print(f"Rendering 4K background: {item['filename']}...")
        src_path = os.path.join(SRC_DIR, item["src_img"])
        if not os.path.exists(src_path):
            print(f"Warning: {src_path} not found!")
            continue

        # Create base 4K canvas (rich dark obsidian/charcoal background)
        bg = Image.new("RGBA", (W, H), (21, 24, 28, 255))

        # Process speaker image
        spk = Image.open(src_path).convert("RGBA")
        if item.get("crop_box"):
            spk = spk.crop(item["crop_box"])

        # Target speaker frame on the right side of the canvas
        spk_scale = H / spk.height
        spk_w = int(spk.width * spk_scale)
        spk_h = H
        spk_resized = spk.resize((spk_w, spk_h), Image.Resampling.LANCZOS)

        # Enhance speaker contrast & color grading subtly
        enh_c = ImageEnhance.Contrast(spk_resized.convert("RGB"))
        spk_graded = enh_c.enhance(1.08).convert("RGBA")
        enh_s = ImageEnhance.Sharpness(spk_graded.convert("RGB"))
        spk_graded = enh_s.enhance(1.12).convert("RGBA")

        # Position speaker right-aligned
        spk_x = W - spk_w

        # Create smooth horizontal alpha scrim mask for speaker:
        # The left 600px of the speaker image fades smoothly from 0 to 255
        mask = Image.new("L", (spk_w, spk_h), 255)
        blend_w = min(int(spk_w * 0.40), 750)
        for x in range(blend_w):
            alpha = int(255 * (x / blend_w) ** 1.3)
            for y in range(spk_h):
                mask.putpixel((x, y), alpha)

        # Paste speaker with blend mask onto canvas
        bg.paste(spk_graded, (spk_x, 0), mask)

        # Scrim overlay: Solid dark behind text (0 to 1750), fading smoothly to 0 by X=2150
        scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw_scrim = ImageDraw.Draw(scrim)
        for x in range(0, W, 4):
            if x < 1750:
                a = 245
            elif x < 2150:
                a = int(245 * (1 - (x - 1750) / 400) ** 1.5)
            else:
                a = 0
            if a > 0:
                draw_scrim.rectangle([x, 0, x + 4, H], fill=(19, 22, 26, a))
        bg = Image.alpha_composite(bg, scrim)

        # Render typography & editorial cards
        draw = ImageDraw.Draw(bg)

        # Left margin & layout bounds
        left_x = 220
        max_text_w = 1700
        curr_y = 200

        # 1. Eyebrow Badge Pill
        eyebrow_text = item["eyebrow"].upper()
        bbox = font_eyebrow.getbbox(eyebrow_text)
        badge_w = (bbox[2] - bbox[0]) + 60
        badge_h = 66
        draw.rounded_rectangle(
            [left_x, curr_y, left_x + badge_w, curr_y + badge_h],
            radius=12,
            fill=item["accent_soft"],
            outline=item["accent"],
            width=3
        )
        draw.text((left_x + 30, curr_y + 12), eyebrow_text, font=font_eyebrow, fill=item["accent"])
        curr_y += badge_h + 80

        # 2. Verbatim Quote in Georgia Italic
        quote_text = item["quote"]
        quote_lines = []
        words = quote_text.split()
        cur_line = []
        for w in words:
            cur_line.append(w)
            test_line = " ".join(cur_line)
            tb_box = font_quote.getbbox(test_line)
            if (tb_box[2] - tb_box[0]) > max_text_w:
                cur_line.pop()
                quote_lines.append(" ".join(cur_line))
                cur_line = [w]
        if cur_line:
            quote_lines.append(" ".join(cur_line))

        for ql in quote_lines:
            draw.text((left_x, curr_y), ql, font=font_quote, fill=(250, 248, 245))
            curr_y += 86
        curr_y += 40

        # 3. Speaker Attribution Divider Line
        draw.line([left_x, curr_y, left_x + 300, curr_y], fill=item["accent"], width=4)
        curr_y += 35

        # 4. Speaker Name
        draw.text((left_x, curr_y), item["name"], font=font_name, fill=(255, 255, 255))
        curr_y += 72

        # 5. Speaker Role & Citation
        draw.text((left_x, curr_y), item["role"], font=font_role, fill=(160, 168, 180))
        curr_y += 75

        # 6. Bottom Flatland Principle Card
        bot_card_y = H - 420
        bot_card_w = 1700
        bot_card_h = 240
        draw.rounded_rectangle(
            [left_x, bot_card_y, left_x + bot_card_w, bot_card_y + bot_card_h],
            radius=18,
            fill=(26, 30, 36, 240),
            outline=item["accent"],
            width=2
        )
        draw.rounded_rectangle(
            [left_x + 18, bot_card_y + 18, left_x + 24, bot_card_y + bot_card_h - 18],
            radius=3,
            fill=item["accent"]
        )

        draw.text((left_x + 50, bot_card_y + 30), item["takeaway_label"], font=font_lbl, fill=item["accent"])

        takeaway_words = item["takeaway_text"].split()
        t_lines = []
        c_line = []
        for w in takeaway_words:
            c_line.append(w)
            test_line = " ".join(c_line)
            t_box = font_txt.getbbox(test_line)
            if (t_box[2] - t_box[0]) > (bot_card_w - 90):
                c_line.pop()
                t_lines.append(" ".join(c_line))
                c_line = [w]
        if c_line:
            t_lines.append(" ".join(c_line))

        t_y = bot_card_y + 88
        for tl in t_lines:
            draw.text((left_x + 50, t_y), tl, font=font_txt, fill=(215, 220, 228))
            t_y += 46

        final_rgb = bg.convert("RGB")
        out_path = os.path.join(OUT_DIR, item["filename"])
        final_rgb.save(out_path, "PNG", optimize=True)
        print(f"Saved: {out_path} ({W}x{H})")

if __name__ == "__main__":
    render_4k_backgrounds()
