import os
import json
import re
from pathlib import Path

def parse_transcript_file(file_path: str) -> str:
    """Read and normalize an existing transcript from .txt, .srt, .vtt, or .json file."""
    p = Path(file_path)
    if not p.exists():
        raise FileNotFoundError(f"Transcript file not found: {file_path}")

    content = p.read_text(encoding="utf-8")
    ext = p.suffix.lower()

    if ext == ".json":
        try:
            data = json.loads(content)
            if isinstance(data, list):
                # Expected format: [{"speaker": "Teacher", "text": "...", "timestamp": "..."}]
                lines = []
                for item in data:
                    spk = item.get("speaker", "Speaker")
                    txt = item.get("text", "")
                    ts = item.get("timestamp", "")
                    ts_str = f"[{ts}] " if ts else ""
                    lines.append(f"{ts_str}{spk}: {txt}")
                return "\n".join(lines)
            elif isinstance(data, dict) and "transcript" in data:
                return data["transcript"]
        except Exception:
            return content

    elif ext in [".srt", ".vtt"]:
        # Strip timestamps and index numbers, preserve speaker names if present
        clean_lines = []
        for line in content.splitlines():
            line = line.strip()
            if not line:
                continue
            if re.match(r"^\d+$", line):
                continue
            if "-->" in line:
                continue
            if line.startswith("WEBVTT"):
                continue
            clean_lines.append(line)
        return "\n".join(clean_lines)

    return content


def run_local_stt(
    audio_path: str,
    model_size: str = "large-v3-turbo",
    device: str = "auto"
) -> str:
    """
    Run local Whisper Speech-to-Text on audio file.
    If faster_whisper or whisper is available, transcribes audio locally.
    Otherwise raises helpful error or fallback instructions.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    try:
        from faster_whisper import WhisperModel
        print(f"[Local STT] Loading faster-whisper model ({model_size}) on device={device}...")
        model = WhisperModel(model_size, device=device, compute_type="float16" if device == "cuda" else "int8")
        segments, info = model.transcribe(audio_path, beam_size=5, vad_filter=True)

        print(f"[Local STT] Detected language: {info.language} with probability {info.language_probability:.2f}")

        formatted_lines = []
        for segment in segments:
            start_m, start_s = divmod(int(segment.start), 60)
            start_h, start_m = divmod(start_m, 60)
            ts = f"{start_h:02d}:{start_m:02d}:{start_s:02d}"
            formatted_lines.append(f"[{ts}] {segment.text.strip()}")

        return "\n".join(formatted_lines)

    except ImportError:
        pass

    try:
        import whisper
        print(f"[Local STT] Loading OpenAI whisper model ({model_size})...")
        model = whisper.load_model(model_size)
        result = model.transcribe(audio_path)
        return result.get("text", "")
    except ImportError:
        pass

    raise ImportError(
        "No local Whisper package found. Please install faster-whisper (`pip install faster-whisper`) "
        "or provide a pre-transcribed text file with `--transcript path/to/transcript.txt`."
    )
