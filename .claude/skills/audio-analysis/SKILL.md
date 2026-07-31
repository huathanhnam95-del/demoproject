---
name: audio-analysis
description: Praat and Python-based pronunciation analysis for speech assessment. Use when working with audio processing, pitch/formant extraction, syllable segmentation, or pronunciation feedback.
---

# Audio Analysis Skill

This skill covers **pronunciation assessment** using Praat scripts and Python (Parselmouth) for acoustic phonetic analysis.

## Project Context

The backend uses:

- **Praat scripts** for syllable detection, pitch (F0), and intensity analysis
- **Parselmouth** Python library for Praat integration
- **Flask/FastAPI** to serve analysis results

Key files:

- `backend/server.py` - Main API server
- `backend/*.praat` - Praat scripts for analysis
- `pronunciation-analyzer/` - Frontend visualization

---

## Core Acoustic Features

| Feature | Purpose | Praat Object |
|---------|---------|--------------|
| **Pitch (F0)** | Intonation, stress patterns | `To Pitch...` |
| **Formants (F1-F4)** | Vowel quality, articulation | `To Formant (burg)...` |
| **Intensity** | Loudness, stress | `To Intensity...` |
| **Duration** | Segment timing | TextGrid intervals |
| **Jitter/Shimmer** | Voice quality | PointProcess |

---

## Syllable Segmentation Workflow

1. **Extract intensity contour** from audio
2. **Identify peaks** (potential syllable nuclei)
3. **Apply pruning** when `expected_syllables` is provided:

   ```python
   def prune_syllables_to_expected(syllables, expected_count):
       # Sort by intensity (weakest first)
       # Remove lowest-intensity segments until count matches
       # Preserve temporal order after pruning
   ```

4. **Return syllable boundaries** with timing and pitch data

---

## Common Issues & Solutions

### Issue: Wrong syllable count

**Cause**: Background noise creates false peaks
**Fix**: Use `expected_syllables` parameter to guide pruning

### Issue: `KeyError: 'avgPitch'`

**Cause**: `peaks_to_syllables()` missing pitch calculation
**Fix**: Ensure pitch is computed within each syllable interval

### Issue: Audio format errors

**Required format**: WAV, 16kHz or higher, mono

---

## Parselmouth Patterns

```python
import parselmouth
from parselmouth.praat import call

# Load sound
sound = parselmouth.Sound("audio.wav")

# Extract pitch
pitch = sound.to_pitch()
pitch_values = pitch.selected_array['frequency']

# Extract intensity
intensity = sound.to_intensity()

# Run Praat script
call(sound, "To TextGrid (silences)", 
     -25, 0.1, 0.1, "silent", "sounding")
```

---

## Testing Checklist

- [ ] Test with known word (e.g., "anonymous" = 4 syllables)
- [ ] Verify pitch contour matches native reference
- [ ] Check syllable boundaries align with phoneme transitions
- [ ] Validate JSON response structure contains all required fields
