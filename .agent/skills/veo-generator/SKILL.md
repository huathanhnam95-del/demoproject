---
name: veo-generator
description: Generates high-fidelity AI B-roll video clips using Google Veo 3.1 (veo-3.1-fast-generate-preview) with prompt engineering, camera controls, deterministic SHA-256 asset caching, and video pipeline integration. Use when the user asks to generate B-roll video from prompts or reference images, create cinematic clips for training slides, integrate Veo video into narration pipelines, or invoke scripts/generate_veo_broll.py.
---

# Google Veo 3.1 B-Roll Video Generation Skill

Generate cinematic, contextual video clips using Google Veo 3.1 (`veo-3.1-fast-generate-preview`) via the official `google-genai` SDK and our project's cached generator utility.

---

## 1. Quick Start via Project Utility

Always use the project's tested, cached runner rather than ad-hoc API calls:

```bash
# Generate 5s landscape 16:9 B-roll
python scripts/generate_veo_broll.py \
  --prompt "Cinematic macro tracking shot of hands assembling modular wooden blocks on an architect's desk, soft warm morning lighting, shallow depth of field" \
  --aspect-ratio 16:9 \
  --duration 5 \
  --resolution 720p

# Image-to-Video (animate starting frame from slide or photo)
python scripts/generate_veo_broll.py \
  --prompt "Slow cinematic push-in shot, subtle atmospheric dust particles glowing in golden sunlight" \
  --image "path/to/starting_frame.png" \
  --duration 5
```

### Dry Run (Test prompt & cache without consuming credits)
```bash
python scripts/generate_veo_broll.py --prompt "Test scene" --dry-run
```

---

## 2. Programmatic Python API

Import `generate_veo_broll` directly in any automated slide-to-video narration script:

```python
from scripts.generate_veo_broll import generate_veo_broll

result = generate_veo_broll(
    prompt="Smooth aerial drone shot rising above a modern collaborative tech workspace",
    duration=5,
    aspect_ratio="16:9",
    resolution="720p",
    force=False, # Reuses existing cached .mp4 if parameters match
)

video_path = result["video_path"]
print(f"Generated or cached video ready at: {video_path}")
```

---

## 3. Veo 3.1 Prompt Engineering Guidelines

To avoid typical AI video hallucinations, morphing artifacts, or cartoonish textures, structure prompts into four distinct layers:

### Prompt Anatomy:
1. **Camera Movement (First clause)**:
   - "Slow cinematic dolly zoom into..."
   - "Smooth horizontal tracking shot across..."
   - "Static locked-off macro lens focused on..."
   - "Gentle aerial crane shot ascending above..."
2. **Subject & Physical Action**:
   - Clear, singular, grounded physical actions (e.g. "hands turning a brass dial", "steam rising slowly from fresh espresso", "data streams pulsing along optic fiber lines").
   - Avoid chaotic multi-character combat or fast athletic maneuvers.
3. **Environment & Atmosphere**:
   - "Minimalist Scandinavian studio, warm natural daylight through large frosted windows".
   - "Dark high-tech cleanroom, soft blue ambient rim lighting".
4. **Cinematography & Style Descriptors**:
   - "35mm anamorphic lens, shallow depth of field, subtle film grain, photo-realistic, neutral color grade".
   - Avoid generic buzzwords ("photorealistic 8k unreal engine") — specify concrete optical properties instead.

---

## 4. Asset Caching & Credit Protection

Veo 3.1 video generation consumes API quotas and takes 30-90 seconds per clip.
`scripts/generate_veo_broll.py` calculates a deterministic SHA-256 hash over:
`model | normalized_prompt | aspect_ratio | duration | resolution | image_hash`

- If `<slug>_<hash>.mp4` exists in `output/veo_broll/`, the generator returns the local path instantly (`cached: true`).
- Use `--force` only when intentionally revising an existing prompt.
- Metadata is automatically preserved in `<slug>_<hash>.json` for auditability.

---

## 5. Compositing with Slides & Audio Pipeline

To integrate Veo B-roll into slides:
1. **Slide Transition**: Use FFmpeg or OpenCV smooth dissolve (`fade=in:st=...:d=0.5`) to transition from static slide to the 5s Veo video.
2. **Narration Sync**: Generate the narration audio chunk using Kokoro TTS (`http://127.0.0.1:8880`), inspect duration via `soundfile.info()`, and set Veo duration to match (5s or 6s).
3. **Audio Fades**: Always cross-fade audio streams by 30ms to prevent pops.
