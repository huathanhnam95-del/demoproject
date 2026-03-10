# Google AI Studio Prompt Pack For BEL Preloader

## Recommended Tools

Use your Google AI Studio API key with the Gemini API, not Vertex AI, for concept generation and motion references:

- `gemini-2.5-flash-image`
  Best for fast moodframes, lighting passes, and iterative design exploration.
- `gemini-3-pro-image-preview`
  Best for higher-touch art direction and image editing conversations.
- `Veo 3.1`
  Best for short motion studies to refine timing, camera movement, and premium transitions.

## Visual Direction

- Brand palette:
  - Primary blue: `#1a73e8`
  - Success green: `#1e8e3e`
  - Warning amber: `#f9ab00`
  - Light neutral: `#f8f9fa`
  - Text charcoal: `#202124`
- Mood:
  - sleek
  - modern
  - restrained
  - premium
  - educational product
  - not flashy, not gaming-neon

## Image Prompt

```text
Create a premium splash-screen concept for an English learning web app called BEL.

Style: sleek, modern, editorial, polished, premium product launch.
Composition: centered BEL monogram, cinematic depth, soft atmospheric haze, subtle reflections, elegant lighting.
Palette: deep navy-black background, Google-blue highlights (#1a73e8), faint green accents (#1e8e3e), restrained amber edge light (#f9ab00), soft white typography (#f8f9fa).
Materials: brushed metal and glass, refined glow, subtle volumetric light, no loud neon, no red, no orange-heavy tones.
Mood: calm confidence, premium SaaS, intelligent, smooth, world-class.
Avoid: Marvel imitation, aggressive action energy, saturated gaming style, clutter, lens flare overload.

Output as a single high-end UI concept frame suitable for a loading screen.
```

## Variation Prompt

```text
Generate 4 visual variations of the same BEL preloader concept:
1. Minimal glass-and-metal
2. Blue-lit editorial luxury
3. Soft atmospheric premium tech
4. Elegant education brand hero

Keep layout consistent, only vary lighting treatment, material finish, and intensity.
```

## Video Prompt

```text
Create a 6-second premium loading animation study for a product called BEL.

Scene: a three-letter BEL monogram in a dark navy environment.
Camera: slow and controlled dolly-in, subtle lateral drift, no fast whip moves.
Lighting: cool blue key light, soft green ambient accent, very restrained amber rim light.
Motion: smooth, luxurious, calm, deliberate, high-end.
End state: logo settles in the center and feels confident and polished.
Avoid: flashy explosions, fast cuts, superhero energy, red-dominant palette, excessive particles.
```

## Editing Prompt

```text
Take this BEL loader frame and restyle it to feel more premium and on-brand for a modern education SaaS product.
Shift the palette toward deep navy and Google-blue accents.
Reduce harsh glow.
Increase material realism.
Keep the composition simple and elegant.
```

## Practical Use

- Generate still frames first.
- Pick one lighting direction.
- Generate a short Veo motion study only after the still direction is approved.
- Use the outputs as reference, not as shipped runtime assets, unless you explicitly want a video-based splash.
