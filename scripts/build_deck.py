import os
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE



# Verbatim Speaker Scripts for Presentation Delivery
SPEAKER_SCRIPTS = [
    r"""Good morning, everyone. Welcome! Take a breath, grab your coffee, and make yourself comfortable.

Today marks the end of our very first month working together in this new flat model. For the past four weeks, none of us has had a manager looking over our shoulder. There are no department heads, no supervisors checking lesson plans, and no bosses assigning us daily tickets.

Today is not about telling you what lessons to build or handing down curriculum quotas. You already know your craft as English teachers better than anyone. Today is simply about us—how we work together as teammates, the strange and quiet feelings we've all experienced this past month, the real everyday hurdles we've bumped into, and the simple, practical habits that help us thrive as equals.

As you can see on the slide, our team promise is very simple: working without a boss doesn't mean having no direction. It means we all take care of each other, make decisions openly, and share the journey together.""",

    r"""Let's be completely honest with each other about Month 1.

In traditional language schools, teaching is usually a solitary job. You prepare your materials alone, walk into your classroom, close the door, and teach in private. When you take down those walls and remove the principal or supervisor, the first thing you notice is the silence. There is no morning announcement, no bell, no boss telling you what chapter comes next.

Many of us felt a little awkward. We wondered: 'Am I doing the right thing? What if I share a rough draft and people judge it?' And because we are all kind people, we were almost too polite—hesitating to speak up or disagree because we didn't want to step on anyone's toes.

As we step into Month 2, we are finding our groove. We aren't working in isolated rooms anymore. We are forming small groups to co-create together, replacing boss orders with simple everyday habits, and looking out for each other's rest. Working without a boss only works when we truly have each other's backs.""",

    r"""Let's talk about the first big reflex we all noticed: The Permission Reflex.

Think about your internal monologue over the past few weeks: 'Wait... who signs off on this? In my old school, if I wanted to change an exercise or try a new practice game, I had to submit a proposal to the department lead. Who gives me permission here?'

The old habit taught us to wait for a green light. But waiting for permission is just a delay. In our team, if you notice an exercise that confuses students, or you have an idea for a fun pronunciation game, you don't need anyone's permission to begin. You have full trust. You talk with a couple of teammates, build a quick version, and try it out.

Our mindset shift is simple: Nobody assigns you work here. You never have to ask, 'Am I allowed to help?' If you see a way to make learning better, you own helping make it happen.""",

    r"""Here is something almost everyone felt in Month 1, even if we were too shy to say it out loud: The Quiet Guilt.

At 3:00 PM, you've finished your work for the day. But you look at your laptop screen and think: 'Nobody praised my lesson today. There are no performance grades or supervisor evaluations. If I log off now, will the team think I'm slacking off?' So you stay sitting at your desk until 6:00 or 7:00 PM, just so people see you online.

That is a habit we carry over from traditional offices where people perform 'chair time' to impress managers. But here, we trust each other. We don't measure dedication by how late your light stays on or how many messages you send at night. We measure it by whether our students are actually learning and whether our teammates feel supported.

You don't need a manager's gold star to know your work matters. Do honest work, support your peers, and when the day is done, close your laptop with a completely clear conscience.""",

    r"""Our third big reflection is something we call The Politeness Trap.

We all respect each other and we want to preserve good vibes. So when a colleague shows us an audio draft or an exercise that feels a bit confusing, our first instinct is to smile and say, 'Oh, that looks great!' We keep our real thoughts to ourselves because we worry: 'What if they take it personally?'

Here is the truth: staying silent when you spot a problem isn't kindness. It actually leaves your teammate hanging, because sooner or later, a student will get confused by that lesson.

Our new rule is: Critique the work with complete honesty, and treat the person with unconditional kindness. When you offer feedback on an audio cadence or a lesson explanation, you aren't criticizing your colleague—you are teaming up with them against the confusion. We care for each other deeply, and that is exactly why we speak honestly about the work.""",

    r"""Now that we've looked at our own feelings during Month 1, let's look at where our inspiration comes from: the flat structure of Valve.

In 1996, Valve was founded with a bold question: 'What if we hired extraordinary creative people, gave them complete trust, and didn't put a single boss between them and the customer?'

For thirty years, Valve has grown into one of the most successful creative companies on Earth—operating with zero bosses, zero middle managers, and zero approval chains. Their employee handbook is famously titled: 'Welcome to Flatland.'

In Flatland, three simple ideas guide daily work:
First: Zero Managers, Total Trust. You are treated as a creative adult. If you see a way to improve a lesson or solve a problem, nobody hands you a permission slip. You own the initiative.
Second: Desks on Wheels. Literally, every desk has heavy wheels so colleagues can unplug and roll together whenever someone needs a hand. People work in flexible small groups, not isolated departments.
Third: The Learner Is the Boss. Without managers to impress or ladders to climb, everyone's energy goes toward one single goal: 'Does this genuinely help our students learn better?'

We aren't making video games—we are teaching human beings. But the creative psychology is identical: freedom from bosses only works when we stay connected, share our work early, and look out for each other.""",

    r"""Now, before we hear directly from the creators who lived this model every day at Valve, let's look at the founder behind this philosophy: Gabe Newell.

Why did a multi-billion-dollar company decide from day one to eliminate managers, job titles, and approval chains? Gabe Newell based this structure on serious economic and organizational logic—specifically Ronald Coase's Nobel Prize-winning theory on 'The Nature of the Firm.'

In 1937, Coase asked a fundamental question: Why do firms exist at all? His answer was 'transaction costs'—it costs time and friction to coordinate independent people, so 20th-century companies built pyramid hierarchies to organize repetitive factory work.

But Gabe Newell made a profound realization: In modern creative knowledge work, corporate hierarchy does the exact opposite. Hierarchies actually become the largest source of internal friction and delay! When you have department heads and review committees, ideas sit in inboxes for weeks, communication gets distorted across layers, and people waste half their energy 'managing up'—playing office politics to impress supervisors.

As Gabe famously noted in his University of Texas address: 'If you hire smart, creative people and then tell them what to do, you destroy most of their value.' When an educator only executes someone else's lesson plan, their leverage is permanently capped by a supervisor's imagination. But when teachers own their ideas directly, creative leverage multiplies.

In our team, Gabe's ideology gives us our guiding light: The learner is our only boss. You never need a permission slip from an administrator to help a struggling student or polish an exercise. We don't manage upward—we focus all our energy outward on creating lessons students truly love.""",

    r"""Now that we understand the big picture of Flatland and Gabe Newell's founding philosophy, let's hear directly from four creators who lived this reality every day for over a decade at Valve:

From Chet Faliszek: 'Action over Permission.' Nobody hands you a daily to-do list here. When you notice an exercise or lesson that isn't landing with students, don't wait for permission. Grab a colleague, try a fix, and see if it works.

From Josh Weier: 'Healthy Boundaries.' Protect your focus and your rest. Working until 2 AM doesn't make you a hero—it just means the workflow is broken. Four or five hours of energized teamwork beats twelve hours of exhausted grinding every single time.

From Mike Morasky: 'Work Live Together.' Real collaboration isn't emailing files back and forth for weeks. It's sitting together, trying an idea, and reacting in real time to each other's energy.

And from Erik Wolpaw: 'Leave Egos at the Door.' Never fall so in love with your first draft that you can't change it. If students struggle with an exercise, laugh, learn from it, and improve it together as a crew.""",

    r"""Building directly on the advice of these veteran creators, what practical teamwork habits do we adopt in our daily work? We take three core habits inspired by Valve's culture.

First: Desks on Wheels. Literally and figuratively, when you see a teammate struggling or feeling overwhelmed with an audio exercise, you don't say, 'Well, that's their task.' You roll your chair over and say, 'Hey, can I give you a hand?' We go where the team needs us most.

Second: Sharing Our Strengths. Every teacher in this room has a superpower. Some of you have incredible ears for natural sentence rhythm. Some of you create engaging, fun classroom games. Some of you love exploring new tech tools. When you bring those strengths together, small teams can build complete, polished lessons without needing anyone from the outside.

Third: Try It First, Don't Just Talk. If two teachers have different ideas about how to teach a lesson, don't spend an hour in a theoretical debate. Take 15 minutes to sketch a quick draft or record a sample. As Chet Faliszek says: 'Build a quick draft, show it to your team, and let real results do the talking.'""",

    r"""At the same time, we have to be completely honest about the risks. Over the last 50 years, many teams have tried working without managers. And researchers have documented three major traps that pop up when you remove bosses. We want to be completely open about them so we can protect our culture.

Trap Number 1 is Hidden Cliques. When there are no formal managers, power can quietly slip into informal popularity contests or whisper chats in the hallway. Our defense is total transparency: we share our ideas in public team channels, document our choices openly, and make sure every single teacher has an equal voice.

Trap Number 2 is Silent Overtime. Without a manager telling people when to stop, dedicated teachers quietly work until midnight out of guilt. Josh Weier at Valve made this famous: working until 2 AM doesn't make you a hero; it just means the workflow is broken. We protect our rest.

Trap Number 3 is Peer Competition. When teammates feel secretly ranked or compared against each other, trust breaks down. People stop helping their peers. Here, we share one mission: our students' success. We succeed together or not at all.""",

    r"""To understand why we are changing our workflow, look at how traditional schools produce lesson materials.

It's a relay race: Teacher A sits alone for a week writing a worksheet. Then it sits in a supervisor's inbox for five days waiting for review. The supervisor marks it up with red pens and sends it to an audio person, who waits another week. By the time a test is run, four weeks have passed, everyone has forgotten the original context, and if there's a flaw, it gets kicked all the way back to step one!

Every handoff creates a waiting line. Every waiting line kills momentum. In the old world, you needed managers just to chase emails and unblock backlogs. We want to eliminate the waiting lines entirely.""",

    r"""So what do we do instead? We form Small Group Hubs.

Instead of passing a document along a conveyor belt, three or four teachers sit down together around one screen.

You wear different hats: One teacher focuses on clear lesson flow and concept explanations. Another teacher crafts fun, interactive speaking games. A third teacher has a sharp ear for natural audio tone and cadence. And the fourth teacher acts as the Student Champion, asking: 'Would a beginner actually get this, or does it feel confusing?'

When you work together in the same room or on the same live call, you don't wait weeks for feedback. You notice a clunky sentence in ten seconds, adjust it on the spot, and finish a complete, polished learning activity in a single afternoon with zero emails.""",

    r"""Let me share a real story from our team just last week.

At 9:00 AM, Maria noticed that beginner students were still confusing words like 'seat' and 'sit'—the traditional textbook rule of 'long vowel vs. short vowel' just wasn't clicking for them. Instead of writing a memo or waiting for a meeting, she mentioned it to three teammates.

At 9:30 AM, David suggested: 'What if we make it a mirror game based on smiling? For 'seat', smile wide! For 'sit', relax your jaw.' He drafted the game directly on screen.

At 10:15 AM, Sarah generated the audio examples, closed her eyes, and tested the contrast with David to make sure it was crystal-clear.

At 11:00 AM, Alex invited a beginner student to try the smile game. Within five minutes, the student laughed and said, 'Oh! Now I feel the difference!'

By 11:45 AM, the lesson was done, tested, and ready. In a traditional school, that would have taken three months of committee meetings. Our team did it before lunch.""",

    r"""Now, the big question: In a flat team, how do we make decisions without a boss, but without getting bogged down in endless voting?

We use a practice called The Advice Process, developed by Frédéric Laloux. It has five simple steps:

Step 1: Spot a Need. If you see something that could be improved, you have the green light to lead the solution.
Step 2: Make a Quick Draft. Don't call a big meeting to talk about abstract ideas. Spend 20 minutes sketching a rough draft or recording a sample so people can see what you mean.
Step 3: Ask for Advice. This is the golden rule: consult two groups—teammates with experience in this area, and those who will be affected by your decision. But remember: advice is wisdom to help you, not a vote or permission to wait for!
Step 4: Make the Call. You weigh the advice, pick the best path forward, and make the decision yourself. You own the call.
Step 5: Share and Learn. Tell the team what you did, test it with students, and share what happened openly.

As Laloux says: 'Any person can make any decision, as long as they seek advice from knowledgeable peers and those affected. Advice is not permission—ownership stays with you.'""",

    r"""Let's compare the three ways teams make decisions.

On the left is The Consensus Trap: trying to get all ten teachers to agree on every comma before trying an idea. It moves at the speed of the most hesitant person, and you end up with bland compromises.
On the right is The Manager Trap: waiting for a boss in an office to dictate orders. It crushes creativity and ignores what teachers actually see in class.
In the middle is Our Way: The Advice Process. You listen deeply to advice, but you move fast and take ownership.

And what happens when two teammates strongly disagree? We have three simple steps:
First: Talk over a coffee. Have a warm, private chat within 24 hours. Focus on the work, not on personal blame.
Second: Bring in a trusted peer. If you're still stuck, invite a calm colleague to sit with you both and listen with fresh ears.
Third: Test it with real students! Instead of arguing opinions back and forth, put both versions in front of real learners. Let actual student learning settle the debate.""",

    r"""To make this real, here is our social contract—what we promise to you, and what we choose to leave behind.

What you can always count on:
1. Full trust to try your ideas without asking for sign-off.
2. Thoughtful help and advice whenever you reach out.
3. Total respect for your personal time and rest—no evening or weekend expectations.
4. Kind, honest support where you can speak your mind safely.

And what we leave behind:
1. No hovering managers, timesheets, or performative seat-time.
2. No endless debate meetings that go nowhere.
3. No silent overtime or guilt about logging off on time.
4. No polite silence that hides problems. We speak up with kindness to keep our materials top quality.""",

    r"""Without a supervisor grading our work, how do we ensure our learning materials are truly world-class? We use three simple, objective checks:

Check Number 1 is The Blind Ear Test. Close your eyes and listen to your teammate's audio example without looking at the text. Can you clearly hear every word and sound contrast? If an experienced teacher has to strain to understand it, our students definitely will.

Check Number 2 is The Dictation Check. Play the audio into your phone's voice typing app. Speech recognition tools have zero personal bias. If the app mishears the word, the audio sample needs more clarity and natural pacing.

Check Number 3 is Testing with Students. Put the lesson in front of a real learner and watch quietly without stepping in. If the student gets confused, remember our golden rule: it is never the student's fault. It just means we need to make our explanation clearer.

When we let real student learning be our judge, we stop arguing about personal opinions and unite around making great learning experiences.""",

    r"""Finally, let's look ahead to our rhythm for Month 2.

We adopt the sustainable rhythm that Ken Birdwell established at Valve:
Monday through Thursday: We focus four to five hours a day collaborating in our small group hubs, with time to reflect.
Friday: 100% protected quiet focus. Zero meetings. Time for you to read, experiment with new ideas, polish your own drafts, or recharge.
Evenings and weekends: True downtime. Notifications off. As Ken Birdwell said: 'Six focused hours of teamwork beats sixty hours of exhausted grinding every single time.'

Our goals for Month 2 are simple: getting comfortable with the Advice Process, creating engaging lessons students genuinely love, and building a culture of caring, honest feedback.

We are doing something rare and wonderful here: proving that passionate educators don't need bosses to create extraordinary learning. We succeed by supporting each other, talking through challenges openly, and having fun together.

Thank you all for an incredible Month 1. Let's make Month 2 our best month yet!""",

]

def build_presentation():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Asset Image Paths
    img_hero = r"C:\Users\Admin\.gemini\antigravity\brain\22e12183-dfc4-4430-9c2d-a5520fa49367\editorial_flatland_teachers_1789029163615.jpg"
    img_v1 = r"C:\Users\Admin\.gemini\antigravity\brain\22e12183-dfc4-4430-9c2d-a5520fa49367\permission_reflex_vignette_1789029191014.jpg"
    img_v2 = r"C:\Users\Admin\.gemini\antigravity\brain\22e12183-dfc4-4430-9c2d-a5520fa49367\phantom_guilt_vignette_1789029207946.jpg"
    img_v3 = r"C:\Users\Admin\.gemini\antigravity\brain\22e12183-dfc4-4430-9c2d-a5520fa49367\candor_dialogue_vignette_1789029225997.jpg"

    # Speaker Portrait Plates
    plate_dir = r"C:\Cursor AI\assets\speaker_portraits\plates"
    plate_chet = os.path.join(plate_dir, "chet_plate.jpg")
    plate_weier = os.path.join(plate_dir, "weier_plate.jpg")
    plate_morasky = os.path.join(plate_dir, "morasky_plate.jpg")
    plate_wolpaw = os.path.join(plate_dir, "wolpaw_plate.jpg")
    plate_geldreich = os.path.join(plate_dir, "geldreich_plate.jpg")
    plate_freeman = os.path.join(plate_dir, "freeman_plate.jpg")
    plate_laloux = os.path.join(plate_dir, "laloux_plate.jpg")
    plate_birdwell = os.path.join(plate_dir, "birdwell_plate.jpg")
    plate_gabe = os.path.join(plate_dir, "gabe_newell_plate.png")
    if not os.path.exists(plate_gabe):
        plate_gabe = os.path.join(plate_dir, "gabe_newell_plate.jpg")

    # Editorial Warm Color Palette
    C_BG = RGBColor(250, 248, 245)          # Warm cream / ivory background
    C_CARD = RGBColor(255, 255, 255)        # Crisp paper white
    C_CARD_BORDER = RGBColor(226, 221, 214) # Subtle warm grey border
    C_DARK = RGBColor(26, 29, 32)           # Deep charcoal text
    C_MUTED = RGBColor(95, 100, 110)        # Slate muted body text
    C_TERRA = RGBColor(168, 67, 43)         # Terracotta accent
    C_TERRA_LIGHT = RGBColor(253, 242, 240) # Terracotta soft wash
    C_AMBER = RGBColor(180, 83, 9)          # Warm amber
    C_AMBER_LIGHT = RGBColor(254, 243, 199) # Warm amber soft wash
    C_SLATE = RGBColor(30, 58, 95)          # Navy slate
    C_SLATE_LIGHT = RGBColor(238, 242, 246) # Slate soft wash
    C_GREEN = RGBColor(22, 101, 52)         # Forest sage green
    C_GREEN_LIGHT = RGBColor(236, 253, 245) # Forest green soft wash
    C_BANNER_BG = RGBColor(243, 239, 233)   # Soft parchment banner
    C_LINE = RGBColor(205, 200, 190)        # Subtle line

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
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = C_TERRA
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(22) if len(title) > 55 else (Pt(25) if len(title) > 45 else Pt(28))
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(3)

        p = tf.add_paragraph()
        p.text = subtitle
        p.font.name = "Segoe UI"
        p.font.size = Pt(13)
        p.font.color.rgb = C_MUTED

    def add_banner(slide, y_pos, title, text, accent=C_DARK, bg_color=C_BANNER_BG):
        ban = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), y_pos, Inches(11.733), Inches(0.72))
        ban.fill.solid()
        ban.fill.fore_color.rgb = bg_color
        ban.line.color.rgb = C_CARD_BORDER
        ban.line.width = Pt(1)

        btf = ban.text_frame
        btf.word_wrap = True
        btf.margin_left = btf.margin_right = Inches(0.25)
        btf.margin_top = Inches(0.08)
        btf.margin_bottom = Inches(0.08)

        p = btf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = title
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(11)
        p.font.color.rgb = accent
        p.space_after = Pt(2)

        p = btf.add_paragraph()
        p.alignment = PP_ALIGN.CENTER
        p.text = text
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.color.rgb = C_MUTED

    def add_reflection_slide(slide, eyebrow, title, subtitle, img_path,
                             monologue_tag, monologue_quote,
                             pill_text, pill_col, pill_bg,
                             right_title,
                             old_title, old_desc,
                             new_title, new_desc,
                             shift_quote):
        set_slide_bg(slide)
        add_header(slide, eyebrow, title, subtitle)

        # Left Column: Vignette Photo + Thought Monologue Card
        col_l_x = Inches(0.8)
        col_l_w = Inches(4.70)

        if os.path.exists(img_path):
            img_h = Inches(2.65)
            slide.shapes.add_picture(img_path, col_l_x, Inches(1.80), col_l_w, img_h)
            fr = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, col_l_x, Inches(1.80), col_l_w, img_h)
            fr.fill.background()
            fr.line.color.rgb = C_CARD_BORDER
            fr.line.width = Pt(1)

        thought_y = Inches(4.62)
        thought_h = Inches(2.38)
        thought_box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, col_l_x, thought_y, col_l_w, thought_h)
        thought_box.fill.solid()
        thought_box.fill.fore_color.rgb = pill_bg
        thought_box.line.color.rgb = pill_col
        thought_box.line.width = Pt(1.5)

        ttf = thought_box.text_frame
        ttf.word_wrap = True
        ttf.margin_left = ttf.margin_right = Inches(0.22)
        ttf.margin_top = Inches(0.14)

        p = ttf.paragraphs[0]
        p.text = "💭 " + monologue_tag
        p.font.name = "Segoe UI"
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = pill_col
        p.space_after = Pt(4)

        p = ttf.add_paragraph()
        p.text = f"“{monologue_quote}”"
        p.font.name = "Georgia"
        p.font.size = Pt(12)
        p.font.italic = True
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.22

        # Right Column: Pill Badge + Title + 3 Open Cards
        col_r_x = Inches(5.80)
        col_r_w = Inches(6.733)

        pill = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, col_r_x, Inches(1.78), Inches(3.20), Inches(0.32))
        pill.fill.solid()
        pill.fill.fore_color.rgb = pill_bg
        pill.line.color.rgb = pill_col
        pill.line.width = Pt(0.75)
        ptf = pill.text_frame
        ptf.margin_left = ptf.margin_right = ptf.margin_top = ptf.margin_bottom = 0
        p = ptf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = pill_text
        p.font.name = "Segoe UI"
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = pill_col

        tb_rt = slide.shapes.add_textbox(col_r_x, Inches(2.16), col_r_w, Inches(0.42))
        rt_tf = tb_rt.text_frame
        rt_tf.word_wrap = True
        rt_tf.margin_left = rt_tf.margin_right = rt_tf.margin_top = rt_tf.margin_bottom = 0
        p = rt_tf.paragraphs[0]
        p.text = right_title
        p.font.name = "Georgia"
        p.font.size = Pt(18)
        p.font.bold = True
        p.font.color.rgb = C_DARK

        # Card 1: Old Reflex
        b_old = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, col_r_x, Inches(2.78), col_r_w, Inches(1.18))
        b_old.fill.solid()
        b_old.fill.fore_color.rgb = RGBColor(254, 242, 242)
        b_old.line.color.rgb = C_TERRA
        b_old.line.width = Pt(1)
        otf = b_old.text_frame
        otf.word_wrap = True
        otf.margin_left = otf.margin_right = Inches(0.20)
        otf.margin_top = Inches(0.12)
        p = otf.paragraphs[0]
        p.text = "❌ OLD HABIT: " + old_title
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(12)
        p.font.color.rgb = C_TERRA
        p.space_after = Pt(2)
        p = otf.add_paragraph()
        p.text = old_desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11.5)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.16

        # Card 2: New Norm
        b_new = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, col_r_x, Inches(4.10), col_r_w, Inches(1.24))
        b_new.fill.solid()
        b_new.fill.fore_color.rgb = C_GREEN_LIGHT
        b_new.line.color.rgb = C_GREEN
        b_new.line.width = Pt(1.5)
        ntf = b_new.text_frame
        ntf.word_wrap = True
        ntf.margin_left = ntf.margin_right = Inches(0.20)
        ntf.margin_top = Inches(0.12)
        p = ntf.paragraphs[0]
        p.text = "✓ OUR NEW WAY: " + new_title
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(12.5)
        p.font.color.rgb = C_GREEN
        p.space_after = Pt(2)
        p = ntf.add_paragraph()
        p.text = new_desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11.5)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.16

        # Card 3: Mindset Shift
        b_shift = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, col_r_x, Inches(5.48), col_r_w, Inches(1.42))
        b_shift.fill.solid()
        b_shift.fill.fore_color.rgb = C_BANNER_BG
        b_shift.line.color.rgb = C_CARD_BORDER
        b_shift.line.width = Pt(1)
        stf = b_shift.text_frame
        stf.word_wrap = True
        stf.margin_left = stf.margin_right = Inches(0.20)
        stf.margin_top = Inches(0.12)
        p = stf.paragraphs[0]
        p.text = "🔑 THE MINDSET SHIFT:"
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(2)
        p = stf.add_paragraph()
        p.text = shift_quote
        p.font.name = "Georgia"
        p.font.italic = True
        p.font.size = Pt(12.5)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.22

    # =========================================================================
    # SLIDE 1: Title Cover & Executive Architecture
    # =========================================================================
    s1 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s1)

    left_x = Inches(0.8)
    left_w = Inches(6.3)

    tb1 = s1.shapes.add_textbox(left_x, Inches(0.70), left_w, Inches(2.55))
    tf1 = tb1.text_frame
    tf1.word_wrap = True
    tf1.margin_left = tf1.margin_right = tf1.margin_top = tf1.margin_bottom = 0

    p = tf1.paragraphs[0]
    p.text = "OUR FIRST MONTH TOGETHER • TEAMWORK & PRACTICAL HABITS"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = C_TERRA
    p.space_after = Pt(6)

    p = tf1.add_paragraph()
    p.text = "Working Together Without a Boss"
    p.font.name = "Georgia"
    p.font.size = Pt(35)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(4)

    p = tf1.add_paragraph()
    p.text = "Honest Reflections on Month 1, Everyday Hurdles, and Practical Solutions"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(15.5)
    p.font.color.rgb = C_SLATE
    p.space_after = Pt(8)

    p = tf1.add_paragraph()
    p.text = (
        "A warm, honest look at what happens when you remove managers: the quiet confusion, "
        "the everyday team friction, and the simple habits that help us thrive as equal partners."
    )
    p.font.name = "Segoe UI"
    p.font.size = Pt(11.5)
    p.font.color.rgb = C_MUTED
    p.line_spacing = 1.22

    matrix_y = Inches(3.60)
    row_h = Inches(1.10)
    row_gap = Inches(0.12)

    arch_rows = [
        (
            "01 THE FEELING",
            "Freedom Feels Strange at First",
            "No one telling you what to do can feel quiet, disorienting, or a little scary. That awkwardness is completely normal.",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "02 THE CHALLENGES",
            "Everyday Teamwork Friction",
            "Waiting for permission, feeling quiet guilt at 3 PM, holding back honest feedback, or getting stuck in endless debates.",
            C_TERRA,
            C_TERRA_LIGHT
        ),
        (
            "03 THE SOLUTIONS",
            "Simple, Practical Habits",
            "Asking for advice, speaking with kindness and honesty, building together in real-time, and protecting our rest.",
            C_GREEN,
            C_GREEN_LIGHT
        )
    ]

    for i, (tag, title, desc, tag_c, bg_c) in enumerate(arch_rows):
        ry = matrix_y + i * (row_h + row_gap)
        row_box = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left_x, ry, left_w, row_h)
        row_box.fill.solid()
        row_box.fill.fore_color.rgb = C_CARD
        row_box.line.color.rgb = C_CARD_BORDER
        row_box.line.width = Pt(1)

        stripe = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left_x, ry, Inches(0.15), row_h)
        stripe.fill.solid()
        stripe.fill.fore_color.rgb = tag_c
        stripe.line.fill.background()

        rtb = s1.shapes.add_textbox(left_x + Inches(0.28), ry + Inches(0.10), left_w - Inches(0.42), row_h - Inches(0.20))
        rtf = rtb.text_frame
        rtf.word_wrap = True
        rtf.margin_left = rtf.margin_right = rtf.margin_top = rtf.margin_bottom = 0

        p = rtf.paragraphs[0]
        p.text = tag
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = tag_c
        p.space_after = Pt(2)

        p = rtf.add_paragraph()
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(14)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(2)

        p = rtf.add_paragraph()
        p.text = desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.16

    # Right Hero Section
    right_x = Inches(7.40)
    right_w = Inches(5.133)

    if os.path.exists(img_hero):
        img_w = right_w
        img_h = Inches(2.95)
        s1.shapes.add_picture(img_hero, right_x, Inches(0.85), img_w, img_h)

        frame_box = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, right_x, Inches(0.85), img_w, img_h)
        frame_box.fill.background()
        frame_box.line.color.rgb = C_CARD_BORDER
        frame_box.line.width = Pt(1)

        cap_box = s1.shapes.add_textbox(right_x, Inches(3.90), img_w, Inches(0.55))
        ctf = cap_box.text_frame
        ctf.word_wrap = True
        ctf.margin_left = ctf.margin_right = ctf.margin_top = ctf.margin_bottom = 0
        cp = ctf.paragraphs[0]
        cp.text = "“Leaving traditional hierarchy behind: colleagues sitting together as equal partners, learning how to collaborate openly.”"
        cp.font.name = "Georgia"
        cp.font.italic = True
        cp.font.size = Pt(11)
        cp.font.color.rgb = C_DARK

        q_box = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, right_x, Inches(4.55), img_w, Inches(1.70))
        q_box.fill.solid()
        q_box.fill.fore_color.rgb = C_BANNER_BG
        q_box.line.color.rgb = C_CARD_BORDER
        q_box.line.width = Pt(1)
        qtf = q_box.text_frame
        qtf.word_wrap = True
        qtf.margin_left = qtf.margin_right = Inches(0.22)
        qtf.margin_top = Inches(0.14)
        qp0 = qtf.paragraphs[0]
        qp0.text = "OUR CORE PROMISE AS A TEAM:"
        qp0.font.name = "Segoe UI"
        qp0.font.size = Pt(10)
        qp0.font.bold = True
        qp0.font.color.rgb = C_TERRA
        qp0.space_after = Pt(3)
        qp1 = qtf.add_paragraph()
        qp1.text = "“A flat team does not mean no direction. It means we all take care of each other, make decisions openly, and share the journey together.”"
        qp1.font.name = "Georgia"
        qp1.font.size = Pt(12.5)
        qp1.font.bold = True
        qp1.font.italic = True
        qp1.font.color.rgb = C_DARK
        qp1.line_spacing = 1.22

        chip_y = Inches(6.40)
        chip_w = (img_w - Inches(0.20)) / 2

        c1 = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, right_x, chip_y, chip_w, Inches(0.40))
        c1.fill.solid()
        c1.fill.fore_color.rgb = C_SLATE_LIGHT
        c1.line.color.rgb = C_SLATE
        c1.line.width = Pt(0.75)
        c1_tf = c1.text_frame
        c1_tf.margin_left = c1_tf.margin_right = c1_tf.margin_top = c1_tf.margin_bottom = 0
        p = c1_tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = "✓ MONTH 1: HONEST REFLECTIONS"
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = C_SLATE

        c2 = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, right_x + chip_w + Inches(0.20), chip_y, chip_w, Inches(0.40))
        c2.fill.solid()
        c2.fill.fore_color.rgb = C_GREEN_LIGHT
        c2.line.color.rgb = C_GREEN
        c2.line.width = Pt(0.75)
        c2_tf = c2.text_frame
        c2_tf.margin_left = c2_tf.margin_right = c2_tf.margin_top = c2_tf.margin_bottom = 0
        p = c2_tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = "🤝 TEAMWORK: WORKING AS EQUALS"
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = C_GREEN

    # =========================================================================
    # SLIDE 2: Setting the Scene
    # =========================================================================
    s2 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s2)
    add_header(
        s2,
        "Where We Are Today • Looking Back & Moving Forward",
        "The Shift: From Solo Teachers to a True Team",
        "Moving past the initial awkwardness and discovering how we actually support each other:"
    )

    card_y2 = Inches(1.65)
    card_h2 = Inches(4.50)
    col_w2 = Inches(5.68)

    left_box2 = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), card_y2, col_w2, card_h2)
    left_box2.fill.solid()
    left_box2.fill.fore_color.rgb = C_CARD
    left_box2.line.color.rgb = C_CARD_BORDER
    left_box2.line.width = Pt(1)

    pill_l2 = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.05), card_y2 + Inches(0.18), Inches(3.2), Inches(0.34))
    pill_l2.fill.solid()
    pill_l2.fill.fore_color.rgb = C_SLATE_LIGHT
    pill_l2.line.color.rgb = C_SLATE
    pill_l2.line.width = Pt(0.75)
    pl_tf = pill_l2.text_frame
    pl_tf.margin_left = pl_tf.margin_right = pl_tf.margin_top = pl_tf.margin_bottom = 0
    p = pl_tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "WHAT WE EXPERIENCED IN MONTH 1"
    p.font.name = "Segoe UI"
    p.font.size = Pt(9.5)
    p.font.bold = True
    p.font.color.rgb = C_SLATE

    ltb2 = s2.shapes.add_textbox(Inches(1.05), card_y2 + Inches(0.64), col_w2 - Inches(0.50), card_h2 - Inches(0.75))
    ltf2 = ltb2.text_frame
    ltf2.word_wrap = True
    ltf2.margin_left = ltf2.margin_right = ltf2.margin_top = ltf2.margin_bottom = 0

    p = ltf2.paragraphs[0]
    p.text = "The Awkward First Steps"
    p.font.name = "Georgia"
    p.font.size = Pt(21)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(6)

    pts_l = [
        ("Used to Teaching Alone: ", "In traditional schools, we closed our classroom doors and taught in private. Sharing rough, unfinished drafts with peers felt intimidating."),
        ("The Missing School Bell: ", "Without a supervisor checking in or assigning tasks, some days felt strangely quiet. We wondered if we were doing the 'right' thing."),
        ("Being Too Polite to Speak Up: ", "Because everyone wanted to be kind, we hesitated to give honest critiques, leaving important thoughts unsaid.")
    ]
    for bold_pre, norm_txt in pts_l:
        p = ltf2.add_paragraph()
        p.text = "• "
        p.font.name = "Segoe UI"
        p.font.size = Pt(11.5)
        p.font.color.rgb = C_SLATE
        r = p.add_run()
        r.text = bold_pre
        r.font.name = "Segoe UI Semibold"
        r.font.size = Pt(12)
        r.font.color.rgb = C_DARK
        r2 = p.add_run()
        r2.text = norm_txt
        r2.font.name = "Segoe UI"
        r2.font.size = Pt(11.5)
        r2.font.color.rgb = C_MUTED
        p.line_spacing = 1.16
        p.space_after = Pt(4)

    p = ltf2.add_paragraph()
    p.text = "“When you remove the traditional boss, the first thing you notice is the silence. You realize you have to learn how to talk to each other all over again.”"
    p.font.name = "Georgia"
    p.font.italic = True
    p.font.size = Pt(11.5)
    p.font.color.rgb = C_SLATE

    right_box2 = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.85), card_y2, col_w2, card_h2)
    right_box2.fill.solid()
    right_box2.fill.fore_color.rgb = C_GREEN_LIGHT
    right_box2.line.color.rgb = C_GREEN
    right_box2.line.width = Pt(1.5)

    pill_r2 = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(7.10), card_y2 + Inches(0.18), Inches(3.2), Inches(0.34))
    pill_r2.fill.solid()
    pill_r2.fill.fore_color.rgb = C_CARD
    pill_r2.line.color.rgb = C_GREEN
    pill_r2.line.width = Pt(1)
    pr_tf = pill_r2.text_frame
    pr_tf.margin_left = pr_tf.margin_right = pr_tf.margin_top = pr_tf.margin_bottom = 0
    p = pr_tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "HOW WE THRIVE IN MONTH 2"
    p.font.name = "Segoe UI"
    p.font.size = Pt(9.5)
    p.font.bold = True
    p.font.color.rgb = C_GREEN

    rtb2 = s2.shapes.add_textbox(Inches(7.10), card_y2 + Inches(0.64), col_w2 - Inches(0.50), card_h2 - Inches(0.75))
    rtf2 = rtb2.text_frame
    rtf2.word_wrap = True
    rtf2.margin_left = rtf2.margin_right = rtf2.margin_top = rtf2.margin_bottom = 0

    p = rtf2.paragraphs[0]
    p.text = "Finding Our Team Groove"
    p.font.name = "Georgia"
    p.font.size = Pt(21)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(6)

    pts_r = [
        ("Co-Creating, Not Working in Isolation: ", "We don't work alone in isolation anymore. We team up in small groups of 3 to 4 to design, test, and polish ideas together."),
        ("Clear Habits Instead of Guesswork: ", "We replace boss orders with simple team habits: clear ways to make decisions, give feedback, and solve disagreements."),
        ("Looking Out for Each Other's Rest: ", "True team success means high trust, honest conversations, and leaving work on time with zero guilt.")
    ]
    for bold_pre, norm_txt in pts_r:
        p = rtf2.add_paragraph()
        p.text = "✓ "
        p.font.name = "Segoe UI"
        p.font.size = Pt(11.5)
        p.font.color.rgb = C_GREEN
        r = p.add_run()
        r.text = bold_pre
        r.font.name = "Segoe UI Semibold"
        r.font.size = Pt(12)
        r.font.color.rgb = C_DARK
        r2 = p.add_run()
        r2.text = norm_txt
        r2.font.name = "Segoe UI"
        r2.font.size = Pt(11.5)
        r2.font.color.rgb = C_MUTED
        p.line_spacing = 1.16
        p.space_after = Pt(4)

    p = rtf2.add_paragraph()
    p.text = "“Working without a boss only works when we truly have each other's backs—sharing the load, speaking with kindness, and celebrating together.”"
    p.font.name = "Georgia"
    p.font.italic = True
    p.font.size = Pt(11.5)
    p.font.color.rgb = C_GREEN

    add_banner(
        s2,
        Inches(6.30),
        "💡 THE SIMPLE TRUTH: Working without a boss does not mean chaos or having no rules.",
        "It means we choose to be honest, communicate openly, and support one another instead of relying on a manager to police us.",
        accent=C_DARK
    )

    # =========================================================================
    # SLIDE 3: Reflection 1 — The Permission Reflex
    # =========================================================================
    s3 = prs.slides.add_slide(blank_layout)
    add_reflection_slide(
        s3,
        eyebrow="Month 1 Reflection • Taking Initiative",
        title='Reflection 1: The Permission Reflex ("Who Approves This?")',
        subtitle="“Wait... who is going to tell me what to work on next?” — Moving from waiting to taking action:",
        img_path=img_v1,
        monologue_tag="WHAT WE THOUGHT INSIDE (MONTH 1)",
        monologue_quote="Wait... who is going to tell me what to work on next? In every school I've ever taught at, the department head handed me a syllabus and told me what page to teach. Here, no one hands me tasks. What if I pick the wrong thing to fix?",
        pill_text="TEAMWORK SHIFT #1",
        pill_col=C_TERRA,
        pill_bg=C_TERRA_LIGHT,
        right_title="From Waiting for Orders to Taking Initiative",
        old_title="Waiting for the Green Light",
        old_desc="Conditioned by traditional schools to wait for someone to assign work, approve outlines, or sign off before trying a new teaching idea.",
        new_title="If You See a Need, You Can Start",
        new_desc="You have full trust to take action. If an activity confuses students, you don't need a manager's permission to improve it—talk with peers and test a fix.",
        shift_quote="“In our team, nobody assigns you work. You don't ask 'Am I allowed to help here?' If you see a way to make learning better, you own helping make it happen.”"
    )

    # =========================================================================
    # SLIDE 4: Reflection 2 — The Phantom Guilt
    # =========================================================================
    s4 = prs.slides.add_slide(blank_layout)
    add_reflection_slide(
        s4,
        eyebrow="Month 1 Reflection • Confidence & Rest",
        title='Reflection 2: The Quiet Guilt ("Am I Doing Enough?")',
        subtitle="“Nobody praised my work today. Does the team think I'm slacking?” — Finding confidence together:",
        img_path=img_v2,
        monologue_tag="WHAT WE THOUGHT INSIDE (MONTH 1)",
        monologue_quote="No one said 'great job' on my work today. Are my teammates happy with me? There are no performance reviews or teacher evaluations here. When I close my laptop at 3 PM, I feel an irrational urge to sit back down just so people see me online.",
        pill_text="TEAMWORK SHIFT #2",
        pill_col=C_AMBER,
        pill_bg=C_AMBER_LIGHT,
        right_title="From Seeking Praise to Real Mutual Trust",
        old_title="Working for Supervisory Approval",
        old_desc="Relying on manager compliments, annual review scores, and visible 'chair time' to feel secure about our professional worth.",
        new_title="Mutual Trust & Honest Boundaries",
        new_desc="Trusting that your teammates value you. We measure our impact by whether students are learning, not by how many late hours we spend at our desks.",
        shift_quote="“You don't need a manager's gold star to know your work matters. Do good work, support your peers, and close your laptop on time with a clear mind.”"
    )

    # =========================================================================
    # SLIDE 5: Reflection 3 — The Politeness Trap
    # =========================================================================
    s5 = prs.slides.add_slide(blank_layout)
    add_reflection_slide(
        s5,
        eyebrow="Month 1 Reflection • Honest Feedback",
        title="Reflection 3: The Politeness Trap (\"I Don't Want to Hurt Feelings\")",
        subtitle="“If I point out a mistake, will they take it personally?” — Caring for the person while being honest about the work:",
        img_path=img_v3,
        monologue_tag="WHAT WE THOUGHT INSIDE (MONTH 1)",
        monologue_quote="If I tell my colleague their audio script or exercise is confusing, will they get upset? We all like each other and want to be friendly. Maybe I should just stay quiet, say 'looks nice,' and avoid any awkwardness.",
        pill_text="TEAMWORK SHIFT #3",
        pill_col=C_SLATE,
        pill_bg=C_SLATE_LIGHT,
        right_title="Critique the Work, Care for Each Other",
        old_title="Polite Silence & Avoiding Awkwardness",
        old_desc="Smiling through differences, holding back honest thoughts, and letting confusing lesson materials slip through just to keep the peace.",
        new_title="Kind Honesty & Warm Support",
        new_desc="Sharing clear, constructive feedback because you want your teammates and students to succeed, while offering unconditional warmth as colleagues.",
        shift_quote="“Staying silent when you spot an issue isn't kindness—it leaves your teammate hanging. Be honest about the work, and be kind and supportive to the person.”"
    )

    # =========================================================================
    # SLIDE 6: Welcome to Flatland — Introducing Valve's Flat Model
    # =========================================================================
    s6_intro = prs.slides.add_slide(blank_layout)
    set_slide_bg(s6_intro)
    add_header(
        s6_intro,
        "Foundational Inspiration • The Valve Model",
        "Welcome to Flatland: How Valve Works Without Bosses",
        "For 30 years, Valve proved that creative teams don't need managers to build world-class work:"
    )

    card_y = Inches(1.72)
    card_h = Inches(4.35)
    card_w = Inches(3.68)
    card_gap = Inches(0.34)

    pillars = [
        (
            "01 • ZERO MANAGERS",
            "Total Trust & Ownership",
            "✦ Trusted as a creative adult",
            [
                ("Direct ownership: ", "No supervisors checking lesson plans or assigning daily tasks."),
                ("See a problem, fix it: ", "You don't need anyone's permission to improve a confusing lesson."),
                ("Peer trust: ", "We answer to our students and each other, not a boss in an office.")
            ],
            "“We don't have any management, and nobody reports to anybody else.”",
            "Valve Handbook for New Employees",
            C_TERRA,
            C_TERRA_LIGHT
        ),
        (
            "02 • DESKS ON WHEELS",
            "Fluid Small Groups",
            "✦ Rolling to where help is needed",
            [
                ("Flexible small groups: ", "Teachers form small hubs around specific lessons and move on when done."),
                ("Rolling to the need: ", "When a colleague is stuck or needs audio ears, roll over and pitch in."),
                ("Voluntary initiative: ", "You choose where your unique teaching strengths make the biggest impact.")
            ],
            "“Because you must decide what to work on, desks are on wheels to make moving easy.”",
            "Welcome to Flatland (1996–Present)",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "03 • LEARNER FIRST",
            "The True North Star",
            "✦ Student impact over politics",
            [
                ("Student is the boss: ", "We measure success by learner growth, not by manager checklists."),
                ("Zero office politics: ", "Without supervisors to impress, there are no internal ladders or games."),
                ("Freedom with care: ", "Autonomy works only when teammates share early and support each other.")
            ],
            "“The customer is the only boss. Focus entirely on delivering delight to learners.”",
            "Valve Core Philosophy",
            C_GREEN,
            C_GREEN_LIGHT
        )
    ]

    for i, (badge_txt, title, subtitle, bullets, quote, quote_attr, col, bg_col) in enumerate(pillars):
        cx = Inches(0.8) + i * (card_w + card_gap)
        cbox = s6_intro.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, card_y, card_w, card_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        pill_w = card_w - Inches(0.40)
        pill = s6_intro.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.20), card_y + Inches(0.18), pill_w, Inches(0.34))
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
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = col

        # Body: Title, Subtitle, and Bullets
        q_h = Inches(0.88)
        q_y = card_y + card_h - q_h - Inches(0.14)
        body_h = q_y - (card_y + Inches(0.56)) - Inches(0.04)

        tb = s6_intro.shapes.add_textbox(cx + Inches(0.20), card_y + Inches(0.56), card_w - Inches(0.40), body_h)
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(19)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = subtitle
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(10)
        p.font.color.rgb = col
        p.space_after = Pt(5)

        for bold_pre, norm_txt in bullets:
            p = tf.add_paragraph()
            p.text = "• "
            p.font.name = "Segoe UI"
            p.font.size = Pt(9.5)
            p.font.color.rgb = col
            r = p.add_run()
            r.text = bold_pre
            r.font.name = "Segoe UI Semibold"
            r.font.size = Pt(10)
            r.font.color.rgb = C_DARK
            r2 = p.add_run()
            r2.text = norm_txt
            r2.font.name = "Segoe UI"
            r2.font.size = Pt(9.5)
            r2.font.color.rgb = C_MUTED
            p.line_spacing = 1.15
            p.space_after = Pt(4)

        # Dedicated Quote Anchor Card at Bottom
        q_w = card_w - Inches(0.36)
        q_x = cx + Inches(0.18)
        q_box = s6_intro.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, q_x, q_y, q_w, q_h)
        q_box.fill.solid()
        q_box.fill.fore_color.rgb = bg_col
        q_box.line.color.rgb = col
        q_box.line.width = Pt(0.75)

        tb_q = s6_intro.shapes.add_textbox(q_x + Inches(0.14), q_y + Inches(0.06), q_w - Inches(0.28), q_h - Inches(0.12))
        qtf = tb_q.text_frame
        qtf.word_wrap = True
        qtf.margin_left = qtf.margin_right = qtf.margin_top = qtf.margin_bottom = 0

        p = qtf.paragraphs[0]
        p.text = quote
        p.font.name = "Georgia"
        p.font.size = Pt(9)
        p.font.italic = True
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.12
        p.space_after = Pt(2)

        p = qtf.add_paragraph()
        p.text = f"— {quote_attr}"
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(8.5)
        p.font.color.rgb = col

    # Bottom Bridge Banner Connecting Valve to Teachers
    banner_y = Inches(6.20)
    ban_box = s6_intro.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), banner_y, Inches(11.733), Inches(0.90))
    ban_box.fill.solid()
    ban_box.fill.fore_color.rgb = C_BANNER_BG
    ban_box.line.color.rgb = C_CARD_BORDER
    ban_box.line.width = Pt(1)

    ban_tf = ban_box.text_frame
    ban_tf.word_wrap = True
    ban_tf.margin_left = ban_tf.margin_right = Inches(0.25)
    ban_tf.margin_top = Inches(0.08)

    p = ban_tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "💡 WHY THIS MATTERS FOR OUR TEACHING TEAM"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10)
    p.font.bold = True
    p.font.color.rgb = C_TERRA
    p.space_after = Pt(2)

    p = ban_tf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "“We aren't making video games, but creative teaching requires the exact same trust. Freedom from bosses only works when we stay connected, share our work early, and look out for each other as true partners.”"
    p.font.name = "Georgia"
    p.font.size = Pt(11.5)
    p.font.italic = True
    p.font.bold = True
    p.font.color.rgb = C_DARK

    # =========================================================================
    # SLIDE 7: Gabe Newell's Ideology — Why Hierarchies Destroy Creative Value
    # =========================================================================
    s_gabe = prs.slides.add_slide(blank_layout)
    set_slide_bg(s_gabe)
    add_header(
        s_gabe,
        "Foundational Philosophy • The Economic & Creative Logic",
        "Gabe Newell's Ideology: Why Hierarchies Destroy Creative Value",
        "From Ronald Coase's transaction costs to human leverage: why Valve eliminated bosses to unleash potential"
    )

    # Left Column: Founder Profile & Hero Quote Card
    left_x = Inches(0.8)
    left_w = Inches(3.60)
    left_y = Inches(1.72)
    left_h = Inches(4.35)

    c_founder = s_gabe.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left_x, left_y, left_w, left_h)
    c_founder.fill.solid()
    c_founder.fill.fore_color.rgb = C_CARD
    c_founder.line.color.rgb = C_TERRA
    c_founder.line.width = Pt(1.5)

    # Pill at top of left card
    pill_w = left_w - Inches(0.36)
    pill = s_gabe.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left_x + Inches(0.18), left_y + Inches(0.14), pill_w, Inches(0.28))
    pill.fill.solid()
    pill.fill.fore_color.rgb = C_TERRA_LIGHT
    pill.line.color.rgb = C_TERRA
    pill.line.width = Pt(0.75)
    ptf = pill.text_frame
    ptf.margin_left = ptf.margin_right = ptf.margin_top = ptf.margin_bottom = 0
    p = ptf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "✦ THE FOUNDER'S VISION & LOGIC"
    p.font.name = "Segoe UI"
    p.font.size = Pt(8.5)
    p.font.bold = True
    p.font.color.rgb = C_TERRA

    # Portrait Plate (4:5 ratio)
    pw = Inches(1.76)
    ph = Inches(2.20)
    px = left_x + (left_w - pw) / 2
    py = left_y + Inches(0.48)
    if os.path.exists(plate_gabe):
        s_gabe.shapes.add_picture(plate_gabe, px, py, pw, ph)
        pfr = s_gabe.shapes.add_shape(MSO_SHAPE.RECTANGLE, px, py, pw, ph)
        pfr.fill.background()
        pfr.line.color.rgb = C_CARD_BORDER
        pfr.line.width = Pt(1)

    # Name & Subtitle
    tb_name = s_gabe.shapes.add_textbox(left_x + Inches(0.18), py + ph + Inches(0.04), left_w - Inches(0.36), Inches(0.42))
    ntf = tb_name.text_frame
    ntf.word_wrap = True
    ntf.margin_left = ntf.margin_right = ntf.margin_top = ntf.margin_bottom = 0
    p = ntf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "Gabe Newell"
    p.font.name = "Georgia"
    p.font.size = Pt(14.5)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(1)

    p = ntf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "Co-Founder & CEO • Valve Corporation"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(8.5)
    p.font.color.rgb = C_TERRA

    # Hero Quote Box at bottom of left column
    qb_y = py + ph + Inches(0.50)
    qb_h = left_y + left_h - qb_y - Inches(0.14)
    qb = s_gabe.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left_x + Inches(0.16), qb_y, left_w - Inches(0.32), qb_h)
    qb.fill.solid()
    qb.fill.fore_color.rgb = C_BANNER_BG
    qb.line.color.rgb = C_CARD_BORDER
    qb.line.width = Pt(0.75)
    qtf = qb.text_frame
    qtf.word_wrap = True
    qtf.margin_left = qtf.margin_right = Inches(0.14)
    qtf.margin_top = Inches(0.07)
    qtf.margin_bottom = Inches(0.05)

    p = qtf.paragraphs[0]
    p.text = "“If you hire smart, creative people and then tell them what to do, you destroy most of their value. You want people who figure out what is valuable and just go do it.”"
    p.font.name = "Georgia"
    p.font.size = Pt(8.25)
    p.font.italic = True
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.line_spacing = 1.15
    p.space_after = Pt(2)

    p = qtf.add_paragraph()
    p.text = "— Gabe Newell (University of Texas & Washington Post)"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(7.5)
    p.font.color.rgb = C_TERRA

    # Right Column: 3 Strategic Cards
    right_x = left_x + left_w + Inches(0.24)
    right_w = Inches(11.733) - left_w - Inches(0.24)
    card_h = Inches(1.37)
    gap = Inches(0.12)

    cards_data = [
        (
            "01 • TRANSACTION COSTS",
            Inches(2.15),
            C_SLATE,
            C_SLATE_LIGHT,
            "Why Traditional Hierarchies Break in Creative Work",
            [
                ("The Industrial Legacy: ", "Ronald Coase showed firms exist to cut transaction costs. Hierarchies worked for factories, but in creative education, corporate managers actually introduce massive friction, red tape, and delay."),
                ("Zero Internal Friction: ", "By eliminating middle management, Valve operates as an agile internal network. Ideas move at the speed of direct conversation without waiting weeks for supervisor approvals.")
            ]
        ),
        (
            "02 • CREATIVE LEVERAGE",
            Inches(1.95),
            C_TERRA,
            C_TERRA_LIGHT,
            "Autonomy Multiplies Creative Leverage Over Direct Orders",
            [
                ("The Management Bottleneck: ", "When supervisors dictate daily tasks, educators can only produce what one manager imagines. Dictating tasks to masters caps their creative output at average execution."),
                ("Unlocking Full Leverage: ", "When educators own their curriculum directly, their impact multiplies. They spot subtle student confusions, craft engaging pronunciation games, and take personal pride in every outcome.")
            ]
        ),
        (
            "03 • LEARNER FIRST",
            Inches(1.65),
            C_GREEN,
            C_GREEN_LIGHT,
            "Eliminating Office Politics to Focus 100% on the Student",
            [
                ("Ending 'Managing Up': ", "In corporate ladders, people waste half their mental energy managing impressions and pleasing bosses. Without managers, internal politics and defensive turf wars evaporate."),
                ("One True North Star: ", "100% of energy is directed outward: “Does this genuinely help students learn?” When the learner is the only judge, quality remains uncompromising and transparent.")
            ]
        )
    ]

    for i, (badge_txt, pill_w_r, col, bg_col, title, bullets) in enumerate(cards_data):
        cy = left_y + i * (card_h + gap)
        cbox = s_gabe.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, right_x, cy, right_w, card_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        # Header Pill
        pill_r = s_gabe.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, right_x + Inches(0.16), cy + Inches(0.12), pill_w_r, Inches(0.26))
        pill_r.fill.solid()
        pill_r.fill.fore_color.rgb = bg_col
        pill_r.line.color.rgb = col
        pill_r.line.width = Pt(0.75)
        prtf = pill_r.text_frame
        prtf.margin_left = prtf.margin_right = prtf.margin_top = prtf.margin_bottom = 0
        p = prtf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = badge_txt
        p.font.name = "Segoe UI"
        p.font.size = Pt(8.5)
        p.font.bold = True
        p.font.color.rgb = col

        # Card Title next to pill
        title_x = right_x + Inches(0.16) + pill_w_r + Inches(0.14)
        title_w = right_w - Inches(0.30) - pill_w_r - Inches(0.14)
        tb_t = s_gabe.shapes.add_textbox(title_x, cy + Inches(0.10), title_w, Inches(0.28))
        ttf = tb_t.text_frame
        ttf.word_wrap = True
        ttf.margin_left = ttf.margin_right = ttf.margin_top = ttf.margin_bottom = 0
        p = ttf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(12)
        p.font.bold = True
        p.font.color.rgb = C_DARK

        # Bullets below
        tb_b = s_gabe.shapes.add_textbox(right_x + Inches(0.16), cy + Inches(0.44), right_w - Inches(0.32), card_h - Inches(0.48))
        btf = tb_b.text_frame
        btf.word_wrap = True
        btf.margin_left = btf.margin_right = btf.margin_top = btf.margin_bottom = 0

        for j, (b_lead, b_body) in enumerate(bullets):
            p = btf.paragraphs[0] if j == 0 else btf.add_paragraph()
            p.text = "• "
            p.font.name = "Segoe UI"
            p.font.size = Pt(9)
            p.font.color.rgb = col
            r1 = p.add_run()
            r1.text = b_lead
            r1.font.name = "Segoe UI Semibold"
            r1.font.size = Pt(9.5)
            r1.font.color.rgb = C_DARK
            r2 = p.add_run()
            r2.text = b_body
            r2.font.name = "Segoe UI"
            r2.font.size = Pt(9)
            r2.font.color.rgb = C_MUTED
            p.line_spacing = 1.14
            p.space_after = Pt(2.5)

    # Bottom Unifying Bridge Banner
    banner_y = Inches(6.20)
    ban_box = s_gabe.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), banner_y, Inches(11.733), Inches(0.90))
    ban_box.fill.solid()
    ban_box.fill.fore_color.rgb = C_BANNER_BG
    ban_box.line.color.rgb = C_CARD_BORDER
    ban_box.line.width = Pt(1)

    ban_tf = ban_box.text_frame
    ban_tf.word_wrap = True
    ban_tf.margin_left = ban_tf.margin_right = Inches(0.25)
    ban_tf.margin_top = Inches(0.08)

    p = ban_tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "💡 HOW GABE'S FOUNDING LOGIC EMPOWERS OUR TEACHING TEAM"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10)
    p.font.bold = True
    p.font.color.rgb = C_TERRA
    p.space_after = Pt(2)

    p = ban_tf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "“We aren't making software, but educational design is deeply creative knowledge work. You don't need an administrator's permission slip to make a lesson better. When we trust each other as equals, our students get the very best curriculum.”"
    p.font.name = "Georgia"
    p.font.size = Pt(11)
    p.font.italic = True
    p.font.bold = True
    p.font.color.rgb = C_DARK

    # =========================================================================
    # SLIDE 8: Voices from Flatland — Wisdom from Experienced Creators
    # =========================================================================
    s6 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s6)
    add_header(
        s6,
        "Voices of Experience • Teamwork Lessons",
        "Wisdom on Teamwork: Advice from Veteran Creators",
        "Practical advice from experienced creators on autonomy, collaboration, and staying healthy:"
    )

    v_w = Inches(2.70)
    v_gap = Inches(0.31)
    v_y = Inches(1.75)
    v_h = Inches(5.30)

    veterans = [
        (
            "✦ ACTION OVER PERMISSION",
            "Chet Faliszek",
            "Writer & Team Lead • Left 4 Dead, Portal",
            plate_chet,
            "“Nobody is going to hand you a daily to-do list. When you see something confusing or broken, don't wait for permission. Grab a teammate, try a fix, and see if it works.”",
            "Don't Wait to Be Asked",
            "If you notice a lesson isn't landing with students, step forward and start improving it with your peers.",
            C_TERRA,
            C_TERRA_LIGHT
        ),
        (
            "✦ HEALTHY BOUNDARIES",
            "Josh Weier",
            "Project Lead • Portal 2, Half-Life 2",
            plate_weier,
            "“If someone is answering emails at 2 AM, nobody thinks they're a hero. We think the workflow is broken. Great teams protect their rest so they stay creative.”",
            "Protect Your Energy",
            "Four or five hours of focused teamwork beats twelve hours of exhausted, distracted grinding every time.",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "✦ WORKING LIVE TOGETHER",
            "Mike Morasky",
            "Audio Director • Portal 2, TF2",
            plate_morasky,
            "“Collaboration isn't an email thread or a boring meeting. It's sitting together, trying an idea, and reacting in real-time. You build off each other's energy.”",
            "Real-Time Collaboration",
            "Work together on a live document or call instead of passing files back and forth for three weeks.",
            C_AMBER,
            C_AMBER_LIGHT
        ),
        (
            "✦ LEAVING EGOS AT THE DOOR",
            "Erik Wolpaw",
            "Lead Writer • Portal 1 & 2",
            plate_wolpaw,
            "“Leave your ego outside the room. If you create an exercise and students get confused or bored, don't get defensive. Laugh, adjust it, and make it better together.”",
            "Stay Open & Curious",
            "Don't fall in love with your first draft. When students struggle, take it as helpful learning and improve it as a team.",
            C_GREEN,
            C_GREEN_LIGHT
        )
    ]

    for i, (badge_txt, name, credits, plate_img, quote, takeaway_hdr, takeaway_txt, col, bg_col) in enumerate(veterans):
        cx = Inches(0.8) + i * (v_w + v_gap)
        cbox = s6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, v_y, v_w, v_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        # Top Badge Pill
        pill_w = v_w - Inches(0.24)
        pill = s6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.12), v_y + Inches(0.14), pill_w, Inches(0.30))
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
        p.font.size = Pt(8.5)
        p.font.bold = True
        p.font.color.rgb = col

        # Compact Centered Portrait Plate
        pw = Inches(1.60)
        ph = Inches(2.00)
        px = cx + (v_w - pw) / 2
        py = v_y + Inches(0.50)

        if os.path.exists(plate_img):
            s6.shapes.add_picture(plate_img, px, py, pw, ph)
            pfr = s6.shapes.add_shape(MSO_SHAPE.RECTANGLE, px, py, pw, ph)
            pfr.fill.background()
            pfr.line.color.rgb = C_CARD_BORDER
            pfr.line.width = Pt(1)

        # Text below portrait
        tb = s6.shapes.add_textbox(cx + Inches(0.14), v_y + Inches(2.58), v_w - Inches(0.28), v_h - Inches(2.68))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = name
        p.font.name = "Georgia"
        p.font.size = Pt(15.5)
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
        p.text = f"✦ TEAM TAKEAWAY: {takeaway_hdr.upper()}"
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

    # =========================================================================
    # SLIDE 7: Teamwork Habits (Inspiration from Valve)
    # =========================================================================
    s7 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s7)
    add_header(
        s7,
        "Practical Teamwork • Inspiration from Valve",
        "Three Great Teamwork Habits We Learn from Valve",
        "Practical ways successful flat teams collaborate every day without managers:"
    )

    card_y = Inches(1.75)
    card_h = Inches(5.30)
    card_w = Inches(3.68)
    card_gap = Inches(0.34)

    promises = [
        (
            "01 • ROLLING TO THE NEED",
            "Desks on Wheels",
            "✦ Roll over to where teammates need help",
            [
                ("Go where the need is: ", "Don't stay isolated at your own desk. When you see a colleague feeling stuck, roll over and offer a hand."),
                ("No territorial walls: ", "We never say 'that's not my job.' If an activity needs fresh eyes or extra ideas, anyone can jump in."),
                ("Natural initiative: ", "You don't wait for someone to delegate a task. You see an opportunity to help and you step forward.")
            ],
            "“Your desk has wheels for a reason. Roll it to where you can make the biggest difference for your team.”",
            "Valve Employee Handbook",
            None,
            C_GREEN,
            C_GREEN_LIGHT
        ),
        (
            "02 • LEARNING TOGETHER",
            "Sharing Our Strengths",
            "✦ Growing broader skills as a team",
            [
                ("Bring your unique craft: ", "Whether you're great at clear explanations, student motivation, or audio tools, share your tricks openly."),
                ("Learn from each other: ", "Watch how your peers approach teaching hurdles. Trying new tools together makes everyone stronger."),
                ("Self-reliant small groups: ", "A small group of 3 or 4 teachers can create complete, polished lessons without waiting on outside help.")
            ],
            "“The best teammates bring deep passion for their craft, but are always excited to learn from those around them.”",
            "Valve Teamwork Philosophy",
            None,
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "03 • SHOWING OVER DEBATING",
            "Try It First, Don't Just Talk",
            "✦ Build a quick draft to see if it works",
            [
                ("Action beats endless talk: ", "Instead of spending an hour arguing about an idea, spend 15 minutes making a quick draft or sample."),
                ("Let the work guide you: ", "When you can see and hear a real example, making decisions together becomes simple and obvious."),
                ("Safe to experiment: ", "If a draft doesn't work, that's completely fine. We learn what doesn't work and adjust together immediately.")
            ],
            "“Don't get stuck in meetings. Build a quick draft, show it to your team, and let real results do the talking.”",
            "Chet Faliszek • Valve Team Lead",
            plate_chet,
            C_TERRA,
            C_TERRA_LIGHT
        )
    ]

    for i, (badge_txt, title, subtitle, bullets, quote, quote_attr, plate_img, col, bg_col) in enumerate(promises):
        cx = Inches(0.8) + i * (card_w + card_gap)
        cbox = s7.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, card_y, card_w, card_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        pill_w = card_w - Inches(0.40)
        pill = s7.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.20), card_y + Inches(0.18), pill_w, Inches(0.34))
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
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = col

        # Body: Title, Subtitle, and Bullets
        q_h = Inches(1.15)
        q_y = card_y + card_h - q_h - Inches(0.18)
        body_h = q_y - (card_y + Inches(0.58)) - Inches(0.06)

        tb = s7.shapes.add_textbox(cx + Inches(0.20), card_y + Inches(0.58), card_w - Inches(0.40), body_h)
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = subtitle
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(10.5)
        p.font.color.rgb = col
        p.space_after = Pt(8)

        for bold_pre, norm_txt in bullets:
            p = tf.add_paragraph()
            p.text = "• "
            p.font.name = "Segoe UI"
            p.font.size = Pt(10.5)
            p.font.color.rgb = col
            r = p.add_run()
            r.text = bold_pre
            r.font.name = "Segoe UI Semibold"
            r.font.size = Pt(11)
            r.font.color.rgb = C_DARK
            r2 = p.add_run()
            r2.text = norm_txt
            r2.font.name = "Segoe UI"
            r2.font.size = Pt(10.5)
            r2.font.color.rgb = C_MUTED
            p.line_spacing = 1.16
            p.space_after = Pt(6)

        # Dedicated Quote Anchor Card at Bottom
        q_w = card_w - Inches(0.36)
        q_x = cx + Inches(0.18)
        q_box = s7.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, q_x, q_y, q_w, q_h)
        q_box.fill.solid()
        q_box.fill.fore_color.rgb = bg_col
        q_box.line.color.rgb = col
        q_box.line.width = Pt(0.75)

        if plate_img and os.path.exists(plate_img):
            pw = Inches(0.72)
            ph = Inches(0.90)
            px = q_x + Inches(0.10)
            py = q_y + (q_h - ph) / 2
            s7.shapes.add_picture(plate_img, px, py, pw, ph)
            pfr = s7.shapes.add_shape(MSO_SHAPE.RECTANGLE, px, py, pw, ph)
            pfr.fill.background()
            pfr.line.color.rgb = col
            pfr.line.width = Pt(0.75)

            tb_q = s7.shapes.add_textbox(px + pw + Inches(0.10), q_y + Inches(0.06), q_w - pw - Inches(0.20), q_h - Inches(0.12))
            qtf = tb_q.text_frame
            qtf.word_wrap = True
            qtf.margin_left = qtf.margin_right = qtf.margin_top = qtf.margin_bottom = 0

            p = qtf.paragraphs[0]
            p.text = quote
            p.font.name = "Georgia"
            p.font.size = Pt(9.5)
            p.font.italic = True
            p.font.color.rgb = C_DARK
            p.line_spacing = 1.12
            p.space_after = Pt(2)

            p = qtf.add_paragraph()
            p.text = f"— {quote_attr}"
            p.font.name = "Segoe UI Semibold"
            p.font.size = Pt(8.5)
            p.font.color.rgb = col
        else:
            tb_q = s7.shapes.add_textbox(q_x + Inches(0.14), q_y + Inches(0.10), q_w - Inches(0.28), q_h - Inches(0.20))
            qtf = tb_q.text_frame
            qtf.word_wrap = True
            qtf.margin_left = qtf.margin_right = qtf.margin_top = qtf.margin_bottom = 0

            p = qtf.paragraphs[0]
            p.text = quote
            p.font.name = "Georgia"
            p.font.size = Pt(10)
            p.font.italic = True
            p.font.color.rgb = C_DARK
            p.line_spacing = 1.15
            p.space_after = Pt(2)

            p = qtf.add_paragraph()
            p.text = f"— {quote_attr}"
            p.font.name = "Segoe UI Semibold"
            p.font.size = Pt(8.5)
            p.font.color.rgb = col

    # =========================================================================
    # SLIDE 8: The Documented Traps (What We Defend Against)
    # =========================================================================
    s8_traps = prs.slides.add_slide(blank_layout)
    set_slide_bg(s8_traps)
    add_header(
        s8_traps,
        "Team Pitfalls • What We Watch Out For",
        "The 3 Traps to Watch Out For (And How We Avoid Them)",
        "Every team without managers encounters these three hurdles. Here is how we protect our culture:"
    )

    traps = [
        (
            "⚠️ TRAP 01 • POPULARITY CONTESTS",
            "Hidden Cliques",
            "The Danger of Whispers",
            "When there are no formal managers, influence can quietly drift to informal friend groups, whisper conversations, or whoever speaks the loudest.",
            "Open Conversations: We share ideas in public team channels, write down our choices openly, and make sure every single teammate has an equal voice.",
            "“Cliques grow in the dark. Open, transparent sharing keeps our team fair and equal for everyone.”",
            plate_freeman,
            "Jo Freeman",
            "Team Researcher"
        ),
        (
            "⚠️ TRAP 02 • GUILT-DRIVEN OVERTIME",
            "Silent Overtime",
            "The Burnout Trap",
            "Without a manager telling people when to stop, dedicated teachers feel quiet pressure to answer messages late at night to prove they are working hard.",
            "Protected Rest: We encourage focused daytime hours, turn off notifications in the evening, and treat late-night burnout as a signal to slow down.",
            "“Working late into the night doesn't make you a hero. A well-rested teacher brings the best energy to students.”",
            plate_weier,
            "Josh Weier",
            "Project Lead"
        ),
        (
            "⚠️ TRAP 03 • PEER COMPETITION",
            "Comparing Ourselves",
            "The Rivalry Trap",
            "When colleagues feel secretly compared against one another, trust disappears. People hold back their best ideas and stop helping their peers.",
            "One Shared Mission: We succeed together or not at all. We celebrate when a teammate does great work, knowing it helps our entire team grow.",
            "“Never turn colleagues into rivals. We succeed by lifting each other up, not by competing for attention.”",
            plate_geldreich,
            "Rich Geldreich",
            "Senior Engineer"
        )
    ]

    for i, (badge_txt, title, subtitle, threat, defense, quote, plate_img, speaker_name, speaker_role) in enumerate(traps):
        cx = Inches(0.8) + i * (card_w + card_gap)
        cbox = s8_traps.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, card_y, card_w, card_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = C_TERRA
        cbox.line.width = Pt(1.5)

        # Top badge pill
        pill_w = card_w - Inches(0.36)
        pill = s8_traps.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.18), card_y + Inches(0.14), pill_w, Inches(0.30))
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
        p.font.size = Pt(8.5)
        p.font.bold = True
        p.font.color.rgb = C_TERRA

        # Header Row: Speaker Portrait Plate (Left) + Titles & Attribution (Right)
        pw = Inches(1.00)
        ph = Inches(1.25)
        px = cx + Inches(0.18)
        py = card_y + Inches(0.50)

        if os.path.exists(plate_img):
            s8_traps.shapes.add_picture(plate_img, px, py, pw, ph)
            pfr = s8_traps.shapes.add_shape(MSO_SHAPE.RECTANGLE, px, py, pw, ph)
            pfr.fill.background()
            pfr.line.color.rgb = C_CARD_BORDER
            pfr.line.width = Pt(1)

        tb_hdr = s8_traps.shapes.add_textbox(px + pw + Inches(0.12), card_y + Inches(0.48), card_w - pw - Inches(0.44), Inches(1.30))
        htf = tb_hdr.text_frame
        htf.word_wrap = True
        htf.margin_left = htf.margin_right = htf.margin_top = htf.margin_bottom = 0

        p = htf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(17)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(1)

        p = htf.add_paragraph()
        p.text = f"⚠️ {subtitle}"
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(9.5)
        p.font.color.rgb = C_AMBER
        p.space_after = Pt(3)

        p = htf.add_paragraph()
        p.text = f"{speaker_name} • {speaker_role}"
        p.font.name = "Segoe UI"
        p.font.size = Pt(8.5)
        p.font.color.rgb = C_MUTED

        # Body: Threat and Defense
        body_y = card_y + Inches(1.85)
        q_h = Inches(0.85)
        q_y = card_y + card_h - q_h - Inches(0.16)
        body_h = q_y - body_y - Inches(0.08)

        tb_body = s8_traps.shapes.add_textbox(cx + Inches(0.18), body_y, card_w - Inches(0.36), body_h)
        btf = tb_body.text_frame
        btf.word_wrap = True
        btf.margin_left = btf.margin_right = btf.margin_top = btf.margin_bottom = 0

        p = btf.paragraphs[0]
        p.text = "THE RISK TO WATCH:"
        p.font.name = "Segoe UI"
        p.font.size = Pt(9)
        p.font.bold = True
        p.font.color.rgb = C_TERRA
        p.space_after = Pt(1)

        p = btf.add_paragraph()
        p.text = threat
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.15
        p.space_after = Pt(6)

        p = btf.add_paragraph()
        p.text = "OUR TEAM DEFENSE:"
        p.font.name = "Segoe UI"
        p.font.size = Pt(9)
        p.font.bold = True
        p.font.color.rgb = C_GREEN
        p.space_after = Pt(1)

        p = btf.add_paragraph()
        p.text = defense
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.15

        # Dedicated Tinted Quote Footer Box at Bottom
        q_box = s8_traps.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.18), q_y, card_w - Inches(0.36), q_h)
        q_box.fill.solid()
        q_box.fill.fore_color.rgb = C_TERRA_LIGHT
        q_box.line.color.rgb = C_TERRA
        q_box.line.width = Pt(0.75)

        qtf = q_box.text_frame
        qtf.word_wrap = True
        qtf.margin_left = qtf.margin_right = Inches(0.14)
        qtf.margin_top = qtf.margin_bottom = Inches(0.06)

        p = qtf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = quote
        p.font.name = "Georgia"
        p.font.italic = True
        p.font.bold = True
        p.font.size = Pt(9.5)
        p.font.color.rgb = C_TERRA
        p.line_spacing = 1.14

    # =========================================================================
    # SLIDE 9: The Traditional Relay Race (The Old Assembly Line)
    # =========================================================================
    s8 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s8)
    add_header(
        s8,
        "How Work Gets Stuck • The Traditional Relay",
        "The Old Relay Race: Passing Files Back and Forth",
        "Why traditional school handoffs make teamwork feel frustrating, lonely, and slow:"
    )

    step_w = Inches(1.80)
    queue_w = Inches(1.30)
    flow_y = Inches(1.80)
    flow_h = Inches(2.35)

    steps = [
        ("01 WORKING ALONE", "A teacher sits in isolation for a week drafting an exercise without talking to anyone.", C_SLATE),
        ("02 SUPERVISOR REVIEW", "A supervisor marks it up with red pens, demanding changes days later.", C_SLATE),
        ("03 PASSING TO OTHERS", "The draft gets sent to someone else who doesn't understand the original idea.", C_SLATE),
        ("04 STARTING OVER", "A mistake is caught at the end and the whole file is sent back to step one!", C_SLATE)
    ]

    queues = [
        ("⏳ WAITING 1", "Wait 5–7 Days", "Sitting in an inbox"),
        ("⏳ WAITING 2", "Wait 4–6 Days", "Waiting for approval"),
        ("⏳ WAITING 3", "Wait 3–5 Days", "Endless back-and-forth")
    ]

    curr_x = Inches(0.8)
    for i in range(4):
        sbox = s8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, curr_x, flow_y, step_w, flow_h)
        sbox.fill.solid()
        sbox.fill.fore_color.rgb = C_CARD
        sbox.line.color.rgb = C_CARD_BORDER
        sbox.line.width = Pt(1)

        stf = sbox.text_frame
        stf.word_wrap = True
        stf.margin_left = stf.margin_right = Inches(0.14)
        stf.margin_top = Inches(0.18)

        p = stf.paragraphs[0]
        p.text = steps[i][0]
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(6)

        p = stf.add_paragraph()
        p.text = steps[i][1]
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.18

        curr_x += step_w

        if i < 3:
            arrow = s8.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, curr_x + Inches(0.04), flow_y + Inches(1.05), Inches(0.14), Inches(0.25))
            arrow.fill.solid()
            arrow.fill.fore_color.rgb = C_LINE
            arrow.line.fill.background()

            qbox = s8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, curr_x + Inches(0.20), flow_y, queue_w, flow_h)
            qbox.fill.solid()
            qbox.fill.fore_color.rgb = RGBColor(254, 242, 242)
            qbox.line.color.rgb = C_TERRA
            qbox.line.width = Pt(1)

            qtf = qbox.text_frame
            qtf.word_wrap = True
            qtf.margin_left = qtf.margin_right = Inches(0.10)
            qtf.margin_top = Inches(0.25)

            p = qtf.paragraphs[0]
            p.alignment = PP_ALIGN.CENTER
            p.text = queues[i][0]
            p.font.name = "Segoe UI"
            p.font.size = Pt(10)
            p.font.bold = True
            p.font.color.rgb = C_TERRA
            p.space_after = Pt(4)

            p = qtf.add_paragraph()
            p.alignment = PP_ALIGN.CENTER
            p.text = queues[i][1]
            p.font.name = "Segoe UI"
            p.font.size = Pt(11)
            p.font.bold = True
            p.font.color.rgb = C_DARK
            p.space_after = Pt(2)

            p = qtf.add_paragraph()
            p.alignment = PP_ALIGN.CENTER
            p.text = queues[i][2]
            p.font.name = "Segoe UI"
            p.font.size = Pt(10)
            p.font.color.rgb = C_MUTED

            arrow2 = s8.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, curr_x + Inches(0.20) + queue_w + Inches(0.04), flow_y + Inches(1.05), Inches(0.14), Inches(0.25))
            arrow2.fill.solid()
            arrow2.fill.fore_color.rgb = C_LINE
            arrow2.line.fill.background()

            curr_x += queue_w + Inches(0.40)

    # 3 Metrics Callouts
    bot_y = Inches(4.35)
    bot_w = Inches(3.68)
    bot_h = Inches(1.70)
    gap8 = Inches(0.34)

    metrics = [
        ("⏱️ WEEKS OF WAITING", "A simple 5-minute exercise takes a month to complete because of constant handoffs and waiting for approvals.", C_TERRA),
        ("📉 LOST MOMENTUM", "By the time feedback finally comes back weeks later, you have forgotten why you were excited about the idea.", C_TERRA),
        ("👮 FEELING MICROMANAGED", "Teachers feel like factory workers waiting for permission instead of trusted, creative educators.", C_SLATE)
    ]

    for idx, (title, desc, col) in enumerate(metrics):
        mx = Inches(0.8) + idx * (bot_w + gap8)
        mbox = s8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, mx, bot_y, bot_w, bot_h)
        mbox.fill.solid()
        mbox.fill.fore_color.rgb = C_CARD
        mbox.line.color.rgb = C_CARD_BORDER
        mbox.line.width = Pt(1)

        mtf = mbox.text_frame
        mtf.word_wrap = True
        mtf.margin_left = mtf.margin_right = Inches(0.20)
        mtf.margin_top = Inches(0.16)

        p = mtf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = title
        p.font.name = "Segoe UI"
        p.font.size = Pt(12.5)
        p.font.bold = True
        p.font.color.rgb = col
        p.space_after = Pt(4)

        p = mtf.add_paragraph()
        p.alignment = PP_ALIGN.CENTER
        p.text = desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.18

    add_banner(
        s8,
        Inches(6.25),
        "💡 THE SECRET OF HIERARCHY: Every handoff creates a waiting line. Every waiting line kills momentum.",
        "When work moves in linear sequences, teams need managers just to chase replies. Working live together eliminates this waste.",
        accent=C_TERRA
    )

    # =========================================================================
    # SLIDE 10: The Small Group Hub
    # =========================================================================
    s9 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s9)
    add_header(
        s9,
        "Teamwork in Practice • Small Working Hubs",
        "The Small Group Hub: Creating Together in Real Time",
        "How 3 to 4 teammates turn weeks of back-and-forth into an energizing 2-hour working session:"
    )

    role_w = Inches(3.10)
    role_h = Inches(2.05)
    cen_w = Inches(4.933)
    cen_h = Inches(3.90)

    roles = [
        ("HAT #1: THE LESSON GUIDE", "Clear Flow & Concept", "Focuses on the clear explanation, step-by-step logic, and making sure the main concept is easy to grasp.", C_SLATE, Inches(0.8), Inches(1.75)),
        ("HAT #2: THE ACTIVITY CRAFTER", "Interactive Practice", "Designs engaging drills, conversational games, and exercises that get students actively talking.", C_TERRA, Inches(0.8), Inches(4.05)),
        ("HAT #3: THE LISTENING EAR", "Natural Sound & Clarity", "Listens carefully to ensure every audio prompt, sentence cadence, and example sounds natural and warm.", C_AMBER, Inches(9.433), Inches(1.75)),
        ("HAT #4: THE STUDENT CHAMPION", "The Learner's Perspective", "Asks the key questions: 'Would a beginner get this?' 'Does this feel fun or confusing?'", C_GREEN, Inches(9.433), Inches(4.05))
    ]

    for badge, title, desc, col, rx, ry in roles:
        rbox = s9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, rx, ry, role_w, role_h)
        rbox.fill.solid()
        rbox.fill.fore_color.rgb = C_CARD
        rbox.line.color.rgb = col
        rbox.line.width = Pt(1.5)

        rtf = rbox.text_frame
        rtf.word_wrap = True
        rtf.margin_left = rtf.margin_right = Inches(0.18)
        rtf.margin_top = Inches(0.12)

        p = rtf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = badge
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = col
        p.space_after = Pt(3)

        p = rtf.add_paragraph()
        p.alignment = PP_ALIGN.CENTER
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(14)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(3)

        p = rtf.add_paragraph()
        p.alignment = PP_ALIGN.CENTER
        p.text = desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.15

    # Connecting Arrows (vertically centered on role cards)
    a1 = s9.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(3.95), Inches(2.65), Inches(0.20), Inches(0.25))
    a1.fill.solid()
    a1.fill.fore_color.rgb = C_GREEN
    a1.line.fill.background()

    a2 = s9.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(3.95), Inches(4.95), Inches(0.20), Inches(0.25))
    a2.fill.solid()
    a2.fill.fore_color.rgb = C_GREEN
    a2.line.fill.background()

    a3 = s9.shapes.add_shape(MSO_SHAPE.LEFT_ARROW, Inches(9.18), Inches(2.65), Inches(0.20), Inches(0.25))
    a3.fill.solid()
    a3.fill.fore_color.rgb = C_GREEN
    a3.line.fill.background()

    a4 = s9.shapes.add_shape(MSO_SHAPE.LEFT_ARROW, Inches(9.18), Inches(4.95), Inches(0.20), Inches(0.25))
    a4.fill.solid()
    a4.fill.fore_color.rgb = C_GREEN
    a4.line.fill.background()

    # Center Collaboration Workbench Card
    cen_box = s9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(4.20), Inches(1.95), cen_w, cen_h)
    cen_box.fill.solid()
    cen_box.fill.fore_color.rgb = C_GREEN_LIGHT
    cen_box.line.color.rgb = C_GREEN
    cen_box.line.width = Pt(2)

    ctf = cen_box.text_frame
    ctf.word_wrap = True
    ctf.margin_left = ctf.margin_right = Inches(0.25)
    ctf.margin_top = Inches(0.20)

    p = ctf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "REAL-TIME COLLABORATION BENCH"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = C_GREEN
    p.space_after = Pt(4)

    p = ctf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "The Small Group Hub"
    p.font.name = "Georgia"
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(4)

    p = ctf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "1 Screen  •  Shared Ideas  •  Instant Tweaks  •  Zero Waiting"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(11.5)
    p.font.color.rgb = C_SLATE
    p.space_after = Pt(10)

    p = ctf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "“Instead of sending documents back and forth over email, we pull up one document and work together. We bounce ideas around, test sounds immediately, and finish in an afternoon.”"
    p.font.name = "Georgia"
    p.font.italic = True
    p.font.size = Pt(12)
    p.font.color.rgb = C_DARK
    p.line_spacing = 1.22
    p.space_after = Pt(10)

    p = ctf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "⚡ FINISHED IN 2 TO 3 HOURS WITH ZERO EMAILS"
    p.font.name = "Segoe UI"
    p.font.size = Pt(12.5)
    p.font.bold = True
    p.font.color.rgb = C_TERRA

    add_banner(
        s9,
        Inches(6.25),
        "🎯 THE POWER OF SMALL HUBS: Instant feedback replaces weeks of waiting.",
        "When teammates co-create together in real time, confusion is caught and resolved in seconds, and everyone shares pride in the finished result.",
        accent=C_GREEN
    )

    # =========================================================================
    # SLIDE 11: Case Study — A Real Morning Story
    # =========================================================================
    s10 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s10)
    add_header(
        s10,
        "Teamwork in Action • A Real Morning Story",
        "A Real Morning Story: Fixing a Tricky Lesson Together",
        "How 4 colleagues turned a common student hurdle into an engaging practice before lunch:"
    )

    cs_w = Inches(2.70)
    cs_gap = Inches(0.31)
    cs_y = Inches(1.75)
    cs_h = Inches(4.35)

    timeline = [
        (
            "09:00 AM • Maria • Noticing the Need",
            "Noticing the Struggle",
            "“Our beginners keep confusing words like 'seat' and 'sit'—the old explanation of 'long vs short sound' isn't clicking at all. Can we rethink this together?”",
            "The team rallies around the problem immediately without waiting for a formal meeting.",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "09:30 AM • David • Designing Practice",
            "Creating a Fun Trick",
            "“What if we teach it using mouth smiles? For 'seat', smile wide! For 'sit', drop your jaw and relax. Let's make it an interactive mirror game.”",
            "David drafts the interactive game right on the shared screen while the team watches.",
            C_TERRA,
            C_TERRA_LIGHT
        ),
        (
            "10:15 AM • Sarah • Checking Audio",
            "Testing the Examples",
            "“Sarah creates clear audio examples. She closes her eyes and asks David to quiz her. They can both hear the contrast loud and clear on the first try.”",
            "Audio examples sound crystal-clear, natural, and friendly.",
            C_AMBER,
            C_AMBER_LIGHT
        ),
        (
            "11:00 AM • Alex • Trying with a Learner",
            "Testing with a Student",
            "“Alex invites a beginner student to try the smile game for 5 minutes. The student laughs, gets it right away, and says 'Oh! Now I feel the difference!'”",
            "11:45 AM: The new lesson is finished, tested, and ready to use!",
            C_GREEN,
            C_GREEN_LIGHT
        )
    ]

    for i, (time_role, act_title, monologue, outcome, col, bg_c) in enumerate(timeline):
        cx = Inches(0.8) + i * (cs_w + cs_gap)
        cbox = s10.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, cs_y, cs_w, cs_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        pill_w = cs_w - Inches(0.24)
        pill = s10.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.12), cs_y + Inches(0.14), pill_w, Inches(0.34))
        pill.fill.solid()
        pill.fill.fore_color.rgb = bg_c
        pill.line.color.rgb = col
        pill.line.width = Pt(0.75)
        ptf = pill.text_frame
        ptf.margin_left = ptf.margin_right = ptf.margin_top = ptf.margin_bottom = 0
        p = ptf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = time_role
        p.font.name = "Segoe UI"
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = col

        tb = s10.shapes.add_textbox(cx + Inches(0.14), cs_y + Inches(0.56), cs_w - Inches(0.28), cs_h - Inches(0.68))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.text = act_title
        p.font.name = "Georgia"
        p.font.size = Pt(17)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(6)

        p = tf.add_paragraph()
        p.text = monologue
        p.font.name = "Georgia"
        p.font.italic = True
        p.font.size = Pt(11)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.2
        p.space_after = Pt(8)

        p = tf.add_paragraph()
        p.text = "🎯 SPRINT OUTCOME:"
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = col
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = outcome
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.15

        if i < 3:
            ar = s10.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, cx + cs_w + Inches(0.08), cs_y + Inches(2.0), Inches(0.15), Inches(0.25))
            ar.fill.solid()
            ar.fill.fore_color.rgb = C_LINE
            ar.line.fill.background()

    add_banner(
        s10,
        Inches(6.25),
        "💡 THE LESSON: In traditional schools, this would have taken 3 months of committee memos.",
        "Because the team jumped in together, they solved a real student frustration before lunch—and had fun doing it.",
        accent=C_GREEN
    )

    # =========================================================================
    # SLIDE 12: The 5-Stage Advice Process Flowchart
    # =========================================================================
    s11 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s11)
    add_header(
        s11,
        "Making Decisions as Equals • The Advice Process",
        "How We Make Decisions: The Advice Process",
        "How any teammate can make great decisions without waiting for a boss or getting stuck in meetings:"
    )

    adv_w = Inches(2.18)
    adv_gap = Inches(0.20)
    adv_y = Inches(1.75)
    adv_h = Inches(4.22)

    stages = [
        (
            "STAGE 01",
            "Spot a Need",
            "✦ You Step Forward",
            "You notice something confusing for students or a bumpy process on the team. You don't have to wait for someone else to notice.",
            "Take Action: The person who spots the problem has the green light to lead the solution.",
            "“Never wait for someone else to step up.”",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "STAGE 02",
            "Quick Draft",
            "✦ Show, Don't Just Talk",
            "Before calling a meeting, put together a simple draft, quick sketch, or short audio sample so teammates have something real to look at.",
            "Draft Rule: A rough example is worth a thousand abstract discussions.",
            "“Start with a simple, tangible draft.”",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "STAGE 03",
            "Ask Advice",
            "✦ Listen to Teammates",
            "Ask two groups for input:\n1. Teammates with experience in this area\n2. Those who will be affected by the change.",
            "Golden Rule: Advice is wisdom to help you, not permission to wait for! No consensus needed.",
            "“Seek good advice, not permission.”",
            C_TERRA,
            C_TERRA_LIGHT
        ),
        (
            "STAGE 04",
            "Make the Call",
            "✦ You Decide",
            "Weigh the advice you heard, shape the best solution you can, and make the final decision yourself.",
            "Ownership Rule: You don't need everyone to agree. You make the call and own the result.",
            "“Trust your judgment to make the call.”",
            C_GREEN,
            C_GREEN_LIGHT
        ),
        (
            "STAGE 05",
            "Share & Learn",
            "✦ Keep Peers Informed",
            "Tell the team what you decided and share how it went with real students. If it didn't work, tweak it together.",
            "Learning Rule: Sharing results openly keeps everyone learning together.",
            "“Be open about what worked and what didn't.”",
            C_GREEN,
            C_GREEN_LIGHT
        )
    ]

    for i, (tag, title, sub, desc, rule, quote, col, bg_c) in enumerate(stages):
        cx = Inches(0.8) + i * (adv_w + adv_gap)
        cbox = s11.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, adv_y, adv_w, adv_h)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        pill_w = adv_w - Inches(0.20)
        pill = s11.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.10), adv_y + Inches(0.14), pill_w, Inches(0.32))
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
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = col

        tb = s11.shapes.add_textbox(cx + Inches(0.12), adv_y + Inches(0.52), adv_w - Inches(0.24), adv_h - Inches(0.58))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(15.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = sub
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(10)
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
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = col if col == C_TERRA else C_DARK
        p.line_spacing = 1.14
        p.space_after = Pt(6)

        p = tf.add_paragraph()
        p.text = quote
        p.font.name = "Georgia"
        p.font.italic = True
        p.font.size = Pt(10)
        p.font.color.rgb = col

        if i < 4:
            ar = s11.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, cx + adv_w + Inches(0.04), adv_y + Inches(2.0), Inches(0.12), Inches(0.20))
            ar.fill.solid()
            ar.fill.fore_color.rgb = C_LINE
            ar.line.fill.background()

    # Author Anchor Card for Frédéric Laloux at bottom
    ban_y = Inches(6.12)
    ban_h = Inches(1.08)
    ban = s11.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), ban_y, Inches(11.733), ban_h)
    ban.fill.solid()
    ban.fill.fore_color.rgb = C_BANNER_BG
    ban.line.color.rgb = C_CARD_BORDER
    ban.line.width = Pt(1)

    lpw = Inches(0.72)
    lph = Inches(0.90)
    lpx = Inches(0.95)
    lpy = ban_y + Inches(0.09)
    if os.path.exists(plate_laloux):
        s11.shapes.add_picture(plate_laloux, lpx, lpy, lpw, lph)
        lpfr = s11.shapes.add_shape(MSO_SHAPE.RECTANGLE, lpx, lpy, lpw, lph)
        lpfr.fill.background()
        lpfr.line.color.rgb = C_CARD_BORDER
        lpfr.line.width = Pt(1)

    tb_ban = s11.shapes.add_textbox(Inches(1.80), ban_y + Inches(0.08), Inches(10.60), Inches(0.92))
    btf = tb_ban.text_frame
    btf.word_wrap = True
    btf.margin_left = btf.margin_right = btf.margin_top = btf.margin_bottom = 0

    p = btf.paragraphs[0]
    p.text = "⚡ FRÉDÉRIC LALOUX • AUTHOR, REINVENTING ORGANIZATIONS"
    p.font.name = "Segoe UI"
    p.font.size = Pt(9.5)
    p.font.bold = True
    p.font.color.rgb = C_GREEN
    p.space_after = Pt(2)

    p = btf.add_paragraph()
    p.text = "“Any person can make any decision, as long as they seek advice from knowledgeable peers and those affected. Advice is not permission—ownership stays with the person making the call.”"
    p.font.name = "Georgia"
    p.font.size = Pt(11)
    p.font.italic = True
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(2)

    p = btf.add_paragraph()
    p.text = "We trust each other's good judgment. We listen deeply to advice, but we don't wait for permission or get paralyzed trying to make everyone agree."
    p.font.name = "Segoe UI"
    p.font.size = Pt(9.5)
    p.font.color.rgb = C_MUTED

    # =========================================================================
    # SLIDE 13: The Decision Spectrum (Consensus vs Advice vs Dictate)
    # =========================================================================
    s12 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s12)
    add_header(
        s12,
        "Working Through Differences • Making Choices Together",
        "Three Ways to Decide: Why the Advice Way Works Best",
        "How we avoid endless arguing while making sure everyone feels heard and respected:"
    )

    top_y12 = Inches(1.75)
    top_h12 = Inches(3.20)
    comp_w12 = Inches(3.68)
    comp_gap12 = Inches(0.34)

    models = [
        (
            "❌ TRYING TO MAKE EVERYONE AGREE",
            "The Consensus Trap",
            "Trying to get all 10 people to agree on every single detail before anyone can try an idea.",
            "Why It Stalls: Progress moves at the speed of the most hesitant person. It leads to bland compromises where no one feels excited or fully responsible.",
            C_TERRA,
            C_TERRA_LIGHT
        ),
        (
            "✓ THE ADVICE PROCESS (OUR WAY)",
            "Speed with Shared Wisdom",
            "You actively seek input and listen to advice, but you make the final call yourself.",
            "Why It Works: Combines fast execution with great peer advice. You don't need unanimous agreement to test a good idea and see if it helps students.",
            C_GREEN,
            C_GREEN_LIGHT
        ),
        (
            "❌ WAITING FOR A BOSS TO ORDER",
            "The Manager Trap",
            "Waiting for a distant supervisor or administrator to hand down orders from an office.",
            "Why It Fails: Managers are often far removed from actual students. It disempowers teachers, creates bottlenecks, and crushes creative energy.",
            C_SLATE,
            C_SLATE_LIGHT
        )
    ]

    for i, (tag, title, desc, power, col, bg_c) in enumerate(models):
        cx = Inches(0.8) + i * (comp_w12 + comp_gap12)
        box = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, top_y12, comp_w12, top_h12)
        box.fill.solid()
        box.fill.fore_color.rgb = bg_c
        box.line.color.rgb = col
        box.line.width = Pt(1.5)

        btf = box.text_frame
        btf.word_wrap = True
        btf.margin_left = btf.margin_right = Inches(0.20)
        btf.margin_top = Inches(0.18)

        p = btf.paragraphs[0]
        p.text = tag
        p.font.name = "Segoe UI"
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = col
        p.space_after = Pt(2)

        p = btf.add_paragraph()
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(17)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(6)

        p = btf.add_paragraph()
        p.text = desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11.5)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.18
        p.space_after = Pt(6)

        p = btf.add_paragraph()
        p.text = power
        p.font.name = "Segoe UI Semibold"
        p.font.size = Pt(11)
        p.font.color.rgb = col
        p.line_spacing = 1.16

    # Bottom Section: Conflict Resolution
    bot_y12 = Inches(5.15)

    tb_laloux = s12.shapes.add_textbox(Inches(0.8), bot_y12, Inches(11.733), Inches(0.32))
    ltf = tb_laloux.text_frame
    ltf.margin_left = ltf.margin_right = ltf.margin_top = ltf.margin_bottom = 0
    p = ltf.paragraphs[0]
    p.text = "🤝 HOW WE RESOLVE DISAGREEMENTS WHEN WE CAN'T AGREE:"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = C_SLATE

    tiers = [
        ("STEP 1: TALK OVER A COFFEE (1-ON-1)", "Meet privately and warmly within 24 hours. Talk about the work honestly without blaming each other or keeping silent grudges."),
        ("STEP 2: BRING IN A TRUSTED PEER", "If you're still stuck, invite a calm teammate to sit with you both, listen with fresh ears, and help you find common ground."),
        ("STEP 3: TEST IT WITH STUDENTS", "Instead of arguing opinions back and forth, put both ideas in front of real students! Let real student learning settle the debate.")
    ]

    for idx, (th, td) in enumerate(tiers):
        tx = Inches(0.8) + idx * (comp_w12 + comp_gap12)

        tbox = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, tx, bot_y12 + Inches(0.38), comp_w12, Inches(1.42))
        tbox.fill.solid()
        tbox.fill.fore_color.rgb = C_CARD
        tbox.line.color.rgb = C_CARD_BORDER
        tbox.line.width = Pt(1)

        tf = tbox.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = Inches(0.20)
        tf.margin_top = Inches(0.14)

        p = tf.paragraphs[0]
        p.text = th
        p.font.name = "Segoe UI"
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = C_SLATE
        p.space_after = Pt(4)

        p = tf.add_paragraph()
        p.text = td
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.18

    # =========================================================================
    # SLIDE 14: The Social Contract: Mutual Commitments
    # =========================================================================
    s13 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s13)
    add_header(
        s13,
        "Our Everyday Culture • How We Treat Each Other",
        "Our Team Promises: What We Give and What We Expect",
        "Simple, transparent commitments that keep our team safe, supportive, and energized:"
    )

    col_w13 = Inches(5.68)
    head_y13 = Inches(1.70)
    head_h13 = Inches(0.44)

    card_start_y = Inches(2.28)
    row_h13 = Inches(1.12)
    row_gap13 = Inches(0.14)

    # Left Column Header Banner
    l_hdr = s13.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), head_y13, col_w13, head_h13)
    l_hdr.fill.solid()
    l_hdr.fill.fore_color.rgb = C_GREEN_LIGHT
    l_hdr.line.color.rgb = C_GREEN
    l_hdr.line.width = Pt(1.5)
    ltf_h = l_hdr.text_frame
    ltf_h.margin_left = ltf_h.margin_right = ltf_h.margin_top = ltf_h.margin_bottom = 0
    p = ltf_h.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "✓ WHAT YOU CAN ALWAYS COUNT ON (OUR PROMISES TO YOU)"
    p.font.name = "Segoe UI"
    p.font.size = Pt(11.5)
    p.font.bold = True
    p.font.color.rgb = C_GREEN

    left_commitments = [
        ("✓ Full Trust to Try Ideas", "You have the freedom to spot problems, create solutions, and test ideas without having to ask for managerial sign-off."),
        ("✓ Thoughtful Help and Advice", "Teammates will always take time to give you thoughtful feedback and support whenever you reach out for advice."),
        ("✓ Respect for Your Personal Time", "We protect reasonable working hours, quiet evenings, and zero weekend messages. Your health and personal life come first."),
        ("✓ Kind, Honest Support", "A warm, supportive environment where you can speak your mind safely and receive constructive feedback offered with genuine care.")
    ]

    for idx, (title, desc) in enumerate(left_commitments):
        ry = card_start_y + idx * (row_h13 + row_gap13)
        cbox = s13.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), ry, col_w13, row_h13)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = C_GREEN
        cbox.line.width = Pt(1.25)

        ctf = cbox.text_frame
        ctf.word_wrap = True
        ctf.margin_left = ctf.margin_right = Inches(0.20)
        ctf.margin_top = Inches(0.12)

        p = ctf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(13)
        p.font.bold = True
        p.font.color.rgb = C_GREEN
        p.space_after = Pt(2)

        p = ctf.add_paragraph()
        p.text = desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.16

    # Right Column Header Banner
    r_hdr = s13.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.85), head_y13, col_w13, head_h13)
    r_hdr.fill.solid()
    r_hdr.fill.fore_color.rgb = C_TERRA_LIGHT
    r_hdr.line.color.rgb = C_TERRA
    r_hdr.line.width = Pt(1.5)
    rtf_h = r_hdr.text_frame
    rtf_h.margin_left = rtf_h.margin_right = rtf_h.margin_top = rtf_h.margin_bottom = 0
    p = rtf_h.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "✗ WHAT WE CHOOSE TO LEAVE BEHIND (WHAT WE DON'T DO)"
    p.font.name = "Segoe UI"
    p.font.size = Pt(11.5)
    p.font.bold = True
    p.font.color.rgb = C_TERRA

    right_commitments = [
        ("✗ No Hovering Managers or Busywork", "No timesheets, seat-time policing, or useless status meetings. We care about real student learning, not performative presence."),
        ("✗ No Getting Stuck in Endless Debates", "No long meetings where people argue back and forth without trying anything. We build quick drafts and learn from real use."),
        ("✗ No Silent Overtime or Guilt", "Working late into the night is not a badge of honor. When the workday is done, close your laptop with peace of mind."),
        ("✗ No Holding Back Honest Thoughts", "We don't smile politely when something is broken. We speak up with kindness so that our learning materials stay top quality.")
    ]

    for idx, (title, desc) in enumerate(right_commitments):
        ry = card_start_y + idx * (row_h13 + row_gap13)
        cbox = s13.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.85), ry, col_w13, row_h13)
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = C_TERRA
        cbox.line.width = Pt(1.25)

        ctf = cbox.text_frame
        ctf.word_wrap = True
        ctf.margin_left = ctf.margin_right = Inches(0.20)
        ctf.margin_top = Inches(0.12)

        p = ctf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(13)
        p.font.bold = True
        p.font.color.rgb = C_TERRA
        p.space_after = Pt(2)

        p = ctf.add_paragraph()
        p.text = desc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.16

    # =========================================================================
    # SLIDE 15: The 3 Objective Quality Filters
    # =========================================================================
    s14 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s14)
    add_header(
        s14,
        "Caring About Excellence • Testing What We Make",
        "Keeping Quality High: 3 Simple Checks We Use",
        "How we know our lessons are truly great without relying on a supervisor's subjective mood:"
    )

    q_cards = [
        (
            "CHECK 01 • THE PEER EAR CHECK",
            "The Blind Ear Test",
            "How it works: Close your eyes and listen to your teammate's audio examples without looking at any text on screen.",
            "🎯 Clear Target: 10 out of 10 times, the words and sound contrast are immediately obvious and natural.",
            "Why it matters: If an experienced English teacher has to strain to hear the difference, a beginner language learner will definitely struggle.",
            C_SLATE,
            C_SLATE_LIGHT
        ),
        (
            "CHECK 02 • THE VOICE TOOL CHECK",
            "The Dictation Check",
            "How it works: Play the audio into your phone or laptop voice typing tool to see what it transcribes.",
            "🎯 Clear Target: The voice tool recognizes the words immediately with correct pronunciation and pacing.",
            "Why it matters: Voice tools have no personal bias. If the app mishears the word, the audio sample needs more clarity.",
            C_AMBER,
            C_AMBER_LIGHT
        ),
        (
            "CHECK 03 • THE REAL LEARNER CHECK",
            "Testing with Students",
            "How it works: Share the activity with a real student and watch quietly without stepping in or explaining.",
            "🎯 Clear Target: The student understands the instructions easily and practices with a confident smile.",
            "Why it matters: Our golden rule: If the student struggles, it's not the student's fault—it just means we need to make the exercise simpler.",
            C_GREEN,
            C_GREEN_LIGHT
        )
    ]

    for i, (badge_txt, title, proc, pass_std, rat, col, bg_col) in enumerate(q_cards):
        cx = Inches(0.8) + i * (card_w + card_gap)
        cbox = s14.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, card_y, card_w, card_h - Inches(0.95))
        cbox.fill.solid()
        cbox.fill.fore_color.rgb = C_CARD
        cbox.line.color.rgb = col
        cbox.line.width = Pt(1.5)

        pill_w = card_w - Inches(0.40)
        pill = s14.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx + Inches(0.20), card_y + Inches(0.18), pill_w, Inches(0.34))
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
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = col

        tb = s14.shapes.add_textbox(cx + Inches(0.20), card_y + Inches(0.62), card_w - Inches(0.40), card_h - Inches(1.65))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Georgia"
        p.font.size = Pt(18)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(8)

        p = tf.add_paragraph()
        p.text = proc
        p.font.name = "Segoe UI"
        p.font.size = Pt(11.5)
        p.font.color.rgb = C_MUTED
        p.line_spacing = 1.18
        p.space_after = Pt(8)

        p = tf.add_paragraph()
        p.text = pass_std
        p.font.name = "Segoe UI"
        p.font.size = Pt(11.5)
        p.font.bold = True
        p.font.color.rgb = col
        p.line_spacing = 1.18
        p.space_after = Pt(8)

        p = tf.add_paragraph()
        p.text = rat
        p.font.name = "Segoe UI"
        p.font.size = Pt(11)
        p.font.color.rgb = C_DARK
        p.line_spacing = 1.18

    add_banner(
        s14,
        Inches(6.25),
        "🎯 OUR TEAM CREED: Real student learning beats personal opinions every time.",
        "When we let real student results be our guide, we stop arguing about personal preferences and unite around making great learning experiences.",
        accent=C_GREEN
    )

    # =========================================================================
    # SLIDE 16: Sustainable Cadence & Looking Ahead (Phase 2 Launch)
    # =========================================================================
    s15 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s15)
    add_header(
        s15,
        "Looking Ahead • A Healthy Team Rhythm",
        "A Sustainable Rhythm for Month 2",
        "How we work together, protect our energy, and make every week feel rewarding and balanced:"
    )

    card_y15 = Inches(1.75)
    card_h15 = Inches(3.75)
    col_w15 = Inches(5.68)

    # Left: The Ken Birdwell Cadence
    l_box15 = s15.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), card_y15, col_w15, card_h15)
    l_box15.fill.solid()
    l_box15.fill.fore_color.rgb = C_CARD
    l_box15.line.color.rgb = C_SLATE
    l_box15.line.width = Pt(1.5)

    pill_l15 = s15.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.05), card_y15 + Inches(0.18), Inches(3.4), Inches(0.34))
    pill_l15.fill.solid()
    pill_l15.fill.fore_color.rgb = C_SLATE_LIGHT
    pill_l15.line.color.rgb = C_SLATE
    pill_l15.line.width = Pt(0.75)
    ptf_l15 = pill_l15.text_frame
    ptf_l15.margin_left = ptf_l15.margin_right = ptf_l15.margin_top = ptf_l15.margin_bottom = 0
    p = ptf_l15.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "VALVE'S LESSON: SUSTAINABLE PACE"
    p.font.name = "Segoe UI"
    p.font.size = Pt(9.5)
    p.font.bold = True
    p.font.color.rgb = C_SLATE

    # Schedule Bullets on Left
    ltb15 = s15.shapes.add_textbox(Inches(1.05), card_y15 + Inches(0.60), Inches(3.80), card_h15 - Inches(0.75))
    ltf15 = ltb15.text_frame
    ltf15.word_wrap = True
    ltf15.margin_left = ltf15.margin_right = ltf15.margin_top = ltf15.margin_bottom = 0

    p = ltf15.paragraphs[0]
    p.text = "Working Smart, Resting Well"
    p.font.name = "Georgia"
    p.font.size = Pt(19)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(6)

    p = ltf15.add_paragraph()
    p.text = "• Monday to Thursday (Focused Teamwork): "
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_DARK
    r2 = p.add_run()
    r2.text = "Work together in small groups on core lessons. Four to five hours of real creative focus, then time to reflect."
    r2.font.name = "Segoe UI"
    r2.font.size = Pt(10)
    r2.font.color.rgb = C_MUTED
    p.line_spacing = 1.16
    p.space_after = Pt(6)

    p = ltf15.add_paragraph()
    p.text = "• Friday (Quiet Focus & Personal Time): "
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_DARK
    r2 = p.add_run()
    r2.text = "Zero meetings. Dedicated time for quiet reading, trying new tools, polishing your own drafts, or resting."
    r2.font.name = "Segoe UI"
    r2.font.size = Pt(10)
    r2.font.color.rgb = C_MUTED
    p.line_spacing = 1.16
    p.space_after = Pt(6)

    p = ltf15.add_paragraph()
    p.text = "• Evenings & Weekends (True Downtime): "
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_DARK
    r2 = p.add_run()
    r2.text = "Notifications off. Rested minds make the best teachers and creative teammates."
    r2.font.name = "Segoe UI"
    r2.font.size = Pt(10)
    r2.font.color.rgb = C_MUTED
    p.line_spacing = 1.16

    # Ken Birdwell Portrait Plate on Right
    kpw = Inches(1.20)
    kph = Inches(1.50)
    kpx = Inches(5.05)
    kpy = card_y15 + Inches(0.68)

    if os.path.exists(plate_birdwell):
        s15.shapes.add_picture(plate_birdwell, kpx, kpy, kpw, kph)
        kpfr = s15.shapes.add_shape(MSO_SHAPE.RECTANGLE, kpx, kpy, kpw, kph)
        kpfr.fill.background()
        kpfr.line.color.rgb = C_CARD_BORDER
        kpfr.line.width = Pt(1)

    tb_kcap = s15.shapes.add_textbox(kpx - Inches(0.10), kpy + kph + Inches(0.08), kpw + Inches(0.20), Inches(1.30))
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
    p.text = "Valve Veteran"
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

    # Right: Month 2 Milestones
    r_box15 = s15.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.85), card_y15, col_w15, card_h15)
    r_box15.fill.solid()
    r_box15.fill.fore_color.rgb = C_GREEN_LIGHT
    r_box15.line.color.rgb = C_GREEN
    r_box15.line.width = Pt(1.5)

    pill_r15 = s15.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(7.10), card_y15 + Inches(0.18), Inches(3.4), Inches(0.34))
    pill_r15.fill.solid()
    pill_r15.fill.fore_color.rgb = C_CARD
    pill_r15.line.color.rgb = C_GREEN
    pill_r15.line.width = Pt(1)
    ptf_r15 = pill_r15.text_frame
    ptf_r15.margin_left = ptf_r15.margin_right = ptf_r15.margin_top = ptf_r15.margin_bottom = 0
    p = ptf_r15.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "OUR SHARED FOCUS FOR MONTH 2"
    p.font.name = "Segoe UI"
    p.font.size = Pt(9.5)
    p.font.bold = True
    p.font.color.rgb = C_GREEN

    rtb15 = s15.shapes.add_textbox(Inches(7.10), card_y15 + Inches(0.60), col_w15 - Inches(0.50), card_h15 - Inches(0.75))
    rtf15 = rtb15.text_frame
    rtf15.word_wrap = True
    rtf15.margin_left = rtf15.margin_right = rtf15.margin_top = rtf15.margin_bottom = 0

    p = rtf15.paragraphs[0]
    p.text = "Growing Together as a Team"
    p.font.name = "Georgia"
    p.font.size = Pt(19)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(8)

    p = rtf15.add_paragraph()
    p.text = "🤝 1. Smooth Everyday Habits"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(12)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(2)
    p = rtf15.add_paragraph()
    p.text = "Get comfortable using the Advice Process, form small co-creation hubs, and celebrate our first shared wins."
    p.font.name = "Segoe UI"
    p.font.size = Pt(11)
    p.font.color.rgb = C_MUTED
    p.line_spacing = 1.16
    p.space_after = Pt(4)

    p = rtf15.add_paragraph()
    p.text = "🎧 2. Clear, Engaging Lessons"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(12)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(2)
    p = rtf15.add_paragraph()
    p.text = "Create lessons that students genuinely love, using our 3 simple quality checks to ensure clarity and warmth."
    p.font.name = "Segoe UI"
    p.font.size = Pt(11)
    p.font.color.rgb = C_MUTED
    p.line_spacing = 1.16
    p.space_after = Pt(4)

    p = rtf15.add_paragraph()
    p.text = "🌱 3. Culture of Caring Feedback"
    p.font.name = "Segoe UI Semibold"
    p.font.size = Pt(12)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(2)
    p = rtf15.add_paragraph()
    p.text = "Build a team where everyone feels safe to give and receive kind, honest advice every single day."
    p.font.name = "Segoe UI"
    p.font.size = Pt(11)
    p.font.color.rgb = C_MUTED
    p.line_spacing = 1.16

    # Bottom Commences Banner
    c_box15 = s15.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.65), Inches(11.733), Inches(1.45))
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
    p.text = "🚀 READY FOR MONTH 2: TOGETHER AS A TEAM"
    p.font.name = "Segoe UI"
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = C_TERRA
    p.space_after = Pt(2)

    p = ch_tf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "“We succeed by supporting each other, talking through challenges openly, and having fun building something meaningful.”"
    p.font.name = "Georgia"
    p.font.size = Pt(13)
    p.font.italic = True
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(3)

    p = ch_tf.add_paragraph()
    p.alignment = PP_ALIGN.CENTER
    p.text = "Let's make Month 2 our best month yet—working as true partners, with high trust, mutual care, and genuine pride in what we build."
    p.font.name = "Segoe UI"
    p.font.size = Pt(11)
    p.font.color.rgb = C_MUTED

    # =========================================================================
    # Set Verbatim Speaker Notes on all 18 slides
    for idx, script in enumerate(SPEAKER_SCRIPTS):
        prs.slides[idx].notes_slide.notes_text_frame.text = script.strip()

    # Output Destinations
    # =========================================================================
    out_brain = r"C:\Users\Admin\.gemini\antigravity\brain\22e12183-dfc4-4430-9c2d-a5520fa49367\Architecting_Flatland_Month_1_Reflection.pptx"
    out_workspace = r"C:\Cursor AI\Architecting_Flatland_Month_1_Reflection.pptx"

    prs.save(out_brain)
    prs.save(out_workspace)
    print(f"Presentation saved successfully to:\n1. {out_brain}\n2. {out_workspace}")

def export_slides_to_png(pptx_path=r"C:\Cursor AI\Architecting_Flatland_Month_1_Reflection.pptx",
                         output_dir=r"C:\Cursor AI\exported_slides"):
    import win32com.client
    os.makedirs(output_dir, exist_ok=True)
    ppt = win32com.client.Dispatch("PowerPoint.Application")
    try:
        pres = ppt.Presentations.Open(os.path.abspath(pptx_path), WithWindow=False)
        count = pres.Slides.Count
        print(f"Exporting {count} slides to {output_dir}...")
        for i, slide in enumerate(pres.Slides):
            out_img = os.path.abspath(os.path.join(output_dir, f"slide_{i+1:02d}.png"))
            slide.Export(out_img, "PNG", 1920, 1080)
        pres.Close()
        print("Export completed successfully.")
    finally:
        ppt.Quit()

if __name__ == "__main__":
    build_presentation()
    if len(sys.argv) > 1 and sys.argv[1] == "--export":
        export_slides_to_png()
