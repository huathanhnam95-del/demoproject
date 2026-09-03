"""
Intelligibility & Pronunciation Accuracy Evaluator
Calculates Word Error Rate (WER) using ASR transcription (faster-whisper)
compared against the target text.
"""

import warnings
import re
from typing import List, Optional
from pathlib import Path


class IntelligibilityEvaluator:
    def __init__(self):
        self._whisper_model = None
        self._whisper_available = False
        try:
            from faster_whisper import WhisperModel  # noqa: F401
            self._whisper_available = True
        except ImportError:
            warnings.warn(
                "faster-whisper not installed - compute_real_wer() will "
                "return 1.0. Install with: pip install faster-whisper"
            )

    def _get_whisper_model(self):
        """Lazy-initialize the Whisper model on first use."""
        if self._whisper_model is None and self._whisper_available:
            from faster_whisper import WhisperModel
            self._whisper_model = WhisperModel(
                "base",
                device="cpu",
                compute_type="int8",
            )
        return self._whisper_model

    def compute_wer(self, reference_text: str, hypothesis_text: str) -> float:
        """
        Levenshtein-based Word Error Rate computation.
        """
        ref_words = self._clean_and_tokenize(reference_text)
        hyp_words = self._clean_and_tokenize(hypothesis_text)

        if not ref_words:
            return 0.0 if not hyp_words else 1.0

        d = [[0] * (len(hyp_words) + 1) for _ in range(len(ref_words) + 1)]

        for i in range(len(ref_words) + 1):
            d[i][0] = i
        for j in range(len(hyp_words) + 1):
            d[0][j] = j

        for i in range(1, len(ref_words) + 1):
            for j in range(1, len(hyp_words) + 1):
                if ref_words[i - 1] == hyp_words[j - 1]:
                    d[i][j] = d[i - 1][j - 1]
                else:
                    substitution = d[i - 1][j - 1] + 1
                    insertion = d[i][j - 1] + 1
                    deletion = d[i - 1][j] + 1
                    d[i][j] = min(substitution, insertion, deletion)

        return float(d[len(ref_words)][len(hyp_words)] / len(ref_words))

    def transcribe(self, audio_path: str) -> str:
        """Transcribe audio using faster-whisper on CPU."""
        if not self._whisper_available:
            return ""
        audio_file = Path(audio_path)
        if not audio_file.exists():
            return ""
        try:
            model = self._get_whisper_model()
            segments, _ = model.transcribe(
                str(audio_file),
                beam_size=5,
                language="en",
                vad_filter=True,
            )
            return " ".join(seg.text.strip() for seg in segments).strip()
        except Exception as e:
            warnings.warn(f"Transcription error: {e}")
            return ""

    def compute_real_wer(self, target_text: str, audio_path: str) -> float:
        """Compute WER by transcribing the audio and comparing against target_text."""
        transcript = self.transcribe(audio_path)
        if not transcript:
            return 1.0
        return self.compute_wer(target_text, transcript)

    def estimate_engine_wer(self, target_text: str, engine_id: str = "") -> float:
        """Deprecated method kept for backwards compatibility."""
        return 0.0

    def _clean_and_tokenize(self, text: str) -> List[str]:
        text = text.lower()
        text = re.sub(r"[^\w\s]", "", text)
        return text.split()
