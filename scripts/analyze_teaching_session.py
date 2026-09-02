import os
import sys
import argparse
import time
import json
from pathlib import Path

# Ensure UTF-8 output on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from audio_teaching_logger.config import (
    OUTPUT_DIR,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_LOCAL_MODELS
)
from audio_teaching_logger.pipeline_gemini import run_gemini_pipeline, transcribe_audio_gemini
from audio_teaching_logger.pipeline_local_stt import parse_transcript_file, run_local_stt
from audio_teaching_logger.pipeline_local_consensus import run_local_consensus_pipeline
from audio_teaching_logger.ab_evaluator import evaluate_ab_results


def main():
    parser = argparse.ArgumentParser(
        description="Bilingual Audio Teaching Session Logger (Gemini API & 3-Model Local LLM Consensus A/B Test)"
    )
    parser.add_argument("--audio", type=str, help="Path to audio recording (.mp3, .m4a, .wav)")
    parser.add_argument("--transcript", type=str, help="Path to pre-existing transcript (.txt, .srt, .json)")
    parser.add_argument("--mode", type=str, choices=["ab-test", "gemini", "local-consensus"], default="ab-test",
                        help="Execution mode (default: ab-test)")
    parser.add_argument("--stt-engine", type=str, choices=["gemini", "whisper"], default="gemini",
                        help="STT engine to transcribe audio for local LLMs (default: gemini)")
    parser.add_argument("--output-dir", type=str, default=str(OUTPUT_DIR), help="Output folder path")
    parser.add_argument("--gemini-model", type=str, default=DEFAULT_GEMINI_MODEL, help="Gemini model name")
    parser.add_argument("--ollama-qwen", type=str, default=DEFAULT_LOCAL_MODELS["qwen"])
    parser.add_argument("--ollama-deepseek", type=str, default=DEFAULT_LOCAL_MODELS["deepseek"])
    parser.add_argument("--ollama-gemma", type=str, default=DEFAULT_LOCAL_MODELS["gemma"])

    args = parser.parse_args()

    if not args.audio and not args.transcript:
        print("[Error] Please provide either --audio <path> or --transcript <path>.")
        sys.exit(1)

    # 1. Prepare output folder
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    session_out_dir = Path(args.output_dir) / f"session_{timestamp}"
    session_out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n=======================================================")
    print(f" 🎓 Bilingual Teaching Session Logger & A/B Evaluator ")
    print(f"=======================================================")
    print(f"Output Directory: {session_out_dir}")
    print(f"Mode: {args.mode.upper()}")
    print(f"STT Engine: {args.stt_engine.upper()}\n")

    # 2. Extract or load transcript
    transcript_text = ""
    if args.transcript:
        print(f"[Input] Loading transcript from: {args.transcript}")
        transcript_text = parse_transcript_file(args.transcript)
    elif args.audio:
        print(f"[Input] Audio file provided: {args.audio}")
        if args.mode in ["ab-test", "local-consensus"]:
            if args.stt_engine == "whisper":
                try:
                    print("[STT] Running local Whisper speech-to-text on CPU/GPU...")
                    transcript_text = run_local_stt(args.audio)
                    (session_out_dir / "transcript_local.txt").write_text(transcript_text, encoding="utf-8")
                except Exception as e:
                    print(f"[STT] Local STT error: {e}")
            else:
                print("[STT] Extracting full bilingual transcript via Gemini STT...")
                try:
                    transcript_text = transcribe_audio_gemini(args.audio, model_name=args.gemini_model)
                    (session_out_dir / "transcript_extracted.txt").write_text(transcript_text, encoding="utf-8")
                    print(f"✅ Transcript successfully extracted ({len(transcript_text.splitlines())} lines).")
                except Exception as ex:
                    print(f"❌ Transcript extraction failed: {ex}")

    gemini_res = None
    local_res = None

    # 3. Pipeline A: Gemini API
    if args.mode in ["ab-test", "gemini"]:
        print("\n--- [Pipeline A: Gemini Multimodal Audio Ingestion] ---")
        try:
            gemini_res = run_gemini_pipeline(
                audio_path=args.audio,
                transcript_text=transcript_text,
                model_name=args.gemini_model
            )
            if gemini_res.get("success"):
                (session_out_dir / "pipeline_a_gemini_report.md").write_text(gemini_res["markdown"], encoding="utf-8")
                (session_out_dir / "pipeline_a_data.json").write_text(json.dumps(gemini_res["data"], indent=2, ensure_ascii=False), encoding="utf-8")
                # Save Mermaid visual diagrams
                if gemini_res.get("mermaid_mindmap"):
                    (session_out_dir / "lesson_mindmap.mmd").write_text(gemini_res["mermaid_mindmap"], encoding="utf-8")
                    print(f"  📊 Mermaid mindmap saved → lesson_mindmap.mmd")
                if gemini_res.get("mermaid_flowchart"):
                    (session_out_dir / "lesson_flowchart.mmd").write_text(gemini_res["mermaid_flowchart"], encoding="utf-8")
                    print(f"  📊 Mermaid flowchart saved → lesson_flowchart.mmd")
                print(f"✅ Pipeline A (Gemini) completed in {gemini_res['elapsed_seconds']}s")
            else:
                print(f"❌ Pipeline A failed: {gemini_res.get('error')}")
        except Exception as e:
            print(f"❌ Pipeline A exception: {e}")

    # 4. Pipeline B: Local 3-Model Consensus
    if args.mode in ["ab-test", "local-consensus"]:
        print("\n--- [Pipeline B: Local 3-Model Consensus & Roundtable] ---")
        if not transcript_text and args.audio:
            print("⚠️ No local transcript available for Pipeline B. Pass --transcript to run offline consensus.")
        else:
            models_config = {
                "qwen": args.ollama_qwen,
                "deepseek": args.ollama_deepseek,
                "gemma": args.ollama_gemma
            }
            local_res = run_local_consensus_pipeline(
                transcript_text=transcript_text,
                models=models_config,
                judge_model=args.ollama_qwen
            )
            if local_res.get("success"):
                (session_out_dir / "pipeline_b_local_consensus_report.md").write_text(local_res["markdown"], encoding="utf-8")
                (session_out_dir / "pipeline_b_data.json").write_text(json.dumps(local_res["final_data"], indent=2, ensure_ascii=False), encoding="utf-8")
                # Save Pipeline B Mermaid visual diagrams
                if local_res.get("mermaid_mindmap"):
                    (session_out_dir / "pipeline_b_mindmap.mmd").write_text(local_res["mermaid_mindmap"], encoding="utf-8")
                    print(f"  📊 Pipeline B Mermaid mindmap saved → pipeline_b_mindmap.mmd")
                if local_res.get("mermaid_flowchart"):
                    (session_out_dir / "pipeline_b_flowchart.mmd").write_text(local_res["mermaid_flowchart"], encoding="utf-8")
                    print(f"  📊 Pipeline B Mermaid flowchart saved → pipeline_b_flowchart.mmd")
                print(f"✅ Pipeline B (Local Consensus) completed in {local_res['elapsed_seconds']}s")
            else:
                print(f"❌ Pipeline B failed.")

    # 5. A/B Evaluation
    if args.mode == "ab-test" and gemini_res and local_res:
        print("\n--- [A/B Benchmark Comparison & Evaluation] ---")
        ab_eval = evaluate_ab_results(gemini_res, local_res)
        (session_out_dir / "ab_comparison_report.md").write_text(ab_eval["markdown_comparison"], encoding="utf-8")
        print("✅ A/B Benchmark Report generated!")

    print(f"\n✨ All tasks finished! Reports saved in:\n  📁 {session_out_dir}\n")


if __name__ == "__main__":
    main()
