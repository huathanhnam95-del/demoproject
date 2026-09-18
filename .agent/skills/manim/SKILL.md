---
name: manim
description: Conceptual explainer video planning, scene-by-scene storyboard decomposition (scenes.md), 3Blue1Brown-style mathematical animations, and Manim Community Edition (ManimCE) programmatic rendering. Use when the user asks to explain complex technical/math concepts visually, plan an explainer video, compose animated scene breakdowns, or write Manim animation code.
---

# Manim Conceptual Explainer Video Skill

Design and produce clear educational visual animations (3Blue1Brown aesthetic) using Manim and structured scene planning.

---

## 1. Composition Workflow (Plan Before Coding)

Never write raw Manim Python code without a structured scene storyboard (`scenes.md`).

### Phase 1: Clarify Narrative Hook & Key Insight
1. **Core Problem**: What confusion or misconception does this video address?
2. **The "Aha Moment"**: What visual metaphor turns an abstract formula into an intuitive insight?
3. **Audience Level**: Foundation (intuitive geometry) vs. Advanced (rigorous equations).

### Phase 2: Create `scenes.md`
Decompose into atomic visual scenes (each 5-15 seconds):
```markdown
# [Topic Title]

## Narrative Arc
- Scene 1 (Hook): Introduce paradoxical puzzle or real-world problem.
- Scene 2 (Intuition): Spatial metaphor (e.g. balance beam, vector field, area transformation).
- Scene 3 (Formalism): Equations reveal themselves as descriptions of the spatial intuition.
- Scene 4 (Resolution): The initial puzzle solved in one elegant visual sweep.
```

---

## 2. ManimCE Best Practices

Always write clean, modern Manim Community Edition code (`from manim import *`):

```python
from manim import *

class ModularLearningExplainer(Scene):
    def construct(self):
        # 1. Theme Configuration
        self.camera.background_color = "#0B0F19"
        
        # 2. Text & LaTeX Hierarchy
        title = Text("Modular Learning Pipeline", font="sans-serif", weight=BOLD, font_size=40)
        title.to_edge(UP, buff=0.8)
        
        # 3. Geometric Shapes & VGroups
        box_slide = RoundedRectangle(corner_radius=0.2, height=2.0, width=3.2, color=BLUE)
        label_slide = Text("Slide Canvas", font_size=20).move_to(box_slide)
        slide_group = VGroup(box_slide, label_slide).shift(LEFT * 4)

        box_tts = RoundedRectangle(corner_radius=0.2, height=2.0, width=3.2, color=TEAL)
        label_tts = Text("Kokoro TTS", font_size=20).move_to(box_tts)
        tts_group = VGroup(box_tts, label_tts).shift(ORIGIN)

        box_video = RoundedRectangle(corner_radius=0.2, height=2.0, width=3.2, color=AMBER)
        label_video = Text("Veo 3.1 B-roll", font_size=20).move_to(box_video)
        video_group = VGroup(box_video, label_video).shift(RIGHT * 4)

        arrows = VGroup(
            Arrow(slide_group.get_right(), tts_group.get_left(), buff=0.2, color=GRAY),
            Arrow(tts_group.get_right(), video_group.get_left(), buff=0.2, color=GRAY),
        )

        # 4. Choreographed Animations
        self.play(FadeIn(title, shift=DOWN * 0.3), run_time=0.8)
        self.play(
            LaggedStart(
                Create(slide_group),
                Create(arrows[0]),
                Create(tts_group),
                Create(arrows[1]),
                Create(video_group),
                lag_ratio=0.35,
            ),
            run_time=2.5,
        )
        self.wait(1.5)

        # 5. Focus & Highlighting (Spotlight)
        self.play(
            tts_group.animate.scale(1.15).set_color(YELLOW),
            slide_group.animate.fade(0.6),
            video_group.animate.fade(0.6),
            run_time=1.0,
        )
        self.wait(2.0)
```

---

## 3. Positioning Rules & Safe Zones
- **Coordinate System**: Center is `(0, 0, 0)`. Left/Right spans `[-7.1, 7.1]`, Top/Bottom spans `[-4.0, 4.0]`.
- Always use relative alignment: `.next_to(target, DIRECTION, buff=...)` or `.arrange(RIGHT, buff=...)`.
- Avoid hardcoded screen-edge floats; use `to_edge(UP, buff=0.8)`.

---

## 4. Pipeline Rendering Commands

```bash
# Fast preview (480p, 15fps)
manim -pql scene.py ModularLearningExplainer

# High quality production render (1080p, 60fps)
manim -pqh scene.py ModularLearningExplainer

# Transparent background for video overlay (WebM/MOV with alpha)
manim -qh --format=mov -t scene.py ModularLearningExplainer
```
