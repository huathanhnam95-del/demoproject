"""
Targeted Prosody & Acoustic Tuning for RA #8, RA #9, and RA #10
Applies thought-group syntactic chunking, removes prefix artifacts, and re-synthesizes.
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
from tools.voice_cloning_lab.engines.f5_tts_engine import F5TTSEngine
from tools.voice_cloning_lab.evaluators.similarity_scorer import SpeakerSimilarityScorer
from tools.voice_cloning_lab.evaluators.intelligibility import IntelligibilityEvaluator
from tools.voice_cloning_lab.assess_speech_quality_llm import evaluate_question_speech_quality

TUNED_QUESTIONS = [
    {
        "id": "ra_521",
        "num": 8,
        "title": "RA #521: Urban Agriculture (Tuned)",
        "topic": "Agronomy & Sustainable Cities",
        "original_prompt": "Vertical farming and precision agriculture offer sustainable pathways to enhance urban food security while minimizing arable land consumption and reducing water usage by up to ninety percent.",
        # Tuned with syntactic pause boundaries for connected speech and natural breathing
        "text": "Vertical farming and precision agriculture offer sustainable pathways to enhance urban food security, while minimizing arable land consumption, and reducing water usage by up to ninety percent."
    },
    {
        "id": "ra_604",
        "num": 9,
        "title": "RA #604: Cognitive Linguistics (Tuned)",
        "topic": "Neuroscience & Psycholinguistics",
        "original_prompt": "Psycholinguistic investigations demonstrate that bilingual individuals frequently utilize distinct cognitive pathways depending on which language they are actively processing, reflecting deep structural plasticity in the human brain.",
        # Tuned with natural liaison punctuation
        "text": "Psycholinguistic investigations demonstrate that bilingual individuals frequently utilize distinct cognitive pathways, depending on which language they are actively processing, reflecting deep structural plasticity in the human brain."
    },
    {
        "id": "ra_789",
        "num": 10,
        "title": "RA #789: Renewable Energy Storage (Tuned)",
        "topic": "Clean Tech & Electrical Grids",
        "original_prompt": "Grid-scale battery infrastructure and pumped-storage hydroelectricity are essential for mitigating the intermittent generation of solar and wind installations, ensuring continuous baseline electricity delivery.",
        # Tuned punctuation to separate complex subject noun phrase from predicate
        "text": "Grid scale battery infrastructure, and pumped storage hydroelectricity, are essential for mitigating the intermittent generation of solar and wind installations, ensuring continuous baseline electricity delivery."
    }
]

def main():
    print("=" * 70)
    print("TARGETED PROSODY & SPEECH TUNING PIPELINE (RA #8, #9, #10)")
    print("=" * 70)

    ref_matches = list(SAMPLES_DIR.glob("my_saved_voice.*"))
    if not ref_matches:
        ref_matches = list(SAMPLES_DIR.glob("*.webm")) + list(SAMPLES_DIR.glob("*.wav"))
    ref_audio_path = str(ref_matches[0])

    f5_engine = F5TTSEngine()
    f5_engine.load_model()
    scorer = SpeakerSimilarityScorer()
    intel = IntelligibilityEvaluator()

    report_file = RA10_DIR / "ra10_benchmark_report.json"
    data = json.loads(report_file.read_text(encoding="utf-8"))
    questions_dict = {q["id"]: q for q in data["questions"]}

    for item in TUNED_QUESTIONS:
        q_id = item["id"]
        q_num = item["num"]
        q_title = item["title"]
        q_text = item["text"]
        wav_path = RA10_DIR / f"{q_id}_f5_cloned.wav"

        print(f"\nRe-synthesizing [{q_num}/10]: {q_title}")
        print(f"Conditioned Text: \"{q_text}\"")

        synth_res = f5_engine.synthesize(
            target_text=q_text,
            reference_audio_path=ref_audio_path,
            output_filename=wav_path.name
        )

        if Path(synth_res.audio_path).exists() and Path(synth_res.audio_path) != wav_path:
            import shutil
            shutil.copy2(synth_res.audio_path, str(wav_path))

        # Transcribe
        transcript = intel.transcribe(str(wav_path))
        wer = intel.compute_wer(item["original_prompt"], transcript)
        accuracy_pct = round(max(0.0, (1.0 - wer)) * 100, 1)
        secs = scorer.compute_secs(ref_audio_path, str(wav_path))

        print(f"  • Tuned Duration: {synth_res.duration_seconds:.2f}s")
        print(f"  • Tuned Whisper Transcript: \"{transcript}\"")
        print(f"  • Tuned WER: {wer*100:.1f}% | Accuracy: {accuracy_pct}%")
        print(f"  • Tuned SECS: {secs:.4f}")

        # Update in dictionary
        questions_dict[q_id] = {
            "id": q_id,
            "num": q_num,
            "title": item["title"].replace(" (Tuned)", ""),
            "topic": item["topic"],
            "original_prompt": item["original_prompt"],
            "conditioned_text": q_text,
            "audio_filename": wav_path.name,
            "audio_url": f"/results/ra_10/{wav_path.name}",
            "duration_seconds": round(synth_res.duration_seconds, 2),
            "latency_seconds": round(synth_res.latency_seconds, 2),
            "rtf": round(synth_res.rtf, 2),
            "whisper_transcript": transcript,
            "wer": round(wer, 4),
            "content_accuracy_pct": accuracy_pct,
            "secs_similarity": round(secs, 4),
            "is_accurate": wer <= 0.08
        }

    # Re-evaluate all 10 questions
    updated_questions = list(questions_dict.values())
    updated_questions.sort(key=lambda x: x["num"])

    assessments = []
    for q in updated_questions:
        eval_res = evaluate_question_speech_quality(q)
        assessments.append(eval_res)

    avg_wer = sum(r["wer"] for r in updated_questions) / len(updated_questions)
    avg_accuracy = sum(r["content_accuracy_pct"] for r in updated_questions) / len(updated_questions)
    avg_secs = sum(r["secs_similarity"] for r in updated_questions) / len(updated_questions)
    overall_mos = round(sum(a["overall_quality_score"] for a in assessments) / len(assessments), 2)

    final_report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_questions": len(updated_questions),
        "metrics_summary": {
            "avg_content_accuracy_pct": round(avg_accuracy, 1),
            "avg_wer_pct": round(avg_wer * 100, 1),
            "avg_secs_speaker_similarity": round(avg_secs, 4),
            "overall_average_quality_mos": overall_mos,
            "all_passed": all(r["is_accurate"] for r in updated_questions)
        },
        "questions": updated_questions,
        "assessments": assessments,
        "overall_average_quality_mos": overall_mos
    }

    report_file.write_text(json.dumps(final_report, indent=2), encoding="utf-8")
    print("\n" + "=" * 70)
    print("TUNING COMPLETE!")
    print(f"Updated Average Content Accuracy: {avg_accuracy:.1f}% (WER: {avg_wer*100:.1f}%)")
    print(f"Updated Average Speaker Similarity: {avg_secs:.4f}")
    print(f"Updated Overall Quality MOS: {overall_mos}/5.00")
    print("=" * 70)

if __name__ == "__main__":
    main()
