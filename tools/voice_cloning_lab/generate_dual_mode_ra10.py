"""
Dual-Mode 10-Question PTE Read Aloud Benchmark Generator
Generates and evaluates both:
- Mode 1: Formal Citation (1.0x, clear lexical boundaries)
- Mode 2: Connected Speech Stream (1.15x, weak forms, liaison, flapping)
"""

import sys
import json
import time
import shutil
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import soundfile as sf
from tools.voice_cloning_lab.config import SAMPLES_DIR, RA10_DIR
from tools.voice_cloning_lab.generate_10_ra_cloned_audio import RA_10_QUESTIONS
from tools.voice_cloning_lab.engines.f5_tts_engine import F5TTSEngine
from tools.voice_cloning_lab.evaluators.similarity_scorer import SpeakerSimilarityScorer
from tools.voice_cloning_lab.evaluators.intelligibility import IntelligibilityEvaluator
from tools.voice_cloning_lab.connected_speech_preprocessor import ConnectedSpeechPreprocessor


def run_dual_mode_generation(force_connected: bool = False):
    print("=" * 70)
    print("DUAL-MODE READ ALOUD BENCHMARK: FORMAL CITATION vs CONNECTED SPEECH")
    print("=" * 70)

    # 1. Locate reference voice recording
    ref_matches = list(SAMPLES_DIR.glob("my_saved_voice.*"))
    if not ref_matches:
        ref_matches = list(SAMPLES_DIR.glob("*.webm")) + list(SAMPLES_DIR.glob("*.wav"))
    if not ref_matches:
        raise FileNotFoundError(f"No reference audio found in {SAMPLES_DIR}")
    
    ref_audio_path = str(ref_matches[0])
    ref_transcript = "The insults and criticisms were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion."
    print(f"Reference Audio: {ref_audio_path}")

    # 2. Setup engines
    f5_engine = F5TTSEngine()
    f5_engine.load_model()
    scorer = SpeakerSimilarityScorer()
    intel = IntelligibilityEvaluator()
    preprocessor = ConnectedSpeechPreprocessor()

    dual_results = []
    total_start_time = time.perf_counter()

    for item in RA_10_QUESTIONS:
        q_id = item["id"]
        q_num = item["num"]
        q_title = item["title"]
        q_topic = item["topic"]
        q_text = item["text"]

        formal_wav = RA10_DIR / f"{q_id}_f5_formal.wav"
        cloned_wav = RA10_DIR / f"{q_id}_f5_cloned.wav"
        conn_wav = RA10_DIR / f"{q_id}_f5_connected.wav"

        # Ensure formal WAV exists
        if not formal_wav.exists() and cloned_wav.exists():
            shutil.copy2(cloned_wav, formal_wav)

        print(f"\n[{q_num}/10] Processing: {q_title}")

        # A. Evaluate Formal Mode
        f_info = sf.info(str(formal_wav))
        f_dur = f_info.duration
        f_transcript = intel.transcribe(str(formal_wav))
        f_wer = intel.compute_wer(q_text, f_transcript)
        f_acc = round(max(0.0, (1.0 - f_wer)) * 100, 1)
        f_secs = scorer.compute_secs(ref_audio_path, str(formal_wav))
        f_wpm = round((len(f_transcript.split()) / max(0.1, f_dur)) * 60, 1)

        print(f"  [Formal] Duration: {f_dur:.2f}s | WPM: {f_wpm} | Acc: {f_acc}% | SECS: {f_secs:.4f}")
        print(f"  [Formal] Whisper: \"{f_transcript}\"")

        # B. Process Connected Mode
        prep_res = preprocessor.transform(q_text)
        speech_ready_text = prep_res["speech_ready_text"]
        annotations = prep_res["annotations"]
        features_count = prep_res["stats"]["total_features"]

        needs_conn_synth = force_connected or (not conn_wav.exists()) or (conn_wav.stat().st_size < 20000)

        if needs_conn_synth:
            print(f"  [Connected] Synthesizing connected stream ({features_count} phonological features)...")
            print(f"  [Connected] Input: \"{speech_ready_text}\"")
            synth_res = f5_engine.synthesize(
                target_text=speech_ready_text,
                reference_audio_path=ref_audio_path,
                reference_transcript=ref_transcript,
                speed=1.15,
                output_filename=conn_wav.name
            )
            if Path(synth_res.audio_path).exists() and Path(synth_res.audio_path) != conn_wav:
                shutil.copy2(synth_res.audio_path, str(conn_wav))

        c_info = sf.info(str(conn_wav))
        c_dur = c_info.duration
        c_transcript = intel.transcribe(str(conn_wav))
        c_wer = intel.compute_wer(q_text, c_transcript)
        c_acc = round(max(0.0, (1.0 - c_wer)) * 100, 1)
        c_secs = scorer.compute_secs(ref_audio_path, str(conn_wav))
        c_wpm = round((len(c_transcript.split()) / max(0.1, c_dur)) * 60, 1)

        print(f"  [Connected] Duration: {c_dur:.2f}s | WPM: {c_wpm} | Acc: {c_acc}% | SECS: {c_secs:.4f}")
        print(f"  [Connected] Whisper: \"{c_transcript}\"")

        dual_results.append({
            "id": q_id,
            "num": q_num,
            "title": q_title,
            "topic": q_topic,
            "original_prompt": q_text,
            "formal": {
                "audio_url": f"/results/ra_10/{formal_wav.name}",
                "audio_path": str(formal_wav),
                "duration_seconds": round(f_dur, 2),
                "speaking_rate_wpm": f_wpm,
                "whisper_transcript": f_transcript,
                "content_accuracy_pct": f_acc,
                "wer": round(f_wer, 4),
                "secs_similarity": round(f_secs, 4),
                "style_label": "Formal Citation",
                "cadence_label": "Deliberate (Optimal PTE Scoring)",
            },
            "connected": {
                "audio_url": f"/results/ra_10/{conn_wav.name}",
                "audio_path": str(conn_wav),
                "speech_ready_text": speech_ready_text,
                "duration_seconds": round(c_dur, 2),
                "speaking_rate_wpm": c_wpm,
                "whisper_transcript": c_transcript,
                "content_accuracy_pct": c_acc,
                "wer": round(c_wer, 4),
                "secs_similarity": round(c_secs, 4),
                "style_label": "Connected Stream",
                "cadence_label": "Fluent Native Stream (79+ Fluency)",
                "annotations": annotations,
                "features_applied": prep_res["stats"],
            }
        })

    # Summary metrics
    avg_f_acc = sum(r["formal"]["content_accuracy_pct"] for r in dual_results) / len(dual_results)
    avg_c_acc = sum(r["connected"]["content_accuracy_pct"] for r in dual_results) / len(dual_results)
    avg_f_secs = sum(r["formal"]["secs_similarity"] for r in dual_results) / len(dual_results)
    avg_c_secs = sum(r["connected"]["secs_similarity"] for r in dual_results) / len(dual_results)
    avg_f_wpm = sum(r["formal"]["speaking_rate_wpm"] for r in dual_results) / len(dual_results)
    avg_c_wpm = sum(r["connected"]["speaking_rate_wpm"] for r in dual_results) / len(dual_results)

    report_payload = {
        "benchmark_name": "PTE Read Aloud Dual-Mode Benchmark (Formal vs Connected)",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "reference_audio": ref_audio_path,
        "modes_available": ["formal", "connected"],
        "metrics_summary": {
            "formal": {
                "avg_content_accuracy_pct": round(avg_f_acc, 1),
                "avg_secs_speaker_similarity": round(avg_f_secs, 4),
                "avg_speaking_rate_wpm": round(avg_f_wpm, 1),
            },
            "connected": {
                "avg_content_accuracy_pct": round(avg_c_acc, 1),
                "avg_secs_speaker_similarity": round(avg_c_secs, 4),
                "avg_speaking_rate_wpm": round(avg_c_wpm, 1),
            }
        },
        "questions": dual_results
    }

    # Save dual mode report
    dual_file = RA10_DIR / "ra10_dual_mode_report.json"
    dual_file.write_text(json.dumps(report_payload, indent=2), encoding="utf-8")

    # Also update ra10_benchmark_report.json with backward compatibility
    main_benchmark_file = RA10_DIR / "ra10_benchmark_report.json"
    if main_benchmark_file.exists():
        try:
            existing = json.loads(main_benchmark_file.read_text(encoding="utf-8"))
            existing["dual_mode"] = report_payload
            existing["has_dual_mode"] = True
            main_benchmark_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"Error updating main benchmark report: {e}")

    print("\n" + "=" * 70)
    print("DUAL-MODE BENCHMARK COMPLETE!")
    print(f"Formal Mode:    Avg Acc = {avg_f_acc:.1f}% | Avg WPM = {avg_f_wpm:.1f} | Avg SECS = {avg_f_secs:.4f}")
    print(f"Connected Mode: Avg Acc = {avg_c_acc:.1f}% | Avg WPM = {avg_c_wpm:.1f} | Avg SECS = {avg_c_secs:.4f}")
    print(f"Dual Report Saved: {dual_file}")
    print("=" * 70)
    return report_payload


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Force regenerate connected audio files")
    args = parser.parse_args()
    run_dual_mode_generation(force_connected=args.force)
