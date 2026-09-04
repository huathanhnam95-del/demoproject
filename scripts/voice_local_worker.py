#!/usr/bin/env python3
"""Local daemon worker for CRM Voice Cloning queue.

This worker runs on the local computer, registers its heartbeat in Firestore
(`voice_worker_status/current`), and claims and processes voice cloning jobs
from `voice_cloning_queue` using local F5-TTS Flow Matching neural inference.
Output audio is exported as MP3 for web playback and download.
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import threading
import time
import uuid

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
try:
    import torch
    torch.set_num_threads(os.cpu_count() or 8)
except ImportError:
    pass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import soundfile as sf

# Setup root path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.auth.credentials import AnonymousCredentials
except ImportError:
    firebase_admin = None
    credentials = None
    firestore = None
    AnonymousCredentials = None

from tools.voice_cloning_lab.connected_speech_preprocessor import ConnectedSpeechPreprocessor
from tools.voice_cloning_lab.engines.f5_tts_engine import F5TTSEngine

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [VoiceLocalWorker] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("VoiceLocalWorker")

PROJECT_ID = "listening-tasks-3ae34"
DEFAULT_EMULATOR_HOST = "127.0.0.1:8080"
HEARTBEAT_SECONDS = 8
GENERATIONS_DIR = ROOT / "tools" / "voice_cloning_lab" / "results" / "generations"
GENERATIONS_DIR.mkdir(parents=True, exist_ok=True)
SAMPLES_DIR = ROOT / "tools" / "voice_cloning_lab" / "samples"
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def get_firestore_client(production: bool = False) -> Any:
    """Initialize Firestore client (emulator or production)."""
    if firestore is None:
        raise RuntimeError("firebase_admin is not installed.")

    # Check if service account key is available in root
    sa_path = ROOT / "serviceAccountKey.json"
    if not production and not os.getenv("FIRESTORE_EMULATOR_HOST") and not sa_path.exists():
        os.environ["FIRESTORE_EMULATOR_HOST"] = DEFAULT_EMULATOR_HOST

    emulator_host = os.getenv("FIRESTORE_EMULATOR_HOST")
    if emulator_host:
        logger.info("Connecting to Firestore emulator at %s", emulator_host)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                credentials=AnonymousCredentials(),
                options={"projectId": PROJECT_ID}
            )
        return firestore.client()

    # Production mode
    logger.info("Connecting to production Firestore for project %s", PROJECT_ID)
    if not firebase_admin._apps:
        if sa_path.exists():
            cred = credentials.Certificate(str(sa_path))
            logger.info("Loaded credentials from %s", sa_path)
        else:
            cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, {"projectId": PROJECT_ID})
    return firestore.client()


class VoiceLocalWorker:
    def __init__(self, db: Any, worker_id: str | None = None):
        self.db = db
        self.worker_id = worker_id or f"voice-worker-{uuid.uuid4().hex[:8]}"
        self.stop_event = threading.Event()
        self.current_job_id: str | None = None
        self.engine = F5TTSEngine()
        self.preprocessor = ConnectedSpeechPreprocessor()
        self.f5_ready = False

    def init_engine(self) -> None:
        """Eagerly load F5-TTS model."""
        logger.info("Loading local F5-TTS Flow Matching model...")
        self.f5_ready = self.engine.load_model()
        logger.info("F5-TTS model loaded: %s", self.f5_ready)

    def write_heartbeat(self, state: str = "idle") -> None:
        """Publish heartbeat to Firestore voice_worker_status/current."""
        try:
            now_ts = firestore.SERVER_TIMESTAMP if firestore else utc_now()
            self.db.collection("voice_worker_status").document("current").set({
                "workerId": self.worker_id,
                "state": state,
                "ready": self.f5_ready,
                "f5ttsReachable": self.f5_ready,
                "modelsReady": self.f5_ready,
                "currentJobId": self.current_job_id,
                "version": "f5tts-voice-worker-v1",
                "lastHeartbeatAt": now_ts,
            }, merge=True)
        except Exception as e:
            logger.warning("Heartbeat write failed: %s", e)

    def heartbeat_loop(self) -> None:
        """Background loop to pulse heartbeats."""
        while not self.stop_event.is_set():
            state = "processing" if self.current_job_id else "idle"
            self.write_heartbeat(state)
            self.stop_event.wait(HEARTBEAT_SECONDS)

    def claim_pending_job(self) -> Any | None:
        """Find and claim a single pending job atomically."""
        try:
            # Query pending jobs without requiring a composite index
            query = (
                self.db.collection("voice_cloning_queue")
                .where("status", "==", "pending")
                .limit(10)
            )
            docs = list(query.stream())
            if not docs:
                return None

            # Sort in memory by createdAt
            def _extract_ts(d):
                data = d.to_dict() or {}
                c = data.get("createdAt")
                if hasattr(c, "timestamp"):
                    return c.timestamp()
                if isinstance(c, (int, float)):
                    return c
                return 0

            docs.sort(key=_extract_ts)
            doc = docs[0]
            ref = doc.reference
            now_ts = firestore.SERVER_TIMESTAMP if firestore else utc_now()

            # Transactional claim
            transaction = self.db.transaction()

            @firestore.transactional
            def claim_tx(tx):
                snap = doc.reference.get(transaction=tx)
                if not snap.exists or snap.get("status") != "pending":
                    return None
                tx.update(ref, {
                    "status": "processing",
                    "workerId": self.worker_id,
                    "startedAt": now_ts
                })
                return snap.to_dict()

            claimed = claim_tx(transaction)
            if claimed:
                claimed["_id"] = doc.id
            return claimed
        except Exception as e:
            logger.error("Claim attempt error: %s", e)
            return None

    def resolve_reference_audio(self, audio_url: str) -> Path | None:
        """Locate or retrieve reference audio file on disk or from Firestore."""
        if not audio_url:
            return None

        # 1. Cloud audio ID (/api/admin/voice-cloning/audio/<file_id>) - MUST BE CHECKED FIRST!
        if "/audio/" in audio_url:
            file_id = audio_url.split("/audio/")[-1].split("?")[0]
            try:
                doc = self.db.collection("voice_audio_files").document(file_id).get()
                if doc.exists:
                    data = doc.to_dict() or {}
                    b64 = data.get("audioBase64")
                    if b64:
                        import base64
                        decoded = base64.b64decode(b64)
                        ext = "webm" if "webm" in data.get("mimeType", "") else "wav"
                        out_file = SAMPLES_DIR / f"downloaded_{file_id}.{ext}"
                        out_file.write_bytes(decoded)
                        logger.info("Successfully retrieved reference audio %s (%s bytes) to %s", file_id, len(decoded), out_file)
                        return out_file
            except Exception as fe:
                logger.warning("Could not download reference audio doc %s: %s", file_id, fe)

        # 2. Local audio asset (/audio/voice-cloning/<filename>)
        if "/audio/voice-cloning/" in audio_url:
            filename = audio_url.split("/audio/voice-cloning/")[-1]
            candidate = ROOT / "public" / "audio" / "voice-cloning" / filename
            if candidate.exists():
                return candidate

        # 3. Direct local disk path
        clean_url = audio_url.replace("/", os.sep).lstrip(os.sep)
        local_candidate = ROOT / clean_url
        if local_candidate.exists():
            return local_candidate

        public_candidate = ROOT / "public" / clean_url
        if public_candidate.exists():
            return public_candidate

        # 4. Fallback default voice sample only if explicitly requested or nothing else found
        sample_path = ROOT / "tools" / "voice_cloning_lab" / "samples" / "my_saved_voice.webm"
        if sample_path.exists() and ("default" in audio_url or not audio_url):
            return sample_path

        return None

    def process_job(self, job: dict[str, Any]) -> None:
        """Process a claimed voice synthesis job."""
        job_id = job.get("id") or job.get("_id")
        self.current_job_id = job_id
        self.write_heartbeat("processing")

        ref_doc = self.db.collection("voice_cloning_queue").document(job_id)
        try:
            logger.info("Processing job %s (type: %s, voice: %s)", job_id, job.get("type"), job.get("voiceName"))
            text = job.get("text", "")
            style = job.get("style", "formal")
            ref_url = job.get("referenceAudioUrl", "")
            ref_transcript = job.get("referenceTranscript", "")

            # 1. Resolve reference audio
            ref_audio_path = self.resolve_reference_audio(ref_url)
            if not ref_audio_path or not ref_audio_path.exists():
                raise FileNotFoundError(f"Reference audio file not found on local disk: {ref_url}")

            # 2. Text preprocessing & annotations
            annotations = []
            speech_text = text
            if style == "connected":
                annotated = self.preprocessor.preprocess(text)
                speech_text = annotated.speech_ready_text
                annotations = [
                    {"original": a.original, "spoken": a.spoken, "type": a.type, "note": a.note}
                    for a in annotated.annotations
                ]

            # 3. Neural inference with F5-TTS
            speed = 1.15 if style == "connected" else 1.0
            res = self.engine.synthesize(
                target_text=speech_text,
                reference_audio_path=str(ref_audio_path),
                reference_transcript=ref_transcript,
                speed=speed
            )

            if not res.audio_path or not Path(res.audio_path).exists():
                raise RuntimeError("F5-TTS failed to produce output audio.")

            # 4. Convert WAV to MP3
            mp3_filename = f"{job_id}.mp3"
            mp3_path = GENERATIONS_DIR / mp3_filename
            wav_data, sr = sf.read(res.audio_path)
            sf.write(str(mp3_path), wav_data, sr, format="MP3")
            mp3_bytes = mp3_path.read_bytes()
            import base64
            mp3_b64 = base64.b64encode(mp3_bytes).decode('ascii')
            logger.info("Saved MP3 to %s (%d bytes)", mp3_path, len(mp3_bytes))

            # 5. Calculate metrics
            duration = round(float(len(wav_data) / sr), 2)
            word_count = len(text.split())
            wpm = round((word_count / max(duration, 0.1)) * 60, 1)
            mp3_url = f"/api/admin/voice-cloning/audio/{job_id}"

            now_ts = firestore.SERVER_TIMESTAMP if firestore else utc_now()
            ref_doc.update({
                "status": "completed",
                "mp3Url": mp3_url,
                "mp3Base64": mp3_b64 if len(mp3_b64) <= 1048576 else None,
                "durationSeconds": duration,
                "wpm": wpm,
                "speechText": speech_text,
                "annotations": annotations,
                "error": None,
                "completedAt": now_ts
            })
            logger.info("Job %s completed successfully! (Duration: %ss, WPM: %s)", job_id, duration, wpm)

        except Exception as err:
            logger.error("Error processing job %s: %s", job_id, err, exc_info=True)
            now_ts = firestore.SERVER_TIMESTAMP if firestore else utc_now()
            ref_doc.update({
                "status": "failed",
                "error": str(err),
                "completedAt": now_ts
            })
        finally:
            self.current_job_id = None
            self.write_heartbeat("idle")

    def run(self, single_run: bool = False) -> None:
        """Main worker loop."""
        self.init_engine()
        hb_thread = threading.Thread(target=self.heartbeat_loop, daemon=True)
        hb_thread.start()
        logger.info("Voice Local Worker active (Worker ID: %s)", self.worker_id)

        try:
            while not self.stop_event.is_set():
                job = self.claim_pending_job()
                if job:
                    self.process_job(job)
                    if single_run:
                        break
                else:
                    if single_run:
                        break
                    self.stop_event.wait(2.0)
        except KeyboardInterrupt:
            logger.info("Stopping Voice Local Worker...")
        finally:
            self.stop_event.set()
            self.write_heartbeat("stopping")
            logger.info("Voice Local Worker stopped.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Voice Local Worker daemon")
    parser.add_argument("--production", action="store_true", help="Run against production Firestore")
    parser.add_argument("--single-run", action="store_true", help="Process available jobs and exit")
    parser.add_argument("--worker-id", type=str, default=None, help="Custom worker ID")
    args = parser.parse_args()

    db = get_firestore_client(production=args.production)
    worker = VoiceLocalWorker(db=db, worker_id=args.worker_id)
    worker.run(single_run=args.single_run)


if __name__ == "__main__":
    main()
