"""
Voice Cloning Laboratory - Bark Generative Engine Adapter
Bark is a generative text-to-speech model by Suno AI.
NOTE: Bark does NOT support zero-shot voice cloning from a reference WAV.
It generates speech using predefined speaker presets.
Included as a second generative baseline for quality comparison.
"""

import os
import time
from pathlib import Path
from typing import Optional, Dict, Any

import numpy as np
import soundfile as sf

from tools.voice_cloning_lab.engines.base_engine import BaseVoiceCloningEngine, SynthesisResult
from tools.voice_cloning_lab.config import RESULTS_DIR, SAMPLES_DIR, TARGET_SAMPLE_RATE


class CosyVoice3Engine(BaseVoiceCloningEngine):
    """
    Bark Generative TTS Engine (replacement for CosyVoice 3 stub).
    NOTE: Bark does NOT support voice cloning from reference audio.
    It generates speech using Suno's pretrained multilingual model.
    Included as a generative baseline — NOT a voice cloner.
    """

    def __init__(self):
        super().__init__(
            engine_id="cosyvoice",
            name="Bark (Generative Baseline)",
            badge="⚠️ NO CLONING"
        )
        self.models_loaded = False

    def is_available(self) -> bool:
        try:
            import bark
            return True
        except ImportError:
            return False

    def load_model(self) -> bool:
        try:
            os.environ["SUNO_USE_SMALL_MODELS"] = "1"
            os.environ["SUNO_OFFLOAD_CPU"] = "1"
            from bark import preload_models

            print("[BarkEngine] Preloading Bark small models on CPU...")
            preload_models(
                text_use_small=True,
                coarse_use_small=True,
                fine_use_small=True,
                force_reload=False
            )
            self.models_loaded = True
            self._is_loaded = True
            print("[BarkEngine] Bark models loaded!")
            return True
        except Exception as e:
            print(f"[BarkEngine] Error loading Bark: {e}")
            self._is_loaded = False
            return False

    def synthesize(
        self,
        target_text: str,
        reference_audio_path: str,
        reference_transcript: str = "",
        emotion: str = "neutral",
        speed: float = 1.0,
        output_filename: Optional[str] = None
    ) -> SynthesisResult:
        if not self._is_loaded and self.is_available():
            self.load_model()

        if not self._is_loaded or not self.models_loaded:
            return SynthesisResult(
                engine_id=self.engine_id,
                audio_path="",
                audio_url="",
                duration_seconds=0.0,
                sample_rate=TARGET_SAMPLE_RATE,
                latency_seconds=0.0,
                rtf=0.0,
                metadata={"mode": "error", "error": "Bark model failed to load"}
            )

        try:
            from bark import generate_audio, SAMPLE_RATE
            start_time = time.perf_counter()

            if not output_filename:
                timestamp = int(time.time() * 1000)
                output_filename = f"cosyvoice_{timestamp}.wav"

            out_path = RESULTS_DIR / output_filename

            # NOTE: Bark ignores reference audio — generates in its own speaker
            print(f"[BarkEngine] Generating speech (no cloning) for '{target_text[:40]}...'")
            audio_array = generate_audio(target_text)

            # Save to WAV
            sf.write(str(out_path), audio_array, SAMPLE_RATE)

            elapsed_sec = time.perf_counter() - start_time
            duration_sec = len(audio_array) / SAMPLE_RATE
            rtf = elapsed_sec / max(duration_sec, 0.1)

            print(f"[BarkEngine] Done! Duration: {duration_sec:.2f}s, RTF: {rtf:.2f}x")

            return SynthesisResult(
                engine_id=self.engine_id,
                audio_path=str(out_path),
                audio_url=f"/results/{output_filename}",
                duration_seconds=round(duration_sec, 2),
                sample_rate=SAMPLE_RATE,
                latency_seconds=round(elapsed_sec, 2),
                rtf=round(rtf, 3),
                metadata={
                    "mode": "generative_baseline",
                    "model": "Bark (Suno AI)",
                    "sample_rate": SAMPLE_RATE,
                    "warning": "This engine does NOT clone your voice. It generates in Bark's own speaker distribution."
                }
            )
        except Exception as e:
            print(f"[BarkEngine] Inference failed: {e}")
            return SynthesisResult(
                engine_id=self.engine_id,
                audio_path="",
                audio_url="",
                duration_seconds=0.0,
                sample_rate=TARGET_SAMPLE_RATE,
                latency_seconds=0.0,
                rtf=0.0,
                metadata={"mode": "error", "error": str(e)}
            )
