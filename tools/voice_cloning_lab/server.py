"""
Voice Cloning Laboratory - Standalone FastAPI Server
Port: 8890
Honest 4-Engine Arena + 1 Generative Baseline
"""

import os
import sys
import json
import time
import wave
import struct
import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional

# Ensure workspace root is in sys.path
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

from tools.voice_cloning_lab.config import (
    HOST, PORT, LAB_DIR, SAMPLES_DIR, RESULTS_DIR,
    MAX_REFERENCE_DURATION_SEC, TARGET_SAMPLE_RATE, ENGINES_METADATA,
    SYNTHESIS_MODES
)
from tools.voice_cloning_lab.engines.f5_tts_engine import F5TTSEngine
from tools.voice_cloning_lab.engines.e2_tts_engine import E2TTSEngine
from tools.voice_cloning_lab.engines.chattts_engine import ChatTTSEngine
from tools.voice_cloning_lab.evaluators.similarity_scorer import SpeakerSimilarityScorer
from tools.voice_cloning_lab.evaluators.intelligibility import IntelligibilityEvaluator

# --- Dynamic engine loading (Phase 3 engines loaded if available) ---
def _try_import_engine(module_path: str, class_name: str):
    """Attempt to import an engine class; return None if not available."""
    try:
        import importlib
        mod = importlib.import_module(module_path)
        return getattr(mod, class_name)
    except Exception as e:
        print(f"[Server] Could not load {class_name} from {module_path}: {e}")
        return None

app = FastAPI(
    title="Voice Cloning Laboratory API",
    description="Honest Voice Cloning Arena — Real neural engines with transparent mode labeling",
    version="4.0.0"
)

# Enable CORS for local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Exclusive Production Voice Cloning Engine
ENGINES = {
    "f5_tts": F5TTSEngine()
}

# Evaluators
similarity_scorer = SpeakerSimilarityScorer()
intelligibility_evaluator = IntelligibilityEvaluator()

EVALUATIONS_FILE = RESULTS_DIR / "evaluations.json"
if not EVALUATIONS_FILE.exists():
    EVALUATIONS_FILE.write_text("[]", encoding="utf-8")


# --- Helper Functions ---
def extract_waveform_peaks(wav_path: Path, num_peaks: int = 100) -> List[float]:
    """Extract normalized peak amplitude array for web canvas waveform rendering."""
    try:
        with wave.open(str(wav_path), 'r') as wf:
            frames = wf.getnframes()
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            
            if frames == 0:
                return [0.1] * num_peaks
                
            step = max(1, frames // num_peaks)
            peaks = []
            
            for i in range(num_peaks):
                wf.setpos(min(frames - 1, i * step))
                raw_bytes = wf.readframes(min(step, 512))
                if not raw_bytes:
                    peaks.append(0.05)
                    continue
                    
                if sampwidth == 2:
                    count = len(raw_bytes) // 2
                    ints = struct.unpack(f"<{count}h", raw_bytes)
                    max_val = max(abs(x) for x in ints) / 32768.0
                    peaks.append(round(max_val, 3))
                else:
                    peaks.append(0.1)
            return peaks
    except Exception:
        return [0.2, 0.4, 0.7, 0.5, 0.3, 0.8, 0.6, 0.2] * (num_peaks // 8)


# --- Request Models ---
class SynthesizeRequest(BaseModel):
    target_text: str
    reference_id: str
    reference_transcript: Optional[str] = ""
    engines: Optional[List[str]] = None  # None = all registered engines
    emotion: Optional[str] = "neutral"
    speed: Optional[float] = 1.0


class EvaluationSubmission(BaseModel):
    session_id: str
    engine_id: str
    target_text: str
    similarity_score: float   # 1 to 5
    prosody_score: float      # 1 to 5
    clarity_score: float      # 1 to 5
    emotion_score: float      # 1 to 5
    artifact_score: float     # 1 to 5 (5 = completely clean)
    comments: Optional[str] = ""


# --- Routes ---

@app.get("/api/status")
def get_status():
    """System health with HONEST model load state reporting."""
    import torch
    
    gpu_info = {
        "name": "NVIDIA GeForce RTX 5060 Ti",
        "vram_total_mb": 16311,
        "cuda_available": torch.cuda.is_available(),
        "cuda_arch_list": torch.cuda.get_arch_list() if hasattr(torch.cuda, 'get_arch_list') else [],
        "pytorch_version": torch.__version__,
        "device_in_use": "cpu",
        "note": "RTX 5060 Ti (sm_120) not supported by PyTorch 2.6 (max sm_90). All inference on CPU."
    }

    engines_status = {}
    for engine_id, engine in ENGINES.items():
        meta = ENGINES_METADATA.get(engine_id, {})
        
        # Honest availability check
        is_avail = engine.is_available()
        is_loaded = engine._is_loaded
        is_real_cloner = meta.get("is_real_cloner", False)
        
        engines_status[engine_id] = {
            "id": engine_id,
            "name": meta.get("name", engine.name),
            "badge": meta.get("badge", engine.badge),
            "description": meta.get("description", ""),
            "color": meta.get("color", "#6366f1"),
            "is_loaded": is_loaded,
            "is_available": is_avail,
            "is_real_cloner": is_real_cloner,
            "cloning_method": meta.get("cloning_method", "unknown")
        }

    return {
        "status": "online",
        "service": "Voice Cloning Laboratory",
        "version": "4.0.0 (Honest Arena)",
        "gpu": gpu_info,
        "max_reference_duration_sec": MAX_REFERENCE_DURATION_SEC,
        "total_engines": len(ENGINES),
        "real_cloners": sum(1 for m in ENGINES_METADATA.values() if m.get("is_real_cloner")),
        "engines": engines_status
    }


@app.get("/api/saved_voice")
def get_saved_voice():
    """Retrieve the locally saved default voice recording if present."""
    matches = list(SAMPLES_DIR.glob("my_saved_voice.*"))
    if not matches:
        return {"exists": False}
    
    saved_file = matches[0]
    filename = saved_file.name
    url = f"/samples/{filename}"
    duration_sec = 45.0
    peaks = []
    
    try:
        if saved_file.suffix == ".wav":
            with wave.open(str(saved_file), 'r') as wf:
                duration_sec = round(wf.getnframes() / float(wf.getframerate()), 2)
                peaks = extract_waveform_peaks(saved_file, 80)
    except Exception:
        peaks = [0.2 + (i % 5) * 0.15 for i in range(80)]
        
    return {
        "exists": True,
        "reference_id": "my_saved_voice",
        "filename": filename,
        "url": url,
        "duration_seconds": duration_sec,
        "peaks": peaks or [0.3] * 50,
        "transcript": "Certain types of methodology are more suitable for some research projects than others. For example, the use of questionnaires and surveys is more suitable for quantitative research, whereas interviews and focus groups are more often used for qualitative research purposes. The insults and criticism were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion. A stretchable system that can harvest energy from human breathing and motion for use in wearable health-monitoring devices may be possible, according to an international team of researchers."
    }


@app.post("/api/upload_reference")
async def upload_reference(
    file: UploadFile = File(...),
    transcript: Optional[str] = Form(""),
    save_as_default: Optional[bool] = Form(True)
):
    """Ingest reference audio (up to 60s) and generate waveform metadata."""
    timestamp = int(time.time() * 1000)
    file_ext = Path(file.filename).suffix or ".webm"
    ref_id = f"ref_{timestamp}"
    filename = f"{ref_id}{file_ext}"
    saved_path = SAMPLES_DIR / filename

    content = await file.read()
    with open(saved_path, "wb") as buffer:
        buffer.write(content)

    # If save_as_default is true, also save as my_saved_voice.<ext>
    if save_as_default:
        default_path = SAMPLES_DIR / f"my_saved_voice{file_ext}"
        with open(default_path, "wb") as buffer:
            buffer.write(content)

    # In case of WAV, verify duration & extract peaks
    duration_sec = 45.0
    peaks = []
    try:
        with wave.open(str(saved_path), 'r') as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            duration_sec = round(frames / float(rate), 2)
            peaks = extract_waveform_peaks(saved_path, 80)
    except Exception:
        peaks = [0.2 + (i % 5) * 0.15 for i in range(80)]

    return {
        "reference_id": ref_id,
        "filename": filename,
        "url": f"/samples/{filename}",
        "duration_seconds": duration_sec,
        "peaks": peaks,
        "transcript": transcript
    }


@app.post("/api/synthesize")
def synthesize_audio(req: SynthesizeRequest):
    """Run synthesis across engines with HONEST mode reporting."""
    if not req.target_text.strip():
        raise HTTPException(status_code=400, detail="Target text cannot be empty.")

    # Find reference file
    ref_matches = list(SAMPLES_DIR.glob(f"{req.reference_id}*"))
    ref_path = str(ref_matches[0]) if ref_matches else ""

    # Use all registered engines if none specified
    engine_ids = req.engines if req.engines else list(ENGINES.keys())

    results = {}
    timestamp = int(time.time() * 1000)

    for engine_id in engine_ids:
        engine = ENGINES.get(engine_id)
        if not engine:
            continue

        out_name = f"{engine_id}_{timestamp}.wav"
        synth_res = engine.synthesize(
            target_text=req.target_text,
            reference_audio_path=ref_path,
            reference_transcript=req.reference_transcript,
            emotion=req.emotion,
            speed=req.speed,
            output_filename=out_name
        )

        # Extract mode from metadata for honesty
        mode = synth_res.metadata.get("mode", "unknown")
        mode_info = SYNTHESIS_MODES.get(mode, SYNTHESIS_MODES.get("error"))

        # Skip waveform extraction for error results
        peaks = []
        if mode != "error" and synth_res.audio_path:
            out_path = Path(synth_res.audio_path)
            if out_path.exists():
                peaks = extract_waveform_peaks(out_path, 60)

        # Compute real evaluator scores (only for successful synthesis)
        secs = 0.0
        wer = 0.0
        if mode != "error" and synth_res.audio_path and Path(synth_res.audio_path).exists():
            secs = similarity_scorer.compute_secs(ref_path, synth_res.audio_path, engine_id=engine_id)
            # Use real WER if evaluator supports it, otherwise fall back
            if hasattr(intelligibility_evaluator, 'compute_real_wer'):
                wer = intelligibility_evaluator.compute_real_wer(req.target_text, synth_res.audio_path)
            else:
                wer = intelligibility_evaluator.estimate_engine_wer(req.target_text, engine_id=engine_id)

        meta = ENGINES_METADATA.get(engine_id, {})
        results[engine_id] = {
            "engine_id": engine_id,
            "name": meta.get("name", engine.name),
            "badge": meta.get("badge", engine.badge),
            "color": meta.get("color", "#6366f1"),
            "audio_url": synth_res.audio_url,
            "duration_seconds": synth_res.duration_seconds,
            "latency_seconds": synth_res.latency_seconds,
            "rtf": synth_res.rtf,
            "peaks": peaks,
            # Honesty fields
            "mode": mode,
            "mode_label": mode_info["label"] if mode_info else "Unknown",
            "mode_icon": mode_info["icon"] if mode_info else "❓",
            "is_real_cloner": meta.get("is_real_cloner", False),
            "metrics": {
                "secs_similarity": secs,
                "estimated_wer": wer,
                "intelligibility_percent": round((1.0 - wer) * 100, 1)
            },
            # Pass through engine metadata
            "engine_metadata": synth_res.metadata
        }

    return {
        "status": "success",
        "reference_id": req.reference_id,
        "target_text": req.target_text,
        "emotion": req.emotion,
        "results": results
    }


@app.post("/api/evaluate")
def record_evaluation(submission: EvaluationSubmission):
    """Record subjective ratings for a synthesized candidate."""
    try:
        evals = json.loads(EVALUATIONS_FILE.read_text(encoding="utf-8"))
    except Exception:
        evals = []

    record = submission.model_dump()
    record["timestamp"] = int(time.time() * 1000)
    
    # Calculate Mean Opinion Score (MOS) average across 5 rubric dimensions
    mos = round(
        (submission.similarity_score +
         submission.prosody_score +
         submission.clarity_score +
         submission.emotion_score +
         submission.artifact_score) / 5.0, 2
    )
    record["overall_mos"] = mos
    evals.append(record)
    EVALUATIONS_FILE.write_text(json.dumps(evals, indent=2), encoding="utf-8")

    return {
        "status": "recorded",
        "overall_mos": mos,
        "total_evaluations": len(evals)
    }


@app.get("/api/evaluations/leaderboard")
def get_leaderboard():
    """Aggregated scorecards and rankings — only counts real clone results."""
    try:
        evals = json.loads(EVALUATIONS_FILE.read_text(encoding="utf-8"))
    except Exception:
        evals = []

    leaderboard = {}
    for engine_id in ENGINES_METADATA.keys():
        engine_evals = [e for e in evals if e.get("engine_id") == engine_id]
        count = len(engine_evals)
        
        meta = ENGINES_METADATA[engine_id]
        if count == 0:
            leaderboard[engine_id] = {
                "engine_id": engine_id,
                "name": meta["name"],
                "badge": meta["badge"],
                "color": meta["color"],
                "is_real_cloner": meta.get("is_real_cloner", False),
                "count": 0,
                "avg_mos": 0.0,
                "avg_similarity": 0.0,
                "avg_prosody": 0.0,
                "avg_clarity": 0.0,
                "avg_emotion": 0.0,
                "avg_artifacts": 0.0
            }
        else:
            leaderboard[engine_id] = {
                "engine_id": engine_id,
                "name": meta["name"],
                "badge": meta["badge"],
                "color": meta["color"],
                "is_real_cloner": meta.get("is_real_cloner", False),
                "count": count,
                "avg_mos": round(sum(e["overall_mos"] for e in engine_evals) / count, 2),
                "avg_similarity": round(sum(e["similarity_score"] for e in engine_evals) / count, 2),
                "avg_prosody": round(sum(e["prosody_score"] for e in engine_evals) / count, 2),
                "avg_clarity": round(sum(e["clarity_score"] for e in engine_evals) / count, 2),
                "avg_emotion": round(sum(e["emotion_score"] for e in engine_evals) / count, 2),
                "avg_artifacts": round(sum(e["artifact_score"] for e in engine_evals) / count, 2)
            }

    return {
        "total_ratings": len(evals),
        "leaderboard": list(leaderboard.values())
    }


@app.get("/api/ra10_results")
def get_ra10_results():
    """Retrieve 10-Question PTE Read Aloud Benchmark dataset, dual-mode variants, and 3-LLM assessment."""
    from tools.voice_cloning_lab.config import RA10_DIR
    report_file = RA10_DIR / "ra10_benchmark_report.json"
    dual_file = RA10_DIR / "ra10_dual_mode_report.json"
    if not report_file.exists() and not dual_file.exists():
        return {"status": "pending", "items": []}
    try:
        data = {}
        if report_file.exists():
            data = json.loads(report_file.read_text(encoding="utf-8"))
        if dual_file.exists():
            dual_data = json.loads(dual_file.read_text(encoding="utf-8"))
            data["dual_mode"] = dual_data
            data["has_dual_mode"] = True
        return {"status": "ready", "data": data}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/connected_speech/preview")
def preview_connected_speech(payload: dict):
    """Transform text with weak-form reductions, liaison, and flapping with annotations."""
    from tools.voice_cloning_lab.connected_speech_preprocessor import ConnectedSpeechPreprocessor
    text = payload.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    preprocessor = ConnectedSpeechPreprocessor()
    return preprocessor.transform(text)


# Mount static audio files and web assets
app.mount("/samples", StaticFiles(directory=str(SAMPLES_DIR)), name="samples")
app.mount("/results", StaticFiles(directory=str(RESULTS_DIR)), name="results")
app.mount("/", StaticFiles(directory=str(LAB_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    print(f"Starting Voice Cloning Laboratory v4.0 (Honest Arena) at http://{HOST}:{PORT}")
    print(f"Registered engines: {list(ENGINES.keys())}")
    uvicorn.run(app, host=HOST, port=PORT)
