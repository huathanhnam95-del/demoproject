"""
Centralized Local LLM Model Configuration for Better English Learning
Defines active Ollama model identifiers and resolution fallbacks for local AI pipelines.
"""

import os

# Default active model tags for the 3-model committee
DEFAULT_MODELS = {
    "qwen": os.getenv("LOCAL_QWEN_MODEL", os.getenv("TEACHING_LOGGER_QWEN_MODEL", "qwen3:14b")),
    "deepseek": os.getenv("LOCAL_DEEPSEEK_MODEL", os.getenv("TEACHING_LOGGER_DEEPSEEK_MODEL", "deepseek-r1:14b")),
    "gemma": os.getenv("LOCAL_GEMMA_MODEL", os.getenv("TEACHING_LOGGER_GEMMA_MODEL", "gemma4:12b"))
}

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_GENERATE_URL = f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate"


def get_model(role: str) -> str:
    """
    Get the configured model name for a specific role ('qwen', 'deepseek', 'gemma').
    Falls back to sensible defaults if unspecified.
    """
    return DEFAULT_MODELS.get(role.lower(), "gemma4:12b")


def get_all_models() -> dict[str, str]:
    """Return a dictionary of all active models in the triad."""
    return dict(DEFAULT_MODELS)
