"""Unit tests for scripts/generate_veo_broll.py."""

import json
import sys
import tempfile
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.generate_veo_broll import (
    DEFAULT_DURATION,
    compute_cache_key,
    generate_veo_broll,
    slugify,
)


def test_slugify():
    assert slugify("Hello World! 123") == "hello_world_123"
    assert slugify("---test___slug---") == "test_slug"
    assert len(slugify("a" * 100, max_length=20)) == 20
    assert slugify("", max_length=20) == "veo_clip"


def test_compute_cache_key_deterministic():
    key1 = compute_cache_key("test prompt", "veo-3.1", "16:9", 5, "720p")
    key2 = compute_cache_key("TEST PROMPT", "veo-3.1", "16:9", 5, "720p")
    assert key1 == key2

    key3 = compute_cache_key("test prompt", "veo-3.1", "9:16", 5, "720p")
    assert key1 != key3


def test_parameter_validation_empty_prompt():
    with pytest.raises(ValueError, match="Prompt cannot be empty"):
        generate_veo_broll(prompt="   ")


def test_parameter_validation_invalid_aspect_ratio():
    with pytest.raises(ValueError, match="Invalid aspect ratio"):
        generate_veo_broll(prompt="test", aspect_ratio="4:3")


def test_parameter_validation_invalid_duration():
    with pytest.raises(ValueError, match="Invalid duration"):
        generate_veo_broll(prompt="test", duration=10)


def test_parameter_validation_invalid_resolution():
    with pytest.raises(ValueError, match="Invalid resolution"):
        generate_veo_broll(prompt="test", resolution="4k")


def test_parameter_validation_nonexistent_image():
    with pytest.raises(FileNotFoundError, match="Input image not found"):
        generate_veo_broll(prompt="test", image_path="nonexistent_image_12345.png")


def test_dry_run_output():
    with tempfile.TemporaryDirectory() as tmpdir:
        res = generate_veo_broll(
            prompt="A testing prompt for broll",
            output_dir=tmpdir,
            dry_run=True,
            verbose=False,
        )
        assert res["cached"] is False
        assert res["dry_run"] is True
        assert res["model"] == "veo-3.1-fast-generate-preview"
        assert res["duration"] == DEFAULT_DURATION
        assert Path(res["video_path"]).parent == Path(tmpdir).resolve()


def test_cache_hit_logic():
    with tempfile.TemporaryDirectory() as tmpdir:
        target_video = Path(tmpdir) / "custom_test.mp4"
        # Write dummy mp4 > 1024 bytes
        target_video.write_bytes(b"0" * 2048)

        # First call without force: should hit cache
        res = generate_veo_broll(
            prompt="Cached prompt test",
            output_path=target_video,
            dry_run=False,
            force=False,
            verbose=False,
        )
        assert res["cached"] is True
        assert res["video_path"] == str(target_video.resolve())
        assert res["resolution"] == "720p"


def test_compute_cache_key_model_normalization():
    key1 = compute_cache_key("test prompt", "veo-3.1-fast-generate-preview", "16:9", 5, "720p")
    key2 = compute_cache_key("test prompt", "models/veo-3.1-fast-generate-preview", "16:9", 5, "720p")
    assert key1 == key2


def test_compute_cache_key_with_image():
    with tempfile.TemporaryDirectory() as tmpdir:
        img_path = Path(tmpdir) / "frame.png"
        img_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"12345")

        key_no_img = compute_cache_key("test prompt", "veo-3.1", "16:9", 5, "720p")
        key_with_img = compute_cache_key("test prompt", "veo-3.1", "16:9", 5, "720p", image_path=img_path)
        assert key_no_img != key_with_img

        # Changing image bytes alters cache key
        img_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"67890")
        key_with_img2 = compute_cache_key("test prompt", "veo-3.1", "16:9", 5, "720p", image_path=img_path)
        assert key_with_img != key_with_img2


def test_missing_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY_BACKUP", raising=False)
    with pytest.raises(ValueError, match="GEMINI_API_KEY not found"):
        generate_veo_broll(prompt="test prompt", dry_run=False, force=True)


def test_mock_live_generation_success(monkeypatch):
    from unittest.mock import MagicMock
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_API_KEY", "mock_key_123")

    fake_video_bytes = b"MOCK_MP4_VIDEO_HEADER_DATA_" + b"x" * 2048
    mock_video = SimpleNamespace(video_bytes=fake_video_bytes, uri="files/mock123")
    mock_gen_video = SimpleNamespace(video=mock_video)
    mock_response = SimpleNamespace(
        rai_media_filtered_count=0,
        rai_media_filtered_reasons=[],
        generated_videos=[mock_gen_video],
    )
    mock_operation = SimpleNamespace(
        name="operations/mock_op_456",
        done=True,
        error=None,
        response=mock_response,
        result=mock_response,
    )

    mock_client = MagicMock()
    mock_client._api_client.vertexai = False
    mock_client.models.generate_videos.return_value = mock_operation
    mock_client.operations.get.return_value = mock_operation

    with tempfile.TemporaryDirectory() as tmpdir:
        out_video = Path(tmpdir) / "output.mp4"
        with monkeypatch.context() as m:
            m.setattr("google.genai.Client", lambda api_key: mock_client)
            res = generate_veo_broll(
                prompt="A serene bamboo forest in misty morning light",
                output_path=out_video,
                dry_run=False,
                force=True,
                verbose=False,
            )

        assert res["cached"] is False
        assert res["video_path"] == str(out_video.resolve())
        assert res["resolution"] == "720p"
        assert out_video.exists()
        assert out_video.read_bytes() == fake_video_bytes

        # Check sidecar metadata
        meta_path = out_video.with_suffix(".json")
        assert meta_path.exists()
        metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        assert metadata["model"] == "veo-3.1-fast-generate-preview"
        assert metadata["duration_seconds"] == DEFAULT_DURATION

        # Verify generate_videos call
        mock_client.models.generate_videos.assert_called_once()
        call_kwargs = mock_client.models.generate_videos.call_args.kwargs
        assert call_kwargs["model"] == "veo-3.1-fast-generate-preview"
        assert call_kwargs["source"].prompt == "A serene bamboo forest in misty morning light"
        # Verify fps is NOT passed for Gemini Developer API
        assert not hasattr(call_kwargs["config"], "fps") or call_kwargs["config"].fps is None


def test_mock_live_generation_download_fallback(monkeypatch):
    from unittest.mock import MagicMock
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_API_KEY", "mock_key_123")

    fake_video_bytes = b"MOCK_STREAM_DOWNLOAD_" + b"z" * 2048
    # video_bytes is initially None, requiring files.download
    mock_video = SimpleNamespace(video_bytes=None, uri="files/stream_123")
    mock_gen_video = SimpleNamespace(video=mock_video)
    mock_response = SimpleNamespace(
        rai_media_filtered_count=0,
        rai_media_filtered_reasons=[],
        generated_videos=[mock_gen_video],
    )
    mock_operation = SimpleNamespace(
        name="operations/mock_stream_789",
        done=True,
        error=None,
        response=mock_response,
        result=mock_response,
    )

    mock_client = MagicMock()
    mock_client._api_client.vertexai = False
    mock_client.models.generate_videos.return_value = mock_operation
    mock_client.files.download.return_value = fake_video_bytes

    with tempfile.TemporaryDirectory() as tmpdir:
        out_video = Path(tmpdir) / "stream_output.mp4"
        with monkeypatch.context() as m:
            m.setattr("google.genai.Client", lambda api_key: mock_client)
            res = generate_veo_broll(
                prompt="Water droplet falling in ultra slow motion",
                output_path=out_video,
                dry_run=False,
                force=True,
                verbose=False,
            )

        assert res["cached"] is False
        assert out_video.exists()
        assert out_video.read_bytes() == fake_video_bytes
        mock_client.files.download.assert_called_once_with(file=mock_video)


def test_mock_live_generation_rai_filter_error(monkeypatch):
    from unittest.mock import MagicMock
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_API_KEY", "mock_key_123")

    mock_response = SimpleNamespace(
        rai_media_filtered_count=1,
        rai_media_filtered_reasons=["PROFANITY_VIOLATION"],
        generated_videos=[],
    )
    mock_operation = SimpleNamespace(
        name="operations/mock_rai_op",
        done=True,
        error=None,
        response=mock_response,
        result=mock_response,
    )

    mock_client = MagicMock()
    mock_client._api_client.vertexai = False
    mock_client.models.generate_videos.return_value = mock_operation

    with monkeypatch.context() as m:
        m.setattr("google.genai.Client", lambda api_key: mock_client)
        with pytest.raises(RuntimeError, match="filtered by Responsible AI"):
            generate_veo_broll(
                prompt="filtered prompt",
                dry_run=False,
                force=True,
                verbose=False,
            )


def test_mock_live_generation_operation_error(monkeypatch):
    from unittest.mock import MagicMock
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_API_KEY", "mock_key_123")

    mock_operation = SimpleNamespace(
        name="operations/mock_failed_op",
        done=True,
        error="Resource exhausted (quota limit)",
        response=None,
        result=None,
    )

    mock_client = MagicMock()
    mock_client._api_client.vertexai = False
    mock_client.models.generate_videos.return_value = mock_operation

    with monkeypatch.context() as m:
        m.setattr("google.genai.Client", lambda api_key: mock_client)
        with pytest.raises(RuntimeError, match="generation operation failed"):
            generate_veo_broll(
                prompt="failed prompt",
                dry_run=False,
                force=True,
                verbose=False,
            )

