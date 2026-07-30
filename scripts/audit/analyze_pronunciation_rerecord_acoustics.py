"""Analyze independent acoustic syllable and stress evidence for latest re-recordings."""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.local_server.server import analyze_audio_v2  # noqa: E402


MANIFEST = ROOT / "test-results/pronunciation-rerecord-analysis/latest-clean-by-word-manifest.json"
AUDIO_DIR = ROOT / "test-results/pronunciation-segmentation-corpus"
OUTPUT = ROOT / "test-results/pronunciation-rerecord-analysis/acoustic-analysis.json"
VOWELS = "aeiouæɑɒɔəɛɜɪʊʌɐɤɨʉɯyøœɶ"


def target_stress_index(reference_ipa: str) -> int | None:
    ipa = str(reference_ipa or "").strip("/[] ")
    if "ˈ" not in ipa:
        return None
    prefix = ipa.split("ˈ", 1)[0]
    return len(re.findall(f"[{VOWELS}]+", prefix))


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
    entries = [entry for entry in manifest["entries"] if "-20260730-" in entry["sampleId"]]
    results = []
    for index, entry in enumerate(entries, 1):
        wav_path = AUDIO_DIR / f"{entry['sampleId']}.wav"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            analysis = analyze_audio_v2(str(wav_path), expected_syllable_count=None, native=False)
        observed = analysis.get("observed", {})
        stress = observed.get("stressEvidence", {})
        expected = int(entry["expectedObservedCount"])
        observed_count = int(observed.get("syllableCount") or 0)
        expected_stress = target_stress_index(entry.get("referenceIpa", ""))
        detected_stress = stress.get("primaryStress")
        stress_comparable = (
            observed_count == expected
            and stress.get("rateable") is True
            and expected_stress is not None
            and expected_stress < expected
        )
        pitch_values = [value for value in analysis.get("pitch", {}).get("values", []) if value]
        results.append({
            "sampleId": entry["sampleId"],
            "targetWord": entry["targetWord"],
            "expectedSyllables": expected,
            "acousticSyllables": observed_count,
            "countMatches": observed_count == expected,
            "qualityRateable": analysis.get("quality", {}).get("rateable") is True,
            "pitchFrames": len(pitch_values),
            "targetStressIndex": expected_stress,
            "detectedStressIndex": detected_stress,
            "stressRateable": stress.get("rateable") is True,
            "stressComparable": stress_comparable,
            "stressMatches": stress_comparable and detected_stress == expected_stress,
            "stressConfidence": stress.get("confidence"),
        })
        print(f"[{index}/{len(entries)}] {entry['targetWord']}")

    comparable = [row for row in results if row["stressComparable"]]
    summary = {
        "samples": len(results),
        "qualityRateable": sum(row["qualityRateable"] for row in results),
        "pitchAvailable": sum(row["pitchFrames"] > 0 for row in results),
        "acousticCountCorrect": sum(row["countMatches"] for row in results),
        "stressRateable": sum(row["stressRateable"] for row in results),
        "stressComparable": len(comparable),
        "stressCorrect": sum(row["stressMatches"] for row in comparable),
    }
    OUTPUT.write_text(json.dumps({"summary": summary, "results": results}, indent=2) + "\n", encoding="utf8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
