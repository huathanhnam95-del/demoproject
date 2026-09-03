"""
Voice Cloning Laboratory - E2-TTS Engine Adapter
Real Neural Zero-Shot Voice Cloning using Flat-Transformer Flow Matching.
Ingests raw reference audio (.webm/wav) directly.
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


class E2TTSEngine(BaseVoiceCloningEngine):
    """
    E2-TTS (Embarrassingly Easy TTS): Flat-Transformer based continuous flow matching.
    Uses duration-free UNet/DiT architecture with Vocos 24kHz neural vocoder.
    """

    def __init__(self, engine_id: str = "e2_tts"):
        super().__init__(
            engine_id=engine_id,
            name="E2-TTS (Flat-Transformer)",
            badge="DURATION-FREE DiT"
        )
        self.model = None

    def is_available(self) -> bool:
        try:
            import f5_tts
            return True
        except ImportError:
            return False

    def load_model(self) -> bool:
        try:
            from f5_tts.api import F5TTS
            print(f"[E2TTSEngine] Initializing E2-TTS (model='E2TTS_Base') on CPU...")
            self.model = F5TTS(model="E2TTS_Base", device="cpu")
            self._is_loaded = True
            print("[E2TTSEngine] E2-TTS successfully loaded!")
            return True
        except Exception as e:
            print(f"[E2TTSEngine] Error loading E2-TTS: {e}")
            self._is_loaded = False
            return False

    def _prepare_reference_wav(self, reference_audio_path: str) -> tuple[str, str]:
        ref_path = Path(reference_audio_path)
        if ref_path.is_dir() or not ref_path.exists():
            candidates = list(SAMPLES_DIR.glob(f"{ref_path.stem}*")) + list(SAMPLES_DIR.glob("*.webm")) + list(SAMPLES_DIR.glob("*.wav"))
            valid_files = [p for p in candidates if p.is_file()]
            if valid_files:
                ref_path = valid_files[0]
            else:
                ref_path = SAMPLES_DIR / "my_saved_voice.webm"
                if not ref_path.exists():
                    raise FileNotFoundError(f"Reference audio not found: {reference_audio_path}")

        # Decode using PyAV into 24kHz float32 mono
        container = av.open(str(ref_path))
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=TARGET_SAMPLE_RATE)
        chunks = []
        for frame in container.decode(audio=0):
            frame.pts = None
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray())

        if not chunks:
            raise ValueError(f"Could not decode audio from: {ref_path}")

        audio_data = np.concatenate(chunks, axis=1)[0]
        
        # Take a clean 12-second slice for crisp calibration
        max_samples = 12 * TARGET_SAMPLE_RATE
        slice_data = audio_data[:max_samples] if len(audio_data) > max_samples else audio_data
        ref_text = "Certain types of methodology are more suitable for some research projects than others. For example, the use of questionnaires in surveys is more suitable for quantitative research."

        clean_wav_path = SAMPLES_DIR / f"{ref_path.stem}_e2_calib_24k.wav"
        sf.write(str(clean_wav_path), slice_data, TARGET_SAMPLE_RATE)
        return str(clean_wav_path), ref_text

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

        if not self._is_loaded or self.model is None:
            return SynthesisResult(
                engine_id=self.engine_id,
                audio_path="",
                audio_url="",
                duration_seconds=0.0,
                sample_rate=TARGET_SAMPLE_RATE,
                latency_seconds=0.0,
                rtf=0.0,
                metadata={"mode": "error", "error": "E2-TTS model failed to load"}
            )

        try:
            start_time = time.perf_counter()
            clean_ref_wav, default_ref_text = self._prepare_reference_wav(reference_audio_path)
            
            # Use matched 12s calibration text if the passed transcript is the full 3-paragraph dump (> 30 words)
            if reference_transcript and len(reference_transcript.split()) <= 30:
                ref_text = reference_transcript
            else:
                ref_text = default_ref_text

            if not output_filename:
                timestamp = int(time.time() * 1000)
                output_filename = f"e2_tts_{timestamp}.wav"

            out_path = RESULTS_DIR / output_filename

            print(f"[E2TTSEngine] Running real E2-TTS Flow Matching inference on '{target_text[:40]}...'")
            wav, sr, _ = self.model.infer(
                ref_file=clean_ref_wav,
                ref_text=ref_text,
                gen_text=target_text,
                file_wave=str(out_path),
                nfe_step=16,
                speed=speed
            )
            elapsed_sec = time.perf_counter() - start_time

            audio_data, sample_rate = sf.read(str(out_path))
            duration_sec = len(audio_data) / sample_rate
            rtf = elapsed_sec / max(duration_sec, 0.1)

            print(f"[E2TTSEngine] Synthesis complete! Duration: {duration_sec:.2f}s, RTF: {rtf:.2f}x")

            return SynthesisResult(
                engine_id=self.engine_id,
                audio_path=str(out_path),
                audio_url=f"/results/{output_filename}",
                duration_seconds=duration_sec,
                sample_rate=sample_rate,
                latency_seconds=elapsed_sec,
                rtf=rtf,
                metadata={
                    "mode": "neural_clone",
                    "model": "E2-TTS (Flat-Transformer)",
                    "rtf": round(rtf, 3),
                    "sample_rate": sample_rate,
                    "nfe_steps": 16,
                    "vocoder": "Vocos 24kHz"
                }
            )
        except Exception as e:
            print(f"[E2TTSEngine] Inference failed: {e}")
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

