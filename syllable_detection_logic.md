# Syllable Detection Logic & Algorithms

This document details the syllable detection mechanisms used in the application. The system employs a hybrid approach, combining **Acoustic Analysis** (signal processing of user audio) and **Lexical Analysis** (processing dictionary data).

## 1. Acoustic Syllable Detection (Backend)

The core acoustic analysis is performed in `backend/server.py` using the `parselmouth` library (a Python wrapper for Praat). The logic has evolved from simple intensity peak detection to a robust **Multi-Cue Boundary Detection** system.

### Theoretical Basis

The implementation is grounded in phonetic research:

- **de Jong & Wempe (2009)**: "Praat script to detect syllable nuclei and acoustic peaks in speech". Provided the foundation for intensity dip thresholds (`min_dip = 2dB`) and voiced-only peak detection.
- **Tepperman & Narayanan (2005)**: "Automatic syllable stress detection using prosodic features". informed the pitch transition thresholds (`15Hz` change indicative of boundary).
- **Kochanski et al. (2005)**: "Loudness predicts stress in English". Used to weight the importance of intensity vs. pitch in scoring.

### The Algorithm: `detect_syllables`

The high-level process flow is:

1. **Speech Activity Detection**:
    - Calculates median intensity of voiced frames.
    - Sets a dynamic threshold (`median - 5dB` to `median - 8dB`) to identify the speech region, trimming silence.

2. **Adaptive Peak Detection**:
    - Iterates through intensity readings to find "nuclei candidates".
    - **Constraint**: A peak must be **voiced** (pitch > 0) to be considered a syllable nucleus.
    - **Dip Constraint**: A peak is only valid if separated from the previous peak by a "dip" in intensity (defaults to `2.0 dB`).
    - **Retry Mechanism**: If the number of found peaks < expected syllables, the system retries with progressively more sensitive thresholds.

3. **Boundary Refinement (`BoundaryDetector` Class)**:
    Once peaks are identified, the system calculates precise boundaries using a **Weighted Multi-Cue Model**. This addresses common failures like identifying diphthongs (e.g., /aɪ/ in "buy") as two syllables due to internal intensity dips.

    The detector scores potential boundaries based on four weighted cues:
    - **Voicing Transitions (40%)**: Changes from voiced to unvoiced (or vice versa) are the strongest indicators of syllable edges.
    - **Spectral Centroid (30%)**: Tracks the "center of gravity" of the frequency spectrum. Vowels have lower centroids (~500-1500Hz); fricatives have high centroids. Rapid changes indicate phoneme boundaries.
    - **Intensity Minimum (20%)**: The traditional method. Useful but prone to errors within complex nuclei.
    - **Amplitude Envelope (10%)**: The rate of change of the smoothed amplitude envelope.

4. **Oversized Syllable Splitting**:
    - If a syllable exceeds `MAX_SYLLABLE_DURATION` (0.45s), it is flagged for splitting.
    - **Method 1 (Pitch)**: Checks for significant pitch jumps (>15Hz) indicating a change in stress or tone (Tepperman & Narayanan).
    - **Method 2 (Intensity)**: Looks for secondary intensity mins that didn't trigger the primary detector.
    - **Method 3 (Fallback)**: Equidistant time splitting.

5. **Pruning**:
    - If `expected_syllables` is known (from the dictionary), the system forces the detected count to match by removing the "weakest" candidates.
    - **Scoring**: Syllables are scored by Duration, Intensity, and Voicing. Short, quiet, unvoiced segments are pruned first.

## 2. Lexical Syllable Analysis (Dictionary)

The application fetches "truth data" from the Merriam-Webster API. However, the raw API data often lacks accurate syllable counts for complex words. We implement a custom parser in `count_ipa_syllables`.

### IPA Processing Logic

The primary source of truth is the International Phonetic Alphabet (IPA) string, not the headword entry.

1. **Normalization**:
    - Converts various Unicode characters (e.g., `ɡ` vs `g`, `:` vs `ː`) to a standard set.
    - Strips stress markers (`ˈ`, `ˌ`) and separators (`.`, `-`) which can be inconsistent.

2. **Vowel Counting**:
    - The system scans the cleaned IPA string against a prioritized list of **Vowel Nuclei**.
    - **Order Matters**: Long diphthongs/triphthongs (`aɪə`, `ɔɪ`) are checked *before* single vowels (`i`, `e`) to prevent double-counting.
    - **Syllabic Consonants**: Explicitly counts syllabic rhotics like `ɚ` (as in "butter") and `ɝ` (as in "bird") as nuclei.
    - **Length Marks**: Ignores length markers (`ː`) for counting purposes.

3. **Orthographic Splitting**:
    - Since IPA doesn't map 1:1 to written letters, the system uses an approximation heuristic to split the written word for display (e.g., "pho-to-graph").
    - It identifies vowel clusters in the text and attempts to split at consonant midpoints between them.

## 3. Configuration Parameters

Research-backed constants defined in `AnalysisConfig`:

| Parameter | Value | Source/Reasoning |
| :--- | :--- | :--- |
| `PITCH_CEILING` | 500 Hz | Standard max for non-child speech (Praat). |
| `PITCH_FLOOR` | 75 Hz | Captures deep male voices. |
| `TIME_STEP` | 10 ms | Standard resolution for speech analysis. |
| `INITIAL_DIP_THRESHOLD` | 2.0 dB | de Jong & Wempe (2009). |
| `SENSITIVE_DIP_THRESHOLD` | 1.5 dB | Lowered threshold for weak syllables (schwas). |
| `MIN_SYLLABLE_DURATION` | 40 ms | Minimum biological limit for a nucleus. |
| `MAX_SYLLABLE_DURATION` | 450 ms | Upper bound derived from TIMIT corpus stats. |
| `PITCH_TRANSITION_THRESHOLD`| 15 Hz | Threshold for significant pitch change. |
| `VOWEL_END_LOOKAHEAD_FACTOR`| 1.5 | Multiplier of MIN_SYLLABLE_DURATION for lookahead. |
| `VOWEL_END_INTENSITY_DROP`| 0.15 | 15% relative drop threshold (speaker-normalized). |
| `VOWEL_END_FLUX_THRESHOLD`| 0.4 | Normalized intensity rate-of-change for voiced clusters. |

## 4. Vowel-End Clamping (Onset Cluster Fix)

A critical enhancement to prevent **onset cluster leakage** (e.g., `/pr/` in "improve" bleeding into the previous syllable's audio).

### The Problem

Traditional intensity-based boundaries drift too late for clusters like `/mpr/`:

- `/m/` is voiced → no energy dip
- `/p/` has brief closure → often missed
- `/r/` is vowel-like → spectrally similar to nucleus

Result: Boundaries land mid-cluster, causing perceptual mismatch when playing syllable audio.

### The Solution: `find_vowel_end()`

Instead of asking "where does energy change?", this asks **"where does the vowel END?"**

**Algorithm:**

1. Start at syllable nucleus (peak)
2. Walk forward with dynamic lookahead (`1.5 × MIN_SYLLABLE_DURATION`, capped at 150ms)
3. Return the first point where:
   - **Voicing breaks** (voiced → unvoiced transition), OR
   - **Intensity drops sharply** (> 15% of median intensity), OR
   - **Intensity flux spikes** (fallback for fully-voiced clusters like `/mbr/`)

**Constraint Enforcement:**

```
boundary = min(candidate_from_detector, vowel_end)
boundary = max(boundary, start_time + MIN_SYLLABLE_DURATION)
```

This guarantees onset consonants belong to the *next* syllable, matching linguistic onset-maximization rules.
