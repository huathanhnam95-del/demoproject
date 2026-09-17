import os
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def test_speaker_slides():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Color Palette
    C_BG = RGBColor(250, 248, 245)
    C_CARD = RGBColor(255, 255, 255)
    C_CARD_BORDER = RGBColor(226, 221, 214)
    C_DARK = RGBColor(26, 29, 32)
    C_MUTED = RGBColor(95, 100, 110)
    C_TERRA = RGBColor(168, 67, 43)
    C_TERRA_LIGHT = RGBColor(253, 242, 240)
    C_AMBER = RGBColor(180, 83, 9)
    C_AMBER_LIGHT = RGBColor(254, 243, 199)
    C_SLATE = RGBColor(30, 58, 95)
    C_SLATE_LIGHT = RGBColor(238, 242, 246)
    C_GREEN = RGBColor(22, 101, 52)
    C_GREEN_LIGHT = RGBColor(236, 253, 245)
    C_BANNER_BG = RGBColor(243, 239, 233)
    C_LINE = RGBColor(205, 200, 190)

    plate_dir = r"c:\Cursor AI\assets\speaker_portraits\plates"
    plate_chet = os.path.join(plate_dir, "chet_plate.jpg")
    plate_weier = os.path.join(plate_dir, "weier_plate.jpg")
    plate_morasky = os.path.join(plate_dir, "morasky_plate.jpg")
    plate_wolpaw = os.path.join(plate_dir, "wolpaw_plate.jpg")
    plate_geldreich = os.path.join(plate_dir, "geldreich_plate.jpg")
    plate_freeman = os.path.join(plate_dir, "freeman_plate.jpg")
    plate_laloux = os.path.join(plate_dir, "laloux_plate.jpg")
    plate_birdwell = os.path.join(plate_dir, "birdwell_plate.jpg")

    def set_slide_bg(slide):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = C_BG
        bg.line.fill.background()

    def add_header(slide, eyebrow, title, subtitle):
        tb = slide.shapes.add_textbox(Inches(0.8), Inches(0.35), Inches(11.733), Inches(1.25))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.text = eyebrow.upper()
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_TERRA
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(25) if len(title) > 52 else Pt(28)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(3)

        p = tf.add_paragraph()
        p.text = subtitle
        p.font.name = "Segoe UI"
        p.font.size = Pt(13)
        p.font.color.rgb = C_MUTED

    # Refined Slide 1: The Documented Traps with Portrait Plates
    s_traps = prs.slides.add_slide(blank_layout)
    set_slide_bg(s_traps)
    add_header(
        s_traps,
        "Organizational Sociology • Historical Pitfalls",
        "The Documented Traps: What We Guard Against",
        "Drawing from 50 years of organizational literature to engineer explicit cultural defenses:"
    )

    card_y = Inches(1.75)
    card_h = Inches(5.30)
    card_w = Inches(3.68)
    card_gap = Inches(0.34)

    traps = [
        (
            "⚠️ TRAP 01 • FREEMAN (1972) & ELLSWORTH",
            "Shadow Barons",
            "⚠️ The Tyranny of Structurelessness",
            "Removing formal hierarchy does NOT abolish power; it merely pushes power underground into unaccountable social cliques, popularity contests, and hallway whisper networks.",
            "Explicit Democratic Structuring & The Advice Process: All major curriculum decisions are logged openly in the living Bible. Technical merit and empirical data override social seniority.",
            "“Cliques form in the dark; radical transparency keeps Flatland flat.”",
            plate_freeman,
            "Jo Freeman",
            "Author (1972)"
        ),
        (
            "⚠️ TRAP 02 • VALVE HANDBOOK & WEIER",
            "Phantom Crunch",
            "⚠️ Guilt-Driven Overtime",
            "Without managers setting explicit boundaries, dedicated professionals work until 2 AM out of unspoken guilt. The Valve Handbook explicitly warned that overtime is a failure in planning.",
            "The Sustainable Cadence: 6 hours/day of deep collaborative focus, 4 days/week. The 5th day is 100% protected for solo drafting, quiet tool testing, and rest. Zero late-night messaging.",
            "“Crunch means our predictions failed, not that we are heroes.”",
            plate_weier,
            "Josh Weier",
            "Valve Project Lead"
        ),
        (
            "⚠️ TRAP 03 • RICH GELDREICH (2015) & VALVE",
            "Stack Ranking",
            "⚠️ The Peer Grading Trap",
            "Valve ranked peers against each other for compensation, unintentionally breeding cutthroat politics, risk aversion, and fear of challenging popular veterans with bold innovations.",
            "Shared Objective Outcomes: 100% alignment around student pronunciation mastery. Zero internal stack ranking, zero peer competition for fixed bonus pools. All incentives share student success.",
            "“Never turn colleagues into rivals for a fixed reward pool.”",
            plate_geldreich,
            "Rich Geldreich",
            "Valve Software Engineer"
        )
    ]

    for i, (badge_txt, title, subtitle, threat, defense, quote, plate_img, speaker_name, speaker_role) in enumerate(traps):
        cx = Inches(0.8) + i * (card_w + card_gap)
        cbox = s_traps.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, card_y, card_w, card_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = C_TERRA
        cbox.line.width = Pt(1.5)

        # Top badge pill
        pill_w = card_w - Inches(0.40)
        pill = s_traps.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.20), card_y + Inches(0.16), pill_w, Inches(0.30))
        pill.fill.solid()
        pill.fill.fore_color.rgb = C_TERRA_LIGHT
        pill.line.color.rgb = C_TERRA
        pill.line.width = Pt(0.75)
        ptf = pill.text_frame
        ptf.margin_left = ptf.margin_right = ptf.margin_top = ptf.margin_bottom = 0
        p = ptf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = badge_txt
        p.font.name = "Segoe UI"
        p.font.size = Pt(9)
        p.font.bold = True
        p.font.color.rgb = C_TERRA

        # Header Row: Speaker Portrait Plate (Left) + Titles & Attribution (Right)
        pw = Inches(1.00)
        ph = Inches(1.25) # 4:5 aspect ratio
        px = cx + Inches(0.20)
        py = card_y + Inches(0.54)

        if os.path.exists(plate_img):
            s_traps.shapes.add_picture(plate_img, px, py, pw, ph)
            pfr = s_traps.shapes.add_shape(MSO_SHAPE.RECTANGLE, px, py, pw, ph)
            pfr.fill.background()
            pfr.line.color.rgb = C_CARD_BORDER
            pfr.line.width = Pt(1)

        tb_hdr = s_traps.shapes.add_textbox(cx + Inches(1.30), card_y + Inches(0.50), card_w - Inches(1.50), Inches(1.30))
        htf = tb_hdr.text_frame
        htf.word_wrap = True
        htf.margin_left = htf.margin_right = htf.margin_top = htf.margin_bottom = 0

        p = htf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(18)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(2)

        p = htf.add_paragraph()
        p.text = subtitle
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(10)
        p.font.color.rgb = C_AMBER
        p.space_after = Pt(3)

        p = htf.add_paragraph()
        p.text = f"{speaker_name} • {speaker_role}"
        p.font.name = "Segoe UI"
        p.font.size = Pt(9)
        p.font.color.rgb = C_MUTED

        # Body: Threat, Defense, and Quote
        tb_body = s_traps.shapes.add_textbox(cx + Inches(0.20), card_y + Inches(1.90), card_w - Inches(0.40), card_h - Inches(2.00))
        btf = tb_body.text_frame
        btf.word_wrap = True
        btf.margin_left = btf.margin_right = btf.margin_top = btf.margin_bottom = 0

        p = btf.paragraphs[0]
        p.text = "THE THREAT:"
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = C_TERRA
        p.space_after = Pt(1)

        p = btf.add_paragraph()
        p.text = threat
        p.font.name = "Segoe UI"
        p.font.size = Pt(10)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.15
        p.space_after = Pt(5)

        p = btf.add_paragraph()
        p.text = "OUR ENGINEERED DEFENSE:"
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = C_GREEN
        p.space_after = Pt(1)

        p = btf.add_paragraph()
        p.text = defense
        p.font.name = "Segoe UI"
        p.font.size = Pt(10)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.15
        p.space_after = Pt(6)

        p = btf.add_paragraph()
        p.text = quote
        p.font.name = "Georgia"
        p.font.italic = True
        p.font.size = Pt(10.5)
        p.font.color.rgb = C_TERRA
        p.line_spacing = 1.15

    # -------------------------------------------------------------
    # SLIDE 2: Voices from Flatland (The Valve Veteran Cadre)
    # -------------------------------------------------------------
    s_vet = prs.slides.add_slide(blank_layout)
    set_slide_bg(s_vet)
    add_header(
        s_vet,
        "Veteran Wisdom • Primary Source Interviews",
        "Voices from Flatland: The Valve Veteran Cadre",
        "Direct wisdom from the creators of Half-Life, Portal, Left 4 Dead, and Team Fortress 2 on autonomy and craft:"
    )

    v_w = Inches(2.70)
    v_gap = Inches(0.31)
    v_y = Inches(1.75)
    v_h = Inches(5.30)

    veterans = [
        (
            "✦ WRITING & PROTOTYPES",
            "Chet Faliszek",
            "Writer & VR Lead • Left 4 Dead, Portal",
            plate_chet,
            "“Nobody tells you what to do. You see a problem, you go fix it. The people who thrive are the ones who don't wait for permission — they build the prototype and let data speak.”",
            "Zero-Permission Bias",
            "Don't write proposals for vowel drills — build the prototype in 2 hours and test it directly with students.",
            C_TERRA,
            C_TERRA_LIGHT
        ),
        (
            "✦ PROJECT LEADERSHIP",
            "Josh Weier",
            "Project Lead • Portal 2, Half-Life 2",
            plate_weier,
            "“At Valve, if you're working until 2 AM, nobody thinks you're a hero. They think the process failed. Sustainable creative teams guard their focus, recharge, and sleep.”",
            "Sustainable Pace",
            "6 hours of deep Cabal collaboration beats 60 hours of isolated, exhausted grinding. Guard the 5th day.",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "✦ AUDIO & CABAL LOOPS",
            "Mike Morasky",
            "Audio Director • Portal 2, TF2, HL: Alyx",
            plate_morasky,
            "“The Cabal wasn't a meeting. It was sitting in the same room where audio, design, and code fed into each other every 10 seconds. You don't write music in a silo — you compose as it plays.”",
            "Closed-Loop Audio",
            "Synthesize Kokoro phonemes in 2 minutes right alongside the curriculum designer at the shared workbench.",
            C_AMBER,
            C_AMBER_LIGHT
        ),
        (
            "✦ PLAYTEST & GAMEPLAY",
            "Erik Wolpaw",
            "Lead Writer • Portal 1 & 2, Psychonauts",
            plate_wolpaw,
            "“Writing for games is about leaving your ego at the door. You write dialogue, watch a playtester in silence, and if it slows them down or confuses them, you cut it on the spot.”",
            "Ego-Free Iteration",
            "If a pronunciation drill line confuses the learner, cut it immediately without defensiveness.",
            C_GREEN,
            C_GREEN_LIGHT
        )
    ]

    for i, (badge_txt, name, credits, plate_img, quote, takeaway_hdr, takeaway_txt, col, bg_col) in enumerate(veterans):
        cx = Inches(0.8) + i * (v_w + v_gap)
        cbox = s_vet.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, v_y, v_w, v_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        # Top Badge Pill
        pill_w = v_w - Inches(0.24)
        pill = s_vet.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.12), v_y + Inches(0.14), pill_w, Inches(0.30))
        pill.fill.solid()
        pill.fill.fore_color.rgb = bg_col
        pill.line.color.rgb = col
        pill.line.width = Pt(0.75)
        ptf = pill.text_frame
        ptf.margin_left = ptf.margin_right = ptf.margin_top = ptf.margin_bottom = 0
        p = ptf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = badge_txt
        p.font.name = "Segoe UI"
        p.font.size = Pt(9)
        p.font.bold = True
        p.font.color.rgb = col

        # Compact Centered Portrait Plate (4:5 ratio)
        pw = Inches(1.60)
        ph = Inches(2.00)
        px = cx + (v_w - pw) / 2
        py = v_y + Inches(0.50)

        if os.path.exists(plate_img):
            s_vet.shapes.add_picture(plate_img, px, py, pw, ph)
            pfr = s_vet.shapes.add_shape(MSO_SHAPE.RECTANGLE, px, py, pw, ph)
            pfr.fill.background()
            pfr.line.color.rgb = C_CARD_BORDER
            pfr.line.width = Pt(1)

        # Text below portrait
        tb = s_vet.shapes.add_textbox(cx + Inches(0.14), v_y + Inches(2.58), v_w - Inches(0.28), v_h - Inches(2.68))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = name
        p.font.name = "Georgia"
        p.font.size = Pt(16)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(1)

        p = tf.add_paragraph()
        p.alignment = PP_ALIGN.CENTER
        p.text = credits
        p.font.name = "Segoe UI"
        p.font.size = Pt(8.5)
        p.font.color.rgb = col
        p.space_after = Pt(5)

        p = tf.add_paragraph()
        p.text = quote
        p.font.name = "Georgia"
        p.font.italic = True
        p.font.size = Pt(9.5)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.15
        p.space_after = Pt(6)

        p = tf.add_paragraph()
        p.text = f"✦ R&D APPLICATION: {takeaway_hdr.upper()}"
        p.font.name = "Segoe UI"
        p.font.size = Pt(8.5)
        p.font.bold = True
        p.font.color.rgb = col
        p.space_after = Pt(1)

        p = tf.add_paragraph()
        p.text = takeaway_txt
        p.font.name = "Segoe UI"
        p.font.size = Pt(9)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.12

    # -------------------------------------------------------------
    # SLIDE 3: The 5-Stage Advice Process with Frédéric Laloux Anchor Card
    # -------------------------------------------------------------
    s_adv = prs.slides.add_slide(blank_layout)
    set_slide_bg(s_adv)
    add_header(
        s_adv,
        "Decision Architecture • Dennis Bakke & Frédéric Laloux",
        "Decision Architecture: The 5-Stage Advice Process",
        "How any autonomous educator drives high-stakes decisions without supervisory orders or consensus paralysis:"
    )

    adv_w = Inches(2.18)
    adv_gap = Inches(0.20)
    adv_y = Inches(1.75)
    adv_h = Inches(4.25)

    stages = [
        ("STAGE 01", "Spot Friction", "✦ The Initiator Steps Up", "You notice a confusing pronunciation rubric, unnatural audio cadence, or tool bottleneck.", "Initiative Rule: The person who spots the friction owns driving the fix.", "“Never wait for someone else to log a ticket.”", C_SLATE, C_SLATE_LIGHT),
        ("STAGE 02", "Prototype", "✦ Tangible Draft", "Draft a 1-page spec or generate a 20-second Kokoro audio sample before calling meetings.", "Prototype Rule: No abstract philosophical debates without a tangible draft.", "“Discussions without prototypes breed debate.”", C_SLATE, C_SLATE_LIGHT),
        ("STAGE 03", "Seek Advice", "✦ MANDATORY GATE", "Consult 2 parties:\n1. Affected Peers\n2. Domain Specialists (phoneticians, audio leads).", "⚠️ Iron Gate: Advice is counsel, NOT a veto! No consensus required.", "“You must seek advice; you do NOT need agreement.”", C_TERRA, C_TERRA_LIGHT),
        ("STAGE 04", "Decide & Ship", "✦ Sole Ownership", "Weigh all feedback, integrate valid peer insights, and decide yourself.", "Ownership Rule: You do not ask permission. You pull the trigger.", "“Total ownership of both victory and failure.”", C_GREEN, C_GREEN_LIGHT),
        ("STAGE 05", "Inform & Audit", "✦ Radical Transparency", "Broadcast the decision openly in the shared Bible and publish real learner playtest data.", "Audit Rule: Real learner data replaces bureaucratic supervision.", "“If it fails, revert openly. Transparency is safety.”", C_GREEN, C_GREEN_LIGHT)
    ]

    for i, (tag, title, sub, desc, rule, quote, col, bg_c) in enumerate(stages):
        cx = Inches(0.8) + i * (adv_w + adv_gap)
        cbox = s_adv.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, adv_y, adv_w, adv_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        pill_w = adv_w - Inches(0.20)
        pill = s_adv.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.10), adv_y + Inches(0.14), pill_w, Inches(0.32))
        pill.fill.solid()
        pill.fill.fore_color.rgb = bg_c
        pill.line.color.rgb = col
        pill.line.width = Pt(0.75)
        ptf = pill.text_frame
        ptf.margin_left = ptf.margin_right = ptf.margin_top = ptf.margin_bottom = 0
        p = ptf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = tag
        p.font.name = "Segoe UI"
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = col

        tb = s_adv.shapes.add_textbox(cx + Inches(0.12), adv_y + Inches(0.54), adv_w - Inches(0.24), adv_h - Inches(0.64))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(16)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = sub
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(10.5)
        p.font.color.rgb = col
        p.space_after = Pt(6)

        p = tf.add_paragraph()
        p.text = desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.15
        p.space_after = Pt(6)

        p = tf.add_paragraph()
        p.text = rule
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.15
        p.space_after = Pt(6)

        p = tf.add_paragraph()
        p.text = quote
        p.font.name = "Georgia"
        p.font.italic = True
        p.font.size = Pt(10.5)
        p.font.color.rgb = col

        if i < 4:
            ar = s_adv.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, cx + adv_w + Inches(0.04), adv_y + Inches(2.0), Inches(0.12), Inches(0.20))
            ar.fill.solid()
            ar.fill.fore_color.rgb = C_LINE
            ar.line.fill.background()

    # Author Anchor Card for Frédéric Laloux at bottom
    ban_y = Inches(6.12)
    ban_h = Inches(1.08)
    ban = s_adv.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), ban_y, Inches(11.733), ban_h)
    ban.fill.solid()
    ban.fill.fore_color.rgb = C_BANNER_BG
    ban.line.color.rgb = C_CARD_BORDER
    ban.line.width = Pt(1)

    # Laloux Portrait Plate in bottom banner
    lpw = Inches(0.72)
    lph = Inches(0.90) # 4:5 ratio
    lpx = Inches(0.95)
    lpy = ban_y + Inches(0.09)
    if os.path.exists(plate_laloux):
        s_adv.shapes.add_picture(plate_laloux, lpx, lpy, lpw, lph)
        lpfr = s_adv.shapes.add_shape(MSO_SHAPE.RECTANGLE, lpx, lpy, lpw, lph)
        lpfr.fill.background()
        lpfr.line.color.rgb = C_CARD_BORDER
        lpfr.line.width = Pt(1)

    tb_ban = s_adv.shapes.add_textbox(Inches(1.80), ban_y + Inches(0.08), Inches(10.60), Inches(0.92))
    btf = tb_ban.text_frame
    btf.word_wrap = True
    btf.margin_left = btf.margin_right = btf.margin_top = btf.margin_bottom = 0

    p = btf.paragraphs[0]
    p.text = "⚡ FRÉDÉRIC LALOUX • AUTHOR, REINVENTING ORGANIZATIONS"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10)
    p.font.bold = True
    p.font.color.rgb = C_GREEN
    p.space_after = Pt(2)

    p = btf.add_paragraph()
    p.text = "“Anyone can make any decision, provided they seek advice from experts and those affected. Advice is NOT permission — ownership stays 100% with the decision-maker.”"
    p.font.name = "Georgia"
    p.font.size = Pt(11)
    p.font.italic = True
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(2)

    p = btf.add_paragraph()
    p.text = "Peer consultation replaces bureaucratic approval gates. Data and student playtest outcomes override administrative seniority."
    p.font.name = "Segoe UI"
    p.font.size = Pt(10)
    p.font.color.rgb = C_MUTED

    # -------------------------------------------------------------
    # SLIDE 4: Sustainable Cadence & Ken Birdwell Portrait Plate
    # -------------------------------------------------------------
    s_cad = prs.slides.add_slide(blank_layout)
    set_slide_bg(s_cad)
    add_header(
        s_cad,
        "Sustainable Cadence • Phase 2 Launch",
        "Sustainable Cadence: Launching Phase 2",
        "The 4-day collaborative rhythm, the protected 5th day, and our 12-week production horizon:"
    )

    card_y15 = Inches(1.75)
    card_h15 = Inches(3.75)
    col_w15 = Inches(5.68)

    # Left: The Ken Birdwell Cadence
    l_box15 = s_cad.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), card_y15, col_w15, card_h15)
    l_box15.fill.solid()
    l_box15.fill.fore_color.rgb = C_CARD
    l_box15.line.color.rgb = C_SLATE
    l_box15.line.width = Pt(1.5)

    pill_l15 = s_cad.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.05), card_y15 + Inches(0.18), Inches(3.4), Inches(0.34))
    pill_l15.fill.solid()
    pill_l15.fill.fore_color.rgb = C_SLATE_LIGHT
    pill_l15.line.color.rgb = C_SLATE
    pill_l15.line.width = Pt(0.75)
    ptf_l15 = pill_l15.text_frame
    ptf_l15.margin_left = ptf_l15.margin_right = ptf_l15.margin_top = ptf_l15.margin_bottom = 0
    p = ptf_l15.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "THE KEN BIRDWELL CADENCE (VALVE 1999)"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10)
    p.font.bold = True
    p.font.color.rgb = C_SLATE

    # Schedule Bullets on Left
    ltb15 = s_cad.shapes.add_textbox(Inches(1.05), card_y15 + Inches(0.60), Inches(3.80), card_h15 - Inches(0.75))
    ltf15 = ltb15.text_frame
    ltf15.word_wrap = True
    ltf15.margin_left = ltf15.margin_right = ltf15.margin_top = ltf15.margin_bottom = 0

    p = ltf15.paragraphs[0]
    p.text = "High Velocity, Zero Burnout"
    p.font.name = "Georgia"
    p.font.size = Pt(20)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(6)

    p = ltf15.add_paragraph()
    p.text = "• Monday to Thursday (10 AM – 5 PM): "
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(11)
    p.font.color.rgb = C_DARK
    r2 = p.add_run()
    r2.text = "6 hours/day of deep collaborative synthesis at the shared Cabal bench (1h lunch). High-density co-creation."
    r2.font.name = "Segoe UI"
    r2.font.size = Pt(10.5)
    r2.font.color.rgb = C_MUTED
    p.line_spacing = 1.18
    p.space_after = Pt(6)

    p = ltf15.add_paragraph()
    p.text = "• Friday (100% Protected Deep Work): "
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(11)
    p.font.color.rgb = C_DARK
    r2 = p.add_run()
    r2.text = "Strictly reserved for solo drafting, quiet tool testing, and mental recovery. Zero meetings."
    r2.font.name = "Segoe UI"
    r2.font.size = Pt(10.5)
    r2.font.color.rgb = C_MUTED
    p.line_spacing = 1.18
    p.space_after = Pt(6)

    p = ltf15.add_paragraph()
    p.text = "• Evenings & Weekends (Zero Messaging): "
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(11)
    p.font.color.rgb = C_DARK
    r2 = p.add_run()
    r2.text = "Overtime is recognized as a planning failure, never celebrated as heroism."
    r2.font.name = "Segoe UI"
    r2.font.size = Pt(10.5)
    r2.font.color.rgb = C_MUTED
    p.line_spacing = 1.18

    # Ken Birdwell Portrait Plate on Right
    kpw = Inches(1.20)
    kph = Inches(1.50) # 4:5 ratio
    kpx = Inches(5.05)
    kpy = card_y15 + Inches(0.68)

    if os.path.exists(plate_birdwell):
        s_cad.shapes.add_picture(plate_birdwell, kpx, kpy, kpw, kph)
        kpfr = s_cad.shapes.add_shape(MSO_SHAPE.RECTANGLE, kpx, kpy, kpw, kph)
        kpfr.fill.background()
        kpfr.line.color.rgb = C_CARD_BORDER
        kpfr.line.width = Pt(1)

    tb_kcap = s_cad.shapes.add_textbox(kpx - Inches(0.10), kpy + kph + Inches(0.08), kpw + Inches(0.20), Inches(1.30))
    ktf = tb_kcap.text_frame
    ktf.word_wrap = True
    ktf.margin_left = ktf.margin_right = ktf.margin_top = ktf.margin_bottom = 0

    p = ktf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "Ken Birdwell"
    p.font.name = "Georgia"
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = C_DARK

    p = ktf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "Author, The Cabal (1999)"
    p.font.name = "Segoe UI"
    p.font.size = Pt(9)
    p.font.color.rgb = C_MUTED
    p.space_after = Pt(2)

    p = ktf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "“6 focused hours beats 60h grinding.”"
    p.font.name = "Georgia"
    p.font.size = Pt(9.5)
    p.font.italic = True
    p.font.color.rgb = C_SLATE

    # Right: 12-Week Roadmap
    r_box15 = s_cad.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.85), card_y15, col_w15, card_h15)
    r_box15.fill.solid()
    r_box15.fill.fore_color.rgb = C_GREEN_LIGHT
    r_box15.line.color.rgb = C_GREEN
    r_box15.line.width = Pt(1.5)

    pill_r15 = s_cad.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(7.10), card_y15 + Inches(0.18), Inches(3.4), Inches(0.34))
    pill_r15.fill.solid()
    pill_r15.fill.fore_color.rgb = C_CARD
    pill_r15.line.color.rgb = C_GREEN
    pill_r15.line.width = Pt(1)
    ptf_r15 = pill_r15.text_frame
    ptf_r15.margin_left = ptf_r15.margin_right = ptf_r15.margin_top = ptf_r15.margin_bottom = 0
    p = ptf_r15.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "THE 12-WEEK PRODUCTION HORIZON"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10)
    p.font.bold = True
    p.font.color.rgb = C_GREEN

    rtb15 = s_cad.shapes.add_textbox(Inches(7.10), card_y15 + Inches(0.60), col_w15 - Inches(0.50), card_h15 - Inches(0.75))
    rtf15 = rtb15.text_frame
    rtf15.word_wrap = True
    rtf15.margin_left = rtf15.margin_right = rtf15.margin_top = rtf15.margin_bottom = 0

    p = rtf15.paragraphs[0]
    p.text = "50 Empirically Validated Modules"
    p.font.name = "Georgia"
    p.font.size = Pt(20)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(8)

    p = rtf15.add_paragraph()
    p.text = "🚀 Sprint 1 (Weeks 1–4): Vowels 01–20"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(12)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(1)
    p = rtf15.add_paragraph()
    p.text = "Articulatory mouth tension, minimal pair listening games, and AI audio calibration. Week 5: Alpha Gate (20 ESL learners)."
    p.font.name = "Segoe UI"
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_MUTED
    p.line_spacing = 1.15
    p.space_after = Pt(4)

    p = rtf15.add_paragraph()
    p.text = "🚀 Sprint 2 (Weeks 6–9): Consonants 21–40"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(12)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(1)
    p = rtf15.add_paragraph()
    p.text = "Aspiration, voiced vs. unvoiced stops, and consonant clusters. Week 10: Beta Gate (50 ESL learners under automated STT)."
    p.font.name = "Segoe UI"
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_MUTED
    p.line_spacing = 1.15
    p.space_after = Pt(4)

    p = rtf15.add_paragraph()
    p.text = "🚀 Sprint 3 (Weeks 11–12): Prosody 41–50"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(12)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(1)
    p = rtf15.add_paragraph()
    p.text = "Sentence rhythm, tonic syllables, and communicative pitch contour integration."
    p.font.name = "Segoe UI"
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_MUTED
    p.line_spacing = 1.15

    # Bottom Commences Banner
    c_box15 = s_cad.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.65), Inches(11.733), Inches(1.45))
    c_box15.fill.solid()
    c_box15.fill.fore_color.rgb = C_BANNER_BG
    c_box15.line.color.rgb = C_CARD_BORDER
    c_box15.line.width = Pt(1)

    ch_tf = c_box15.text_frame
    ch_tf.word_wrap = True
    ch_tf.margin_left = ch_tf.margin_right = Inches(0.25)
    ch_tf.margin_top = Inches(0.12)

    p = ch_tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "🚀 PHASE 2 PRODUCTION COMMENCES TODAY"
    p.font.name = "Segoe UI"
    p.font.size = Pt(11)
    p.font.bold = True
    p.font.color.rgb = C_TERRA
    p.space_after = Pt(2)

    p = ch_tf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "“We lead by serving, clearing obstacles, and fostering radical peer safety. Let's engineer the future of pronunciation.”"
    p.font.name = "Georgia"
    p.font.size = Pt(13)
    p.font.italic = True
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(2)

    p = ch_tf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "Cabal assignments and pod workspaces go live this afternoon. Week 1 Priority: Drafting the Living Syllabus Bible and engineering our first Alpha playtest prototypes."
    p.font.name = "Segoe UI"
    p.font.size = Pt(11)
    p.font.color.rgb = C_MUTED


    out_test = r"c:\Cursor AI\test_speaker_slides.pptx"
    prs.save(out_test)
    print(f"Test presentation saved to {out_test}")

def export_test_png():
    import win32com.client
    pptx_path = os.path.abspath(r"c:\Cursor AI\test_speaker_slides.pptx")
    out_dir = os.path.abspath(r"c:\Cursor AI\exported_slides\test_speaker_slides")
    os.makedirs(out_dir, exist_ok=True)
    ppt = win32com.client.Dispatch("PowerPoint.Application")
    try:
        pres = ppt.Presentations.Open(pptx_path, WithWindow=False)
        for i, slide in enumerate(pres.Slides):
            out_img = os.path.join(out_dir, f"test_slide_{i+1:02d}.png")
            slide.Export(out_img, "PNG", 1920, 1080)
            print(f"Exported: {out_img}")
        pres.Close()
    finally:
        ppt.Quit()

if __name__ == "__main__":
    test_speaker_slides()
    export_test_png()
