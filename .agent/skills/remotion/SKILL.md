---
name: remotion
description: Programmatic React video creation, composition architectures, automated subtitles and captions via @remotion/captions, motion animations, and CLI/Node rendering pipelines. Use when the user asks to build video compositions with React, create TikTok or karaoke style subtitles, synchronize audio-visual timing, animate SVG elements or charts, or export videos with Remotion.
---

# Remotion Programmatic Video & Captions Skill

Build deterministic, frame-accurate video compositions using React, TypeScript, and Remotion. This skill covers video composition architecture, UDL-compliant captions, audio synchronization, and rendering.

---

## 1. Core Architecture

Remotion treats video as a pure function of frame numbers:
`Frame (0..durationInFrames) -> React UI`

```tsx
import { Composition, registerRoot } from "remotion";
import { MainVideo } from "./MainVideo";

export const Root: React.FC = () => {
  return (
    <Composition
      id="SlideExplainer"
      component={MainVideo}
      durationInFrames={30 * 60} // 60 seconds at 30 fps
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        title: "UDL Staff Training: Modular Learning",
      }}
    />
  );
};

registerRoot(Root);
```

### Essential Primitives
- `<AbsoluteFill>`: A `div` pinned to `top: 0, left: 0, right: 0, bottom: 0`. Use as the root of every scene or layer.
- `<Sequence from={frame} durationInFrames={length}>`: Shifts local `frame 0` to the starting time. Children render in isolated time windows.
- `<Series>`: Sequentially chains scenes end-to-end without manual frame math.
- `useCurrentFrame()`: Returns the integer frame number of the current render.
- `useVideoConfig()`: Returns `{ fps, width, height, durationInFrames }`.

---

## 2. Animation Math (Springs & Interpolation)

Never use CSS transitions or `@keyframes` for timing-critical video; use Remotion's frame-driven interpolation:

```tsx
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const frame = useCurrentFrame();
const { fps } = useVideoConfig();

// Smooth entry spring
const entrance = spring({
  frame,
  fps,
  config: { damping: 12, mass: 0.5, stiffness: 100 },
});

// Interpolation with clamping
const opacity = interpolate(frame, [0, 15], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
```

---

## 3. Universal Design for Learning (UDL) Captions & Subtitles

UDL guidelines mandate multi-modal representation: learners need synchronized visual captions alongside speech audio.

### Installing Captions Engine
```bash
npm i @remotion/captions
```

### Caption Data Contract
All captions must conform to the JSON `Caption` schema:
```ts
import type { Caption } from "@remotion/captions";

type Caption = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};
```

### Generating TikTok / Explainer Word Highlights
Use `createTikTokStyleCaptions()` to paginate tokens without word overflow:

```tsx
import { useMemo } from "react";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Caption } from "@remotion/captions";

interface SubtitlesProps {
  captions: Caption[];
}

export const SubtitlesOverlay: React.FC<SubtitlesProps> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;

  // Group tokens into readable 1-3 word pages
  const { pages } = useMemo(() => {
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: 1200,
    });
  }, [captions]);

  // Find active page
  const activePage = pages.find(
    (p) => currentTimeMs >= p.startMs && currentTimeMs < p.endMs
  );

  if (!activePage) return null;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 110 }}>
      <div
        style={{
          backgroundColor: "rgba(10, 15, 30, 0.85)",
          padding: "14px 28px",
          borderRadius: "16px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          display: "flex",
          gap: "10px",
          backdropFilter: "blur(8px)",
        }}
      >
        {activePage.tokens.map((token, i) => {
          const isActive = currentTimeMs >= token.startMs && currentTimeMs < token.endMs;
          return (
            <span
              key={i}
              style={{
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontSize: 36,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: isActive ? "#FBBF24" : "#FFFFFF", // Amber highlight
                transform: isActive ? "scale(1.08)" : "scale(1.0)",
                transition: "transform 0.1s ease",
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```

### Mobile / Social Safe-Zone Rules
- **MarginV Rule**: Platform UI covers the bottom 25-30% of vertical frames (1080x1920).
- Keep caption baselines at least 90px (or 15-20% viewport height) above the bottom edge.

---

## 4. Audio Synchronization & Pop-Free Transitions

When mixing voiceover (e.g. Kokoro TTS) with background ambiance or video cuts:
- Always apply **30ms audio fades** (`volume` interpolation) at every cut boundary to eliminate DC-offset clicks and pops.
- Use `staticFile()` for local audio assets located in the `public/` directory.

```tsx
import { Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const VoiceTrack: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 30ms fade-in (approx 1 frame at 30fps)
  const vol = Math.min(1.0, frame / 2);

  return (
    <Audio
      src={staticFile("narration_slide_01.wav")}
      volume={vol}
    />
  );
};
```

---

## 5. Rendering Pipelines

### CLI Rendering
```bash
# Render production MP4 (H.264, visually lossless CRF 18)
npx remotion render src/index.ts SlideExplainer out/video.mp4 --crf=18 --pixel-format=yuv420p

# Render preview still frame
npx remotion still src/index.ts SlideExplainer out/frame_90.png --frame=90
```

### Node.js Programmatic API
```ts
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";

async function buildVideo() {
  const bundleLocation = await bundle(path.resolve("./src/index.ts"));
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "SlideExplainer",
  });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    crf: 18,
    outputLocation: "out/final.mp4",
  });
}
```
