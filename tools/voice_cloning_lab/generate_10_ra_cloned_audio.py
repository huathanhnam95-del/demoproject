"""
F5-TTS 10-Question PTE Read Aloud Automated Generation & ASR Verification Pipeline
Zero-Shot Neural Voice Cloning from User Calibrated Voice Recording
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import Dict, List, Any

# Ensure workspace root is in sys.path
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import soundfile as sf
import numpy as np

from tools.voice_cloning_lab.config import SAMPLES_DIR, RA10_DIR, TARGET_SAMPLE_RATE
from tools.voice_cloning_lab.engines.f5_tts_engine import F5TTSEngine
from tools.voice_cloning_lab.evaluators.similarity_scorer import SpeakerSimilarityScorer
from tools.voice_cloning_lab.evaluators.intelligibility import IntelligibilityEvaluator

# --- 10 Authentic Diverse PTE Read Aloud Questions ---
RA_10_QUESTIONS = [
    {
        "id": "ra_18",
        "num": 1,
        "title": "RA #18: Research Methodology",
        "topic": "Academic Research & Data Science",
        "text": "Certain types of methodology are more suitable for some research projects than others. For example, the use of questionnaires and surveys is more suitable for quantitative research, whereas interviews and focus groups are more often used for qualitative research purposes."
    },
    {
        "id": "ra_15",
        "num": 2,
        "title": "RA #15: Competition Enthusiasm",
        "topic": "Social Sciences & Public Discourse",
        "text": "The insults and criticism were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion, turning what began as a niche debate into a nationwide phenomenon."
    },
    {
        "id": "ra_419",
        "num": 3,
        "title": "RA #419: Health-Monitoring Devices",
        "topic": "Biomedical Engineering & Wearables",
        "text": "A stretchable system that can harvest energy from human breathing and motion for use in wearable health-monitoring devices may be possible, according to an international team of researchers."
    },
    {
        "id": "ra_731",
        "num": 4,
        "title": "RA #731: Ancient Ice Storage",
        "topic": "Archaeology & Historical Infrastructure",
        "text": "The cold storage structures are located south of the main city center. These large structures would have had sheets of ice built up on the ground level over the course of the winter to provide year-round ice supplies."
    },
    {
        "id": "ra_402",
        "num": 5,
        "title": "RA #402: Species Susceptibility",
        "topic": "Epidemiology & Comparative Biology",
        "text": "An analysis of ten different species finds that humans, followed by ferrets and, to a lesser extent, cats, civets and dogs, are the most susceptible animals to SARS-CoV-2 infection. These findings help identify key targets for transmission control."
    },
    {
        "id": "ra_8",
        "num": 6,
        "title": "RA #8: Astrophysics Twins",
        "topic": "Astrophysics & Space Science",
        "text": "The situation is similar to a pregnant woman who has twin babies in her belly, says Avi of the Smithsonian Center for Astrophysics. He's proposing the idea in a paper that's been accepted for publication in the Astrophysical Journal Letters."
    },
    {
        "id": "ra_312",
        "num": 7,
        "title": "RA #312: Ocean Thermal Equilibrium",
        "topic": "Oceanography & Climatology",
        "text": "Major ocean currents act as global conveyor belts, transferring vast quantities of heat from the tropics toward polar regions. Any disruption to this thermal equilibrium could accelerate atmospheric instability worldwide."
    },
    {
        "id": "ra_521",
        "num": 8,
        "title": "RA #521: Urban Agriculture",
        "topic": "Agronomy & Sustainable Cities",
        "text": "Vertical farming and precision agriculture offer sustainable pathways to enhance urban food security while minimizing arable land consumption and reducing water usage by up to ninety percent."
    },
    {
        "id": "ra_604",
        "num": 9,
        "title": "RA #604: Cognitive Linguistics",
        "topic": "Neuroscience & Psycholinguistics",
        "text": "Psycholinguistic investigations demonstrate that bilingual individuals frequently utilize distinct cognitive pathways depending on which language they are actively processing, reflecting deep structural plasticity in the human brain."
    },
    {
        "id": "ra_789",
        "num": 10,
        "title": "RA #789: Renewable Energy Storage",
        "topic": "Clean Tech & Electrical Grids",
        "text": "Grid-scale battery infrastructure and pumped-storage hydroelectricity are essential for mitigating the intermittent generation of solar and wind installations, ensuring continuous baseline electricity delivery."
    }
]


def run_batch_generation(force: bool = False):
    """Execute F5-TTS generation, ASR transcription, and SECS similarity for 10 RA questions."""
    print("=" * 70)
    print("F5-TTS 10-QUESTION PTE READ ALOUD BATCH CLONING PIPELINE")
    print("=" * 70)

    # 1. Locate user's calibrated reference recording
    ref_matches = list(SAMPLES_DIR.glob("my_saved_voice.*"))
    if not ref_matches:
        ref_matches = list(SAMPLES_DIR.glob("*.webm")) + list(SAMPLES_DIR.glob("*.wav"))
    if not ref_matches:
        raise FileNotFoundError(f"No reference audio found in {SAMPLES_DIR}")
    
    ref_audio_path = str(ref_matches[0])
    ref_transcript = "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion."
    print(f"[Pipeline] User Reference Audio: {ref_audio_path}")
    print(f"[Pipeline] Matched Reference Text: {ref_transcript}")

    # 2. Initialize F5-TTS Engine, Scorer, and Whisper Evaluator
    print("[Pipeline] Initializing F5-TTS Engine on CPU...")
    f5_engine = F5TTSEngine()
    f5_engine.load_model()

    print("[Pipeline] Initializing Evaluators (Resemblyzer & Faster-Whisper)...")
    scorer = SpeakerSimilarityScorer()
    intel = IntelligibilityEvaluator()

    results = []
    total_start_time = time.perf_counter()

    for idx, item in enumerate(RA_10_QUESTIONS):
        q_id = item["id"]
        q_num = item["num"]
        q_title = item["title"]
        q_text = item["text"]
        out_filename = f"{q_id}_f5_cloned.wav"
        out_path = RA10_DIR / out_filename

        print(f"\n[{q_num}/10] Synthesizing: {q_title}")
        print(f"Target Text: \"{q_text}\"")

        # Check if already synthesized in previous run
        needs_synth = True
        duration_sec = 0.0
        latency_sec = 0.0
        rtf_val = 0.0

        if not force and out_path.exists() and out_path.stat().st_size > 20000:
            try:
                info = sf.info(str(out_path))
                if info.duration > 3.0:
                    needs_synth = False
                    duration_sec = info.duration
                    latency_sec = 0.0
                    rtf_val = 0.0
                    print(f"[{q_num}/10] Found existing synthesized audio ({duration_sec:.2f}s). Skipping synthesis.")
            except Exception:
                needs_synth = True

        if needs_synth:
            synth_res = f5_engine.synthesize(
                target_text=q_text,
                reference_audio_path=ref_audio_path,
                reference_transcript=ref_transcript,
                output_filename=str(out_path.name)
            )

            # Move to RA10_DIR if saved in default results dir
            if Path(synth_res.audio_path).exists() and Path(synth_res.audio_path) != out_path:
                import shutil
                shutil.copy2(synth_res.audio_path, str(out_path))
            duration_sec = synth_res.duration_seconds
            latency_sec = synth_res.latency_seconds
            rtf_val = synth_res.rtf

        # 3. Transcribe with Whisper ASR to verify exact word generation
        print(f"[{q_num}/10] Running Whisper ASR Transcription...")
        asr_transcript = ""
        wer = 1.0
        try:
            asr_transcript = intel.transcribe(str(out_path))
            wer = intel.compute_wer(q_text, asr_transcript)
        except Exception as e:
            print(f"[{q_num}/10] Whisper transcription error: {e}")
            asr_transcript = "(ASR error)"

        # 4. Compute Resemblyzer speaker similarity
        secs = scorer.compute_secs(ref_audio_path, str(out_path))
        accuracy_pct = round(max(0.0, (1.0 - wer)) * 100, 1)

        print(f"[{q_num}/10] Duration: {duration_sec:.2f}s | Latency: {latency_sec:.1f}s")
        print(f"[{q_num}/10] Whisper Transcript: \"{asr_transcript}\"")
        print(f"[{q_num}/10] Word Error Rate (WER): {wer*100:.1f}% | Content Accuracy: {accuracy_pct}%")
        print(f"[{q_num}/10] Speaker Resemblance (SECS): {secs:.4f}")

        results.append({
            "id": q_id,
            "num": q_num,
            "title": q_title,
            "topic": item["topic"],
            "original_prompt": q_text,
            "audio_filename": out_filename,
            "audio_url": f"/results/ra_10/{out_filename}",
            "duration_seconds": round(duration_sec, 2),
            "latency_seconds": round(latency_sec, 2),
            "rtf": round(rtf_val, 2),
            "whisper_transcript": asr_transcript,
            "wer": round(wer, 4),
            "content_accuracy_pct": accuracy_pct,
            "secs_similarity": round(secs, 4),
            "is_accurate": wer <= 0.08
        })

    total_time = time.perf_counter() - total_start_time
    avg_wer = sum(r["wer"] for r in results) / len(results)
    avg_accuracy = sum(r["content_accuracy_pct"] for r in results) / len(results)
    avg_secs = sum(r["secs_similarity"] for r in results) / len(results)

    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_questions": len(results),
        "total_pipeline_time_seconds": round(total_time, 1),
        "metrics_summary": {
            "avg_content_accuracy_pct": round(avg_accuracy, 1),
            "avg_wer_pct": round(avg_wer * 100, 1),
            "avg_secs_speaker_similarity": round(avg_secs, 4),
            "all_passed": all(r["is_accurate"] for r in results)
        },
        "questions": results
    }

    report_file = RA10_DIR / "ra10_benchmark_report.json"
    report_file.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\n" + "=" * 70)
    print(f"GENERATION COMPLETE in {total_time/60:.1f} minutes!")
    print(f"Average Content Accuracy: {avg_accuracy:.1f}% (WER: {avg_wer*100:.1f}%)")
    print(f"Average Speaker Similarity: {avg_secs:.4f}")
    print(f"Report saved to: {report_file}")
    print("=" * 70)

    # 5. Automatically trigger 3-Persona Assessment
    try:
        from tools.voice_cloning_lab.assess_speech_quality_llm import run_full_speech_assessment
        print("\n[Pipeline] Launching 3-Persona Speech Quality & Naturalness Assessment...")
        final_data = run_full_speech_assessment()
        return final_data
    except Exception as e:
        print(f"[Pipeline] Assessment trigger error: {e}")
        return report


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Force regenerate all 10 questions")
    args = parser.parse_args()
    run_batch_generation(force=args.force)
