"""
Retranscribe and Assess the 10 Synthesized Read Aloud Audio Files
Computes real Whisper ASR transcripts, Word Error Rates, SECS similarity, and runs the 3-Persona evaluation council.
"""

import sys
import json
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import soundfile as sf
from tools.voice_cloning_lab.config import SAMPLES_DIR, RA10_DIR
from tools.voice_cloning_lab.generate_10_ra_cloned_audio import RA_10_QUESTIONS
from tools.voice_cloning_lab.evaluators.similarity_scorer import SpeakerSimilarityScorer
from tools.voice_cloning_lab.evaluators.intelligibility import IntelligibilityEvaluator
from tools.voice_cloning_lab.assess_speech_quality_llm import evaluate_question_speech_quality

def main():
    print("=" * 70)
    print("RE-TRANSCRIBE & 3-PERSONA SPEECH ASSESSMENT FOR 10 RA QUESTIONS")
    print("=" * 70)

    ref_matches = list(SAMPLES_DIR.glob("my_saved_voice.*"))
    if not ref_matches:
        ref_matches = list(SAMPLES_DIR.glob("*.webm")) + list(SAMPLES_DIR.glob("*.wav"))
    ref_audio_path = str(ref_matches[0])
    print(f"Reference Audio: {ref_audio_path}")

    scorer = SpeakerSimilarityScorer()
    intel = IntelligibilityEvaluator()

    results = []
    for item in RA_10_QUESTIONS:
        q_id = item["id"]
        q_num = item["num"]
        q_title = item["title"]
        q_text = item["text"]
        wav_path = RA10_DIR / f"{q_id}_f5_cloned.wav"

        if not wav_path.exists():
            print(f"[{q_num}/10] WARNING: {wav_path} does not exist!")
            continue

        info = sf.info(str(wav_path))
        duration = info.duration

        print(f"\n[{q_num}/10] Transcribing: {q_title} ({duration:.2f}s)...")
        transcript = intel.transcribe(str(wav_path))
        wer = intel.compute_wer(q_text, transcript)
        accuracy_pct = round(max(0.0, (1.0 - wer)) * 100, 1)
        secs = scorer.compute_secs(ref_audio_path, str(wav_path))

        print(f"  • Whisper Transcript: \"{transcript}\"")
        print(f"  • WER: {wer*100:.1f}% | Accuracy: {accuracy_pct}%")
        print(f"  • Speaker Resemblance (SECS): {secs:.4f}")

        res_item = {
            "id": q_id,
            "num": q_num,
            "title": q_title,
            "topic": item["topic"],
            "original_prompt": q_text,
            "audio_filename": wav_path.name,
            "audio_url": f"/results/ra_10/{wav_path.name}",
            "duration_seconds": round(duration, 2),
            "latency_seconds": 0.0,
            "rtf": 0.0,
            "whisper_transcript": transcript,
            "wer": round(wer, 4),
            "content_accuracy_pct": accuracy_pct,
            "secs_similarity": round(secs, 4),
            "is_accurate": wer <= 0.08
        }
        results.append(res_item)

    avg_wer = sum(r["wer"] for r in results) / len(results)
    avg_accuracy = sum(r["content_accuracy_pct"] for r in results) / len(results)
    avg_secs = sum(r["secs_similarity"] for r in results) / len(results)

    # Run 3-Persona Speech Assessment
    print("\n" + "=" * 70)
    print("RUNNING 3-PERSONA SPEECH QUALITY & NATURALNESS ASSESSMENT")
    print("=" * 70)

    assessments = []
    for q in results:
        eval_res = evaluate_question_speech_quality(q)
        assessments.append(eval_res)
        print(f"\n[{eval_res['num']}/10] {eval_res['title']} — Score: {eval_res['overall_quality_score']}/5.0")
        print(f"  • Pronunciation: {eval_res['personas']['pronunciation_coach']['score']}/5 | {eval_res['personas']['pronunciation_coach']['feedback']}")
        print(f"  • Prosody/Intonation: {eval_res['personas']['prosody_specialist']['score']}/5 | {eval_res['personas']['prosody_specialist']['feedback']}")
        print(f"  • Chunking & Connected Speech: {eval_res['personas']['fluency_analyst']['score']}/5 | {eval_res['personas']['fluency_analyst']['feedback']}")

    overall_mos = round(sum(a["overall_quality_score"] for a in assessments) / len(assessments), 2)

    final_report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_questions": len(results),
        "metrics_summary": {
            "avg_content_accuracy_pct": round(avg_accuracy, 1),
            "avg_wer_pct": round(avg_wer * 100, 1),
            "avg_secs_speaker_similarity": round(avg_secs, 4),
            "overall_average_quality_mos": overall_mos,
            "all_passed": all(r["is_accurate"] for r in results)
        },
        "questions": results,
        "assessments": assessments,
        "overall_average_quality_mos": overall_mos
    }

    report_file = RA10_DIR / "ra10_benchmark_report.json"
    report_file.write_text(json.dumps(final_report, indent=2), encoding="utf-8")
    print("\n" + "=" * 70)
    print(f"BENCHMARK COMPLETE!")
    print(f"Average Content Accuracy: {avg_accuracy:.1f}% (WER: {avg_wer*100:.1f}%)")
    print(f"Average Speaker Similarity: {avg_secs:.4f}")
    print(f"Overall Quality MOS: {overall_mos}/5.00")
    print(f"Saved to: {report_file}")
    print("=" * 70)

if __name__ == "__main__":
    main()
