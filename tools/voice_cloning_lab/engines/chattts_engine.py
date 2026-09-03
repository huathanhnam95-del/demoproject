"""
Voice Cloning Laboratory - ChatTTS Engine Adapter
Real Neural Conversational Speech Engine.
Zero Kokoro fallbacks.
"""

import os
import time
from pathlib import Path
from typing import Optional, List, Dict, Any

import numpy as np
import soundfile as sf
import av

from tools.voice_cloning_lab.engines.base_engine import BaseVoiceCloningEngine, SynthesisResult
from tools.voice_cloning_lab.config import SAMPLES_DIR, RESULTS_DIR, TARGET_SAMPLE_RATE


class ChatTTSEngine(BaseVoiceCloningEngine):
    """
    ChatTTS: Conversational Generative Speech Architecture.
    NOTE: ChatTTS does NOT support zero-shot voice cloning from reference audio.
    It generates speech in its own learned speaker distribution. Included as a
    non-cloned generative baseline for quality comparison only.
    """

    def __init__(self, engine_id: str = "chattts"):
        super().__init__(
            engine_id=engine_id,
            name="ChatTTS (Generative Baseline)",
            badge="⚠️ NO CLONING"
        )
        self.chat = None

    def is_available(self) -> bool:
        try:
            import ChatTTS
            return True
        except ImportError:
            return False

    def load_model(self) -> bool:
        try:
            import ChatTTS
            print(f"[ChatTTSEngine] Initializing ChatTTS from Hugging Face on CPU...")
            self.chat = ChatTTS.Chat()
            self.chat.load(source="huggingface", device="cpu", compile=False)
            self._is_loaded = True
            print("[ChatTTSEngine] ChatTTS successfully loaded!")
            return True
        except Exception as e:
            print(f"[ChatTTSEngine] Error loading ChatTTS: {e}")
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

        if not self._is_loaded or self.chat is None:
            return SynthesisResult(
                engine_id=self.engine_id,
                audio_path="",
                audio_url="",
                duration_seconds=0.0,
                sample_rate=TARGET_SAMPLE_RATE,
                latency_seconds=0.0,
                rtf=0.0,
                metadata={"mode": "error", "error": "ChatTTS model failed to load"}
            )

        try:
            start_time = time.perf_counter()

            if not output_filename:
                timestamp = int(time.time() * 1000)
                output_filename = f"chattts_{timestamp}.wav"

            out_path = RESULTS_DIR / output_filename

            # NOTE: ChatTTS ignores reference audio — it generates in its own voice
            print(f"[ChatTTSEngine] Running ChatTTS inference (no cloning) on '{target_text[:40]}...'")
            wavs = self.chat.infer([target_text])
            audio_data = np.array(wavs[0])
            if len(audio_data.shape) > 1:
                audio_data = audio_data[0]

            # Save to 24kHz standard WAV
            sf.write(str(out_path), audio_data, TARGET_SAMPLE_RATE)
            elapsed_sec = time.perf_counter() - start_time

            duration_sec = len(audio_data) / TARGET_SAMPLE_RATE
            rtf = elapsed_sec / max(duration_sec, 0.1)

            print(f"[ChatTTSEngine] Synthesis complete! Duration: {duration_sec:.2f}s, RTF: {rtf:.2f}x")

            return SynthesisResult(
                engine_id=self.engine_id,
                audio_path=str(out_path),
                audio_url=f"/results/{output_filename}",
                duration_seconds=duration_sec,
                sample_rate=TARGET_SAMPLE_RATE,
                latency_seconds=elapsed_sec,
                rtf=rtf,
                metadata={
                    "mode": "generative_baseline",
                    "model": "ChatTTS (Generative Baseline)",
                    "rtf": round(rtf, 3),
                    "sample_rate": TARGET_SAMPLE_RATE,
                    "architecture": "Conversational Autoregressive",
                    "warning": "This engine does NOT clone your voice. It generates in its own speaker distribution."
                }
            )
        except Exception as e:
            print(f"[ChatTTSEngine] Inference failed: {e}")
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

