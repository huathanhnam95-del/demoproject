"""
Voice Cloning Laboratory - Configuration
Production Engine: F5-TTS (Continuous Mel-Flow Matching DiT)
Zero-Shot Neural Voice Cloning Studio
"""

import os
from pathlib import Path

# Base Paths
LAB_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = LAB_DIR / "samples"
RESULTS_DIR = LAB_DIR / "results"
RA10_DIR = RESULTS_DIR / "ra_10"
MODELS_DIR = LAB_DIR / "models"

# Ensure runtime directories exist
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
RA10_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Server Config
HOST = "127.0.0.1"
PORT = 8890

# Audio Constraints
MAX_REFERENCE_DURATION_SEC = 60.0  # 1 minute max reference audio
TARGET_SAMPLE_RATE = 24000         # 24 kHz standard for high-fidelity generative TTS
DEFAULT_SPEED = 1.0

# Synthesis mode labels
SYNTHESIS_MODES = {
    "neural_clone": {"label": "Neural Voice Clone", "badge_color": "#10b981", "icon": "⭐"},
    "error": {"label": "Error", "badge_color": "#ef4444", "icon": "🚫"},
}

# Engine Metadata — Exclusively F5-TTS Production Cloner
ENGINES_METADATA = {
    "f5_tts": {
        "id": "f5_tts",
        "name": "F5-TTS (Mel-Flow Matching DiT)",
        "badge": "⭐ NEURAL CLONE",
        "description": "Continuous Mel-Flow Matching Diffusion Transformer. Zero-shot acoustic inpainting conditioned on your reference audio.",
        "version": "v1.1 (SWivid/F5-TTS)",
        "color": "#6366f1",
        "cloning_method": "zero_shot",
        "is_real_cloner": True
    }
}
