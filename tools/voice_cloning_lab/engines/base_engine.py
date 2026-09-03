"""
Base Engine Interface for Voice Cloning Models
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, Optional
from pathlib import Path
import time

@dataclass
class SynthesisResult:
    engine_id: str
    audio_path: str
    audio_url: str
    duration_seconds: float
    sample_rate: int
    latency_seconds: float
    rtf: float  # Real-Time Factor = latency / duration
    metadata: Dict[str, Any] = field(default_factory=dict)

class BaseVoiceCloningEngine(ABC):
    def __init__(self, engine_id: str, name: str, badge: str):
        self.engine_id = engine_id
        self.name = name
        self.badge = badge
        self._is_loaded = False

    @abstractmethod
    def is_available(self) -> bool:
        """Check if required packages, weights, and dependencies are ready."""
        pass

    @abstractmethod
    def load_model(self) -> bool:
        """Load model weights into GPU/CPU memory."""
        pass

    @abstractmethod
    def synthesize(
        self,
        target_text: str,
        reference_audio_path: str,
        reference_transcript: str = "",
        emotion: str = "neutral",
        speed: float = 1.0,
        output_filename: Optional[str] = None
    ) -> SynthesisResult:
        """
        Generate cloned speech from target text using the reference voice sample.
        """
        pass
