"""
Speaker Similarity Scorer (SECS - Speaker Embedding Cosine Similarity)
Measures vocal timbre match between the reference voice and synthesized candidates
using resemblyzer d-vector speaker embeddings.
"""

import warnings
import numpy as np
from pathlib import Path
from typing import Optional


class SpeakerSimilarityScorer:
    def __init__(self):
        self.use_neural = False
        self._encoder = None
        try:
            from resemblyzer import VoiceEncoder
            # Lazy-load the model on first use to avoid slow import
            self._encoder_cls = VoiceEncoder
            self.use_neural = True
        except ImportError:
            warnings.warn(
                "resemblyzer not installed — SpeakerSimilarityScorer will "
                "return 0.0 for all comparisons. Install with: pip install resemblyzer"
            )
            self._encoder_cls = None

    def _get_encoder(self):
        """Lazy-initialize the VoiceEncoder on first call."""
        if self._encoder is None and self._encoder_cls is not None:
            self._encoder = self._encoder_cls(device="cpu")
        return self._encoder

    def _load_audio_as_float32(self, audio_path: str, target_sr: int = 16000) -> Optional[np.ndarray]:
        """
        Load an audio file and return it as a 1-D float32 numpy array at target_sr.
        Supports WAV (via soundfile) and other formats like WebM/Opus (via PyAV).
        """
        path = Path(audio_path)
        if not path.exists():
            warnings.warn(f"Audio file not found: {audio_path}")
            return None

        suffix = path.suffix.lower()

        # --- Try soundfile first (handles WAV, FLAC, OGG natively) ---
        if suffix in (".wav", ".flac", ".ogg"):
            try:
                import soundfile as sf
                data, sr = sf.read(str(path), dtype="float32", always_2d=False)
                if data.ndim > 1:
                    data = data.mean(axis=1)  # mono mix
                if sr != target_sr:
                    data = self._resample(data, sr, target_sr)
                return data
            except Exception as e:
                warnings.warn(f"soundfile failed for {audio_path}: {e}, trying PyAV fallback")

        # --- PyAV fallback for WebM, Opus, MP3, etc. ---
        try:
            import av
            container = av.open(str(path))
            audio_stream = next(s for s in container.streams if s.type == "audio")

            resampler = av.AudioResampler(
                format="s16",
                layout="mono",
                rate=target_sr,
            )

            frames = []
            for frame in container.decode(audio_stream):
                resampled = resampler.resample(frame)
                for r_frame in resampled:
                    arr = r_frame.to_ndarray().flatten()
                    frames.append(arr)

            container.close()

            if not frames:
                warnings.warn(f"No audio frames decoded from {audio_path}")
                return None

            raw = np.concatenate(frames).astype(np.float32) / 32768.0
            return raw

        except Exception as e:
            warnings.warn(f"Failed to load audio {audio_path}: {e}")
            return None

    @staticmethod
    def _resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Simple linear interpolation resampler (good enough for embeddings)."""
        if orig_sr == target_sr:
            return audio
        duration = len(audio) / orig_sr
        target_len = int(duration * target_sr)
        indices = np.linspace(0, len(audio) - 1, target_len)
        return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)

    def compute_secs(self, reference_wav_path: str, candidate_wav_path: str, engine_id: str = "") -> float:
        """
        Calculates real speaker cosine similarity score between 0.0 and 1.0
        using resemblyzer d-vector speaker embeddings.

        Args:
            reference_wav_path: Path to the reference voice audio file.
            candidate_wav_path: Path to the synthesized candidate audio file.
            engine_id: (unused, kept for backward compatibility)

        Returns:
            Cosine similarity between the two speaker embeddings (0.0 – 1.0).
        """
        if not self.use_neural:
            warnings.warn("Neural encoder unavailable — returning 0.0")
            return 0.0

        try:
            ref_audio = self._load_audio_as_float32(reference_wav_path, target_sr=16000)
            cand_audio = self._load_audio_as_float32(candidate_wav_path, target_sr=16000)

            if ref_audio is None or cand_audio is None:
                return 0.0

            # Ensure minimum length (~0.5 s at 16 kHz)
            min_samples = 8000
            if len(ref_audio) < min_samples or len(cand_audio) < min_samples:
                warnings.warn("Audio too short for reliable embedding extraction")
                return 0.0

            encoder = self._get_encoder()
            ref_embed = encoder.embed_utterance(ref_audio)
            cand_embed = encoder.embed_utterance(cand_audio)

            # Cosine similarity
            cosine_sim = float(np.dot(ref_embed, cand_embed) / (
                np.linalg.norm(ref_embed) * np.linalg.norm(cand_embed) + 1e-8
            ))

            # Clamp to [0.0, 1.0]
            return round(max(0.0, min(1.0, cosine_sim)), 4)

        except Exception as e:
            warnings.warn(f"SECS computation failed: {e}")
            return 0.0
