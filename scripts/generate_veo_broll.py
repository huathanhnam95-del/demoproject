"""
Google Veo 3.1 B-roll Video Generator Utility
=============================================
Automated B-roll video generation using Google Veo 3.1 (`veo-3.1-fast-generate-preview`)
via the official `google-genai` SDK.

Features:
- Deterministic SHA-256 asset caching to prevent duplicate API calls and credit burns.
- Support for text-to-video and image-to-video (reference frame).
- Configurable aspect ratios (16:9, 9:16, 1:1), durations (5-8s), and resolutions.
- Robust polling loop with timeout guards and detailed progress reporting.
- Responsible AI (RAI) safety filter detection and informative error messages.
- Atomic file writes (.tmp -> .mp4) to prevent corrupted video assets.
- Sidecar JSON metadata saved alongside rendered videos.
- Both CLI and importable Python API (`generate_veo_broll`).

Author: Antigravity Autonomous Agent
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

# Load environment variables from project root .env
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"

if ENV_FILE.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_FILE)
    except ImportError:
        # Minimal fallback env parser if python-dotenv is absent
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))

DEFAULT_MODEL = "veo-3.1-fast-generate-preview"
DEFAULT_DURATION = 6
DEFAULT_ASPECT_RATIO = "16:9"
DEFAULT_FPS = 24
DEFAULT_RESOLUTION = "720p"
DEFAULT_POLL_INTERVAL = 5.0
DEFAULT_TIMEOUT = 360.0
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "output" / "veo_broll"

SUPPORTED_ASPECT_RATIOS = ["16:9", "9:16", "1:1"]
SUPPORTED_DURATIONS = [4, 5, 6, 8]
SUPPORTED_RESOLUTIONS = ["720p", "1080p"]


def get_api_key(prefer_backup: bool = False) -> str:
    """Retrieve Gemini API key from environment with validation and fallback."""
    if prefer_backup:
        key = os.environ.get("GEMINI_API_KEY_BACKUP", "").strip() or os.environ.get("GEMINI_API_KEY", "").strip()
    else:
        key = os.environ.get("GEMINI_API_KEY", "").strip() or os.environ.get("GEMINI_API_KEY_BACKUP", "").strip()
    if not key:
        raise ValueError(
            "GEMINI_API_KEY not found in environment or c:\\Cursor AI\\.env.\n"
            "Please ensure your Gemini API key is properly set in c:\\Cursor AI\\.env."
        )
    return key


def slugify(text: str, max_length: int = 40) -> str:
    """Generate a filesystem-safe slug from a text prompt."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", text.strip().lower())
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug[:max_length] or "veo_clip"


def compute_cache_key(
    prompt: str,
    model: str,
    aspect_ratio: str,
    duration: int,
    resolution: str,
    image_path: Optional[str | Path] = None,
) -> str:
    """Compute deterministic SHA-256 hash for generation parameters."""
    norm_model = model.strip().lower()
    if norm_model.startswith("models/"):
        norm_model = norm_model[len("models/"):]

    hasher = hashlib.sha256()
    hasher.update(norm_model.encode("utf-8"))
    hasher.update(b"|")
    hasher.update(prompt.strip().lower().encode("utf-8"))
    hasher.update(b"|")
    hasher.update(aspect_ratio.encode("utf-8"))
    hasher.update(b"|")
    hasher.update(str(duration).encode("utf-8"))
    hasher.update(b"|")
    hasher.update(resolution.encode("utf-8"))
    
    if image_path:
        img_p = Path(image_path).resolve()
        if img_p.exists():
            hasher.update(b"|img:")
            hasher.update(hashlib.sha256(img_p.read_bytes()).digest())

    return hasher.hexdigest()


def generate_veo_broll(
    prompt: str,
    output_path: Optional[str | Path] = None,
    output_dir: Optional[str | Path] = None,
    image_path: Optional[str | Path] = None,
    model: str = DEFAULT_MODEL,
    duration: int = DEFAULT_DURATION,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    resolution: str = DEFAULT_RESOLUTION,
    fps: int = DEFAULT_FPS,
    force: bool = False,
    dry_run: bool = False,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    timeout: float = DEFAULT_TIMEOUT,
    verbose: bool = True,
) -> Dict[str, Any]:
    """
    Generate a B-roll video using Google Veo 3.1 with asset caching.

    Returns:
        dict with keys: 'video_path', 'metadata_path', 'cached', 'model',
                        'prompt', 'duration', 'aspect_ratio', 'cache_key'
    """
    # 1. Parameter Validation
    prompt_clean = prompt.strip()
    if not prompt_clean:
        raise ValueError("Prompt cannot be empty.")

    if aspect_ratio not in SUPPORTED_ASPECT_RATIOS:
        raise ValueError(
            f"Invalid aspect ratio '{aspect_ratio}'. Supported: {SUPPORTED_ASPECT_RATIOS}"
        )

    if duration not in SUPPORTED_DURATIONS:
        raise ValueError(
            f"Invalid duration '{duration}'. Supported: {SUPPORTED_DURATIONS}"
        )

    if resolution not in SUPPORTED_RESOLUTIONS:
        raise ValueError(
            f"Invalid resolution '{resolution}'. Supported: {SUPPORTED_RESOLUTIONS}"
        )

    image_file: Optional[Path] = None
    if image_path:
        image_file = Path(image_path).resolve()
        if not image_file.exists():
            raise FileNotFoundError(f"Input image not found: {image_file}")

    # 2. Determine Output Directory and Paths
    target_dir = Path(output_dir).resolve() if output_dir else DEFAULT_OUTPUT_DIR
    target_dir.mkdir(parents=True, exist_ok=True)

    cache_key = compute_cache_key(
        prompt=prompt_clean,
        model=model,
        aspect_ratio=aspect_ratio,
        duration=duration,
        resolution=resolution,
        image_path=image_file,
    )
    short_hash = cache_key[:10]
    clip_slug = slugify(prompt_clean)

    if output_path:
        final_video_path = Path(output_path).resolve()
        final_video_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        final_video_path = target_dir / f"{clip_slug}_{short_hash}.mp4"

    metadata_path = final_video_path.with_suffix(".json")

    # 3. Check Cache
    if not force and final_video_path.exists() and final_video_path.stat().st_size > 1024:
        if verbose:
            print(f"[Veo 3.1 Cache Hit] Using cached video: {final_video_path.name}")
            print(f"  Path: {final_video_path}")
            print(f"  Hash: {cache_key}")
        return {
            "video_path": str(final_video_path),
            "metadata_path": str(metadata_path) if metadata_path.exists() else None,
            "cached": True,
            "model": model,
            "prompt": prompt_clean,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "cache_key": cache_key,
        }

    # 4. Dry Run Mode
    if dry_run:
        if verbose:
            print(f"[Veo 3.1 Dry Run] Simulation successful. Target would be:")
            print(f"  Model:        {model}")
            print(f"  Prompt:       {prompt_clean}")
            print(f"  Aspect Ratio: {aspect_ratio}")
            print(f"  Duration:     {duration}s")
            print(f"  Resolution:   {resolution}")
            print(f"  Output Path:  {final_video_path}")
            print(f"  Cache Key:    {cache_key}")
        return {
            "video_path": str(final_video_path),
            "metadata_path": str(metadata_path),
            "cached": False,
            "dry_run": True,
            "model": model,
            "prompt": prompt_clean,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "cache_key": cache_key,
        }

    # 5. Initialize Google GenAI Client
    api_key = get_api_key()
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ImportError(
            "The 'google-genai' package is required. Install via 'pip install google-genai'."
        )

    client = genai.Client(api_key=api_key)

    # Prepare Image if provided
    image_obj = None
    if image_file:
        if verbose:
            print(f"[Veo 3.1] Loading starting reference frame: {image_file.name}")
        image_obj = types.Image.from_file(location=str(image_file))

    # Prepare Video Generation Config
    config_args: Dict[str, Any] = {
        "aspect_ratio": aspect_ratio,
        "duration_seconds": duration,
        "number_of_videos": 1,
    }
    
    # Only Vertex AI supports the fps parameter in google-genai SDK.
    # Passing fps to Gemini Developer API (mldev) raises ValueError('fps parameter is not supported in Gemini API.').
    is_vertex = getattr(getattr(client, "_api_client", None), "vertexai", False)
    if is_vertex:
        config_args["fps"] = fps

    # Add resolution if supported by config model
    if hasattr(types.GenerateVideosConfig, "model_fields") and "resolution" in types.GenerateVideosConfig.model_fields:
        config_args["resolution"] = resolution

    config = types.GenerateVideosConfig(**config_args)

    if verbose:
        fps_info = f", {fps}fps" if is_vertex else ""
        print(f"[Veo 3.1] Requesting video generation from model: {model}")
        print(f"  Prompt: \"{prompt_clean}\"")
        print(f"  Settings: {aspect_ratio}, {duration}s, {resolution}{fps_info}")

    # 6. Submit Generation Request using official GenerateVideosSource
    try:
        source = types.GenerateVideosSource(
            prompt=prompt_clean,
            image=image_obj,
        )
        operation = client.models.generate_videos(
            model=model,
            source=source,
            config=config,
        )
    except Exception as e:
        err_msg = str(e)
        if ("RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg) and os.environ.get("GEMINI_API_KEY_BACKUP"):
            if verbose:
                print("[Veo 3.1] Primary key quota exhausted. Retrying with GEMINI_API_KEY_BACKUP...")
            backup_key = get_api_key(prefer_backup=True)
            client = genai.Client(api_key=backup_key)
            operation = client.models.generate_videos(
                model=model,
                source=source,
                config=config,
            )
        else:
            raise RuntimeError(f"Veo 3.1 API generation request failed: {e}") from e

    op_name = getattr(operation, "name", "unknown_operation")
    if verbose:
        print(f"[Veo 3.1] Operation started: {op_name}")
        print(f"[Veo 3.1] Polling operation status...")

    # 7. Polling Loop
    start_time = time.time()
    while not operation.done:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            raise TimeoutError(
                f"Veo 3.1 generation timed out after {elapsed:.1f}s (timeout={timeout}s)."
            )
        time.sleep(poll_interval)
        try:
            operation = client.operations.get(operation=operation)
        except Exception as e:
            if verbose:
                print(f"  [Veo 3.1 Warning] Transient poll error: {e}. Retrying...")
            continue

        if verbose:
            sys.stdout.write(f"\r  [Veo 3.1] Generating... (elapsed: {int(elapsed)}s)")
            sys.stdout.flush()

    if verbose:
        print("")

    # 8. Check Operation Errors
    if getattr(operation, "error", None):
        err = operation.error
        raise RuntimeError(f"Veo 3.1 generation operation failed: {err}")

    # 9. Extract and Validate Result
    response = getattr(operation, "response", None) or getattr(operation, "result", None)
    if not response:
        raise RuntimeError("Veo 3.1 operation completed but returned no response payload.")

    filtered_count = getattr(response, "rai_media_filtered_count", 0) or 0
    if filtered_count > 0:
        reasons = getattr(response, "rai_media_filtered_reasons", [])
        raise RuntimeError(
            f"Veo 3.1 video was filtered by Responsible AI safety policy. "
            f"Filtered count: {filtered_count}, Reasons: {reasons}"
        )

    generated_videos = getattr(response, "generated_videos", [])
    if not generated_videos or not generated_videos[0]:
        raise RuntimeError("Veo 3.1 returned no generated videos in response payload.")

    first_gen_video = generated_videos[0]
    first_video = getattr(first_gen_video, "video", None)
    if not first_video:
        raise RuntimeError("Veo 3.1 generated video payload is missing video object.")

    video_bytes: Optional[bytes] = getattr(first_video, "video_bytes", None)

    # If video bytes not directly embedded, download via client.files
    if not video_bytes:
        if verbose:
            print("[Veo 3.1] Downloading video stream data...")
        try:
            downloaded = client.files.download(file=first_video)
            video_bytes = downloaded or getattr(first_video, "video_bytes", None)
        except Exception as e:
            raise RuntimeError(f"Failed to download generated video data: {e}") from e

    if not video_bytes or len(video_bytes) < 1024:
        raise RuntimeError(
            f"Generated video payload is empty or invalid ({len(video_bytes) if video_bytes else 0} bytes)."
        )

    # 10. Atomic File Write
    temp_video_path = final_video_path.with_suffix(".tmp.mp4")
    temp_video_path.write_bytes(video_bytes)
    temp_video_path.replace(final_video_path)

    # 11. Write Metadata Sidecar
    metadata = {
        "model": model,
        "prompt": prompt_clean,
        "aspect_ratio": aspect_ratio,
        "duration_seconds": duration,
        "resolution": resolution,
        "fps": fps,
        "cache_key": cache_key,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "operation_name": op_name,
        "file_size_bytes": len(video_bytes),
        "source_image": str(image_file) if image_file else None,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    if verbose:
        print(f"[Veo 3.1 Success] Video saved to: {final_video_path}")
        print(f"  Size: {len(video_bytes) / (1024 * 1024):.2f} MB")
        print(f"  Metadata: {metadata_path}")

    return {
        "video_path": str(final_video_path),
        "metadata_path": str(metadata_path),
        "cached": False,
        "model": model,
        "prompt": prompt_clean,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "cache_key": cache_key,
        "file_size_bytes": len(video_bytes),
    }


def main() -> None:
    """CLI entry point for generate_veo_broll."""
    parser = argparse.ArgumentParser(
        description="Generate B-roll video using Google Veo 3.1 with asset caching."
    )
    parser.add_argument(
        "--prompt", "-p",
        type=str,
        required=True,
        help="Text description of the B-roll video scene to generate.",
    )
    parser.add_argument(
        "--image", "-i",
        type=str,
        default=None,
        help="Optional path to starting image for image-to-video generation.",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Explicit destination path for the generated MP4.",
    )
    parser.add_argument(
        "--output-dir", "-d",
        type=str,
        default=None,
        help=f"Destination directory for output videos (default: {DEFAULT_OUTPUT_DIR}).",
    )
    parser.add_argument(
        "--model", "-m",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Veo model name (default: {DEFAULT_MODEL}).",
    )
    parser.add_argument(
        "--duration",
        type=int,
        choices=SUPPORTED_DURATIONS,
        default=DEFAULT_DURATION,
        help=f"Video duration in seconds (default: {DEFAULT_DURATION}).",
    )
    parser.add_argument(
        "--aspect-ratio", "-ar",
        type=str,
        choices=SUPPORTED_ASPECT_RATIOS,
        default=DEFAULT_ASPECT_RATIO,
        help=f"Aspect ratio (default: {DEFAULT_ASPECT_RATIO}).",
    )
    parser.add_argument(
        "--resolution", "-r",
        type=str,
        choices=SUPPORTED_RESOLUTIONS,
        default=DEFAULT_RESOLUTION,
        help=f"Resolution (default: {DEFAULT_RESOLUTION}).",
    )
    parser.add_argument(
        "--fps",
        type=int,
        default=DEFAULT_FPS,
        help=f"Frames per second (default: {DEFAULT_FPS}).",
    )
    parser.add_argument(
        "--force", "-f",
        action="store_true",
        help="Force regeneration even if a cached video exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate parameters and test cache key without calling Veo API.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"Maximum seconds to wait for generation to complete (default: {DEFAULT_TIMEOUT}s).",
    )

    args = parser.parse_args()

    try:
        result = generate_veo_broll(
            prompt=args.prompt,
            output_path=args.output,
            output_dir=args.output_dir,
            image_path=args.image,
            model=args.model,
            duration=args.duration,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
            fps=args.fps,
            force=args.force,
            dry_run=args.dry_run,
            timeout=args.timeout,
        )
        print(json.dumps(result, indent=2))
    except Exception as exc:
        sys.stderr.write(f"\n[Error] {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
