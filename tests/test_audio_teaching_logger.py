import pytest
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from scripts.audio_teaching_logger.pipeline_local_consensus import (
    clean_response,
    calculate_consensus_rate,
    string_similarity,
    cosine_similarity,
    get_embeddings,
    chunk_transcript,
    merge_chunk_drafts,
    query_ollama
)
from scripts.audio_teaching_logger.pipeline_gemini import (
    format_markdown_report,
    _sanitize_mermaid_text,
    generate_mermaid_fallback,
    generate_mermaid_diagrams
)
from scripts.audio_teaching_logger.ab_evaluator import calculate_overlap_score, evaluate_ab_results
from scripts.audio_teaching_logger.pipeline_local_stt import parse_transcript_file


def test_clean_response_think_tags():
    raw_deepseek = """
<think>
Let's analyze the teaching session carefully.
The teacher explained the /th/ sound.
</think>
```json
{
  "title": "Teaching Session Analysis",
  "what_taught": []
}
```
"""
    cleaned = clean_response(raw_deepseek)
    data = json.loads(cleaned)
    assert data["title"] == "Teaching Session Analysis"


def test_string_similarity():
    sim = string_similarity("Pronunciation error on word think", "pronunciation mistake on word think")
    assert sim > 0.6
    assert string_similarity("", "abc") == 0.0


def test_calculate_consensus_rate_majority():
    # Mock 3 model drafts
    drafts = {
        "qwen": {
            "what_taught": [
                {"category": "Pronunciation", "topic": "Theta /θ/ sound", "details": "Tongue placement between teeth", "examples": ["think", "thank"]}
            ],
            "student_problems": [
                {"problem_id": "P1", "error_type": "Pronunciation", "description": "Substituted /s/ for /θ/", "student_utterance": "I sink so", "severity": "High"}
            ],
            "teacher_solutions": [
                {"targeted_problem_id": "P1", "method": "Drill", "explanation": "Bite tongue lightly", "drill_guidance": "think-sink pairs"}
            ],
            "action_items": {
                "for_teacher": ["Check /θ/ sound next warmup"],
                "for_student": ["Practice think vs sink 10 times"]
            }
        },
        "deepseek": {
            "what_taught": [
                {"category": "Pronunciation", "topic": "Theta /θ/ sound vs /s/", "details": "Interdental articulation", "examples": ["think", "three"]}
            ],
            "student_problems": [
                {"problem_id": "P1", "error_type": "Phonetics", "description": "Student pronounced sink instead of think", "student_utterance": "I sink so", "severity": "High"}
            ],
            "teacher_solutions": [
                {"targeted_problem_id": "P1", "method": "Mirror drill", "explanation": "Place tongue tip between teeth", "drill_guidance": "Minimal pairs drill"}
            ],
            "action_items": {
                "for_teacher": ["Check /θ/ sound next warmup"],
                "for_student": ["Practice 5 sentences"]
            }
        },
        "gemma": {
            "what_taught": [
                {"category": "Grammar", "topic": "Past Simple Tense", "details": "Irregular verbs", "examples": ["went", "bought"]}
            ],
            "student_problems": [
                {"problem_id": "P1", "error_type": "Grammar", "description": "Forgot -ed ending", "student_utterance": "He go yesterday", "severity": "Low"}
            ],
            "teacher_solutions": [
                {"targeted_problem_id": "P1", "method": "Explanation", "explanation": "Use past tense form", "drill_guidance": "Verb table review"}
            ],
            "action_items": {
                "for_teacher": ["Review past simple tense"],
                "for_student": ["Grammar worksheet"]
            }
        }
    }

    consensus = calculate_consensus_rate(drafts)
    # Theta sound was identified by Qwen and DeepSeek (2/3 majority)
    assert len(consensus["what_taught"]) >= 1
    # Check that at least one item got APPROVED_CONSENSUS (2/3)
    approved_items = [it for it in consensus["what_taught"] if it["status"] == "APPROVED_CONSENSUS"]
    assert len(approved_items) >= 1
    assert "qwen" in approved_items[0]["supporting_models"]
    assert "deepseek" in approved_items[0]["supporting_models"]


def test_format_markdown_report_all_5_sections():
    sample_data = {
        "title": "Bilingual Session 12",
        "lesson_summary": "PTE Read Aloud and Speaking practice",
        "what_taught": [
            {"category": "Speaking", "topic": "Chunking", "details": "3-4 word phrase groups", "examples": ["in the morning"]}
        ],
        "student_problems": [
            {"problem_id": "P1", "error_type": "Fluency", "description": "Choppy rhythm", "student_utterance": "In... the... morning", "severity": "Medium"}
        ],
        "teacher_solutions": [
            {"targeted_problem_id": "P1", "method": "Breath group modeling", "explanation": "One breath per chunk", "drill_guidance": "Read with metronome"}
        ],
        "student_response": [
            {"targeted_problem_id": "P1", "reaction": "Tried twice", "comprehension_status": "Mastered", "evidence": "Score went up to 75"}
        ],
        "action_items": {
            "for_teacher": ["Test Read Aloud #4 next class"],
            "for_student": ["Read 3 passages daily"]
        }
    }

    md = format_markdown_report(sample_data, "Test Source")
    # The current report format uses updated section headers
    assert "Core Concepts Taught" in md or "What Was Taught" in md
    assert "Student Blocker Radar" in md or "Pain Points" in md
    assert "Teacher Fix" in md or "Interventions" in md
    assert "Action Plan" in md or "Action Items" in md
    assert "Teacher" in md
    assert "Student" in md


def test_ab_evaluator_metrics():
    res_a = {
        "elapsed_seconds": 12.5,
        "data": {
            "what_taught": [{"topic": "Chunking"}],
            "student_problems": [{"description": "Choppy"}],
            "teacher_solutions": [{"method": "Breath groups"}],
            "student_response": [{"reaction": "Improved"}],
            "action_items": {"for_teacher": ["Review"], "for_student": ["Practice"]}
        }
    }
    res_b = {
        "elapsed_seconds": 45.2,
        "final_data": {
            "what_taught": [{"topic": "Chunking techniques"}],
            "student_problems": [{"description": "Choppy reading pace"}],
            "teacher_solutions": [{"method": "Breath groups"}],
            "student_response": [{"reaction": "Improved"}],
            "action_items": {"for_teacher": ["Review"], "for_student": ["Practice"]}
        }
    }

    eval_out = evaluate_ab_results(res_a, res_b, audio_duration_seconds=3600)
    assert eval_out["metrics"]["gemini_time_seconds"] == 12.5
    assert eval_out["metrics"]["local_time_seconds"] == 45.2
    assert "A/B Benchmark Evaluation" in eval_out["markdown_comparison"]


def test_parse_transcript_file(tmp_path):
    txt_file = tmp_path / "test_transcript.txt"
    txt_file.write_text("Teacher: Hello\nStudent: Xin chào", encoding="utf-8")
    assert "Xin chào" in parse_transcript_file(str(txt_file))


def test_chunk_transcript_time_based():
    """Verify that a transcript with timestamps is split at correct time boundaries."""
    lines = []
    # Generate 30 lines spanning 0–29 minutes (one line per minute)
    for i in range(30):
        lines.append(f"[ {i}m0s0ms ] Speaker: Line at minute {i}")
    transcript = "\n".join(lines)

    chunks = chunk_transcript(transcript, chunk_minutes=10, overlap_lines=2)

    # Should produce 3 chunks: 0-9, ~8-19, ~18-29
    assert len(chunks) >= 3
    # Each chunk should have an id and time_range
    assert chunks[0]["chunk_id"] == 1
    assert chunks[1]["chunk_id"] == 2
    # Overlap: last 2 lines of chunk 1 should appear in chunk 2
    chunk1_lines = chunks[0]["text"].splitlines()
    chunk2_lines = chunks[1]["text"].splitlines()
    assert chunk1_lines[-1] in chunk2_lines or chunk1_lines[-2] in chunk2_lines


def test_chunk_transcript_no_timestamps():
    """Verify fallback to line-count splitting when no timestamps exist."""
    lines = [f"Speaker: Line {i}" for i in range(200)]
    transcript = "\n".join(lines)

    chunks = chunk_transcript(transcript, chunk_minutes=10, overlap_lines=2)

    # Should produce chunks of ~80 lines each
    assert len(chunks) >= 2
    assert chunks[0]["line_count"] <= 80


def test_merge_chunk_drafts():
    """Verify that per-chunk drafts are merged with renumbered problem IDs."""
    chunk1 = {
        "lesson_summary": "Essay corrections",
        "what_taught": [{"category": "Grammar", "topic": "Redundancy", "details": "Remove of it", "examples": ["of it"]}],
        "student_problems": [{"problem_id": "P1", "error_type": "Grammar", "description": "Redundant phrasing", "student_utterance": "one of the causes of it", "severity": "Medium"}],
        "teacher_solutions": [{"targeted_problem_id": "P1", "method": "Correction", "explanation": "Remove of it", "drill_guidance": "Rewrite"}],
        "student_response": [{"targeted_problem_id": "P1", "reaction": "Agreed", "comprehension_status": "Mastered", "evidence": "Said OK"}],
        "action_items": {"for_teacher": ["Check redundancy"], "for_student": ["Practice concise writing"]}
    }
    chunk2 = {
        "lesson_summary": "Lexical cohesion",
        "what_taught": [{"category": "Strategy", "topic": "Cohesion", "details": "Use synonyms", "examples": ["repetition"]}],
        "student_problems": [{"problem_id": "P1", "error_type": "Vocabulary", "description": "Open spaces misuse", "student_utterance": "open spaces disappear", "severity": "High"}],
        "teacher_solutions": [{"targeted_problem_id": "P1", "method": "Correction", "explanation": "Use no room", "drill_guidance": "Replace"}],
        "student_response": [{"targeted_problem_id": "P1", "reaction": "Understood", "comprehension_status": "Mastered", "evidence": "Said oh OK"}],
        "action_items": {"for_teacher": ["Check redundancy"], "for_student": ["Review vocabulary"]}
    }

    merged = merge_chunk_drafts([chunk1, chunk2])

    assert merged is not None
    # Should have 2 what_taught items
    assert len(merged["what_taught"]) == 2
    # Should have 2 student_problems with renumbered IDs
    assert len(merged["student_problems"]) == 2
    assert merged["student_problems"][0]["problem_id"] == "P1"
    assert merged["student_problems"][1]["problem_id"] == "P2"
    # Solutions should reference the renumbered IDs
    assert merged["teacher_solutions"][1]["targeted_problem_id"] == "P2"
    # Action items: "Check redundancy" appears in both — should be deduplicated
    assert len(merged["action_items"]["for_teacher"]) == 1  # deduplicated
    assert len(merged["action_items"]["for_student"]) == 2  # different items


def test_cosine_similarity():
    """Verify cosine similarity math with known vectors."""
    # Identical vectors = 1.0
    assert abs(cosine_similarity([1, 0, 0], [1, 0, 0]) - 1.0) < 0.01
    # Orthogonal vectors = 0.0
    assert abs(cosine_similarity([1, 0, 0], [0, 1, 0]) - 0.0) < 0.01
    # Opposite vectors = -1.0
    assert abs(cosine_similarity([1, 0], [-1, 0]) - (-1.0)) < 0.01
    # Similar vectors
    sim = cosine_similarity([1, 2, 3], [1, 2, 4])
    assert sim > 0.95
    # Empty vectors
    assert cosine_similarity([], [1, 2, 3]) == 0.0


def test_embedding_consensus_semantic_match():
    """Verify that semantically similar items cluster with embedding-based matching."""
    # Create mock embeddings where items 0 and 3 are similar (both about redundancy)
    # and items 1 and 4 are similar (both about vocabulary)
    mock_embeddings = [
        [1.0, 0.0, 0.0],  # qwen: redundancy
        [0.0, 1.0, 0.0],  # qwen: vocabulary
        [0.0, 0.0, 1.0],  # qwen: grammar (unique)
        [0.95, 0.1, 0.0], # deepseek: redundancy (similar to qwen)
        [0.1, 0.9, 0.1],  # deepseek: vocabulary (similar to qwen)
    ]

    drafts = {
        "qwen": {
            "what_taught": [
                {"category": "Grammar", "topic": "Redundancy", "key_rule": "Remove unnecessary repetition"},
                {"category": "Vocabulary", "topic": "Academic words", "key_rule": "Use formal register"},
                {"category": "Grammar", "topic": "Articles", "key_rule": "Use the/a correctly"}
            ],
        },
        "deepseek": {
            "what_taught": [
                {"category": "Writing", "topic": "Eliminating redundant phrases", "key_rule": "Cut wordy expressions"},
                {"category": "Lexical", "topic": "Academic vocabulary selection", "key_rule": "Choose appropriate academic terms"},
            ],
        },
    }

    with patch("scripts.audio_teaching_logger.pipeline_local_consensus.get_embeddings", return_value=mock_embeddings):
        consensus = calculate_consensus_rate(drafts)

    # With embeddings, redundancy items should cluster (2/2 majority)
    approved = [it for it in consensus["what_taught"] if it["status"] == "APPROVED_CONSENSUS"]
    assert len(approved) >= 2, f"Expected ≥2 approved items, got {len(approved)}: {approved}"
    # Articles should be 1/2 single model
    single = [it for it in consensus["what_taught"] if it["vote_count"] == 1]
    assert len(single) >= 1


def test_sanitize_mermaid_text():
    """Verify that Mermaid problematic characters, newlines, quotes, and brackets are safely stripped."""
    assert _sanitize_mermaid_text(None) == "N/A"
    assert _sanitize_mermaid_text("") == "N/A"
    assert _sanitize_mermaid_text(12345) == "12345"
    dirty = "Topic: (PEEL) [Hypernym & Hyponym] {word} #1 <tag> `code` *star* |pipe| \"quote\" 'single'\nsecond line"
    clean = _sanitize_mermaid_text(dirty, max_len=100)
    assert "(" not in clean
    assert ")" not in clean
    assert "[" not in clean
    assert "]" not in clean
    assert "{" not in clean
    assert "}" not in clean
    assert "#" not in clean
    assert "&" not in clean
    assert ";" not in clean
    assert "<" not in clean
    assert ">" not in clean
    assert "`" not in clean
    assert "*" not in clean
    assert "|" not in clean
    assert '"' not in clean
    assert "'" not in clean
    assert "\n" not in clean
    assert "PEEL Hypernym Hyponym word 1 tag code star pipe quote single second line" in clean

    # Truncation test
    long_text = "A" * 100
    truncated = _sanitize_mermaid_text(long_text, max_len=20)
    assert len(truncated) <= 20
    assert truncated.endswith("...")


def test_generate_mermaid_fallback_structure():
    """Verify that fallback mindmap and flowchart produce valid Mermaid syntax."""
    sample_data = {
        "title": "Teaching Session Analysis",
        "lesson_summary": {
            "focus_skill": "Writing",
            "core_topic": "Academic Writing: Lexical Cohesion & PEEL",
            "quick_recap_60s": "Tập trung hoàn thiện liên kết câu.",
            "student_readiness_level": "Đã Nắm Vững"
        },
        "what_taught": [
            {
                "category": "Tính Liên Kết",
                "topic": "Sự Lặp Từ Có Chủ Đích",
                "key_rule": "Giữ từ khóa cốt lõi",
                "examples": ["garden", "gardener"]
            }
        ],
        "student_problems_and_solutions": [
            {
                "problem_id": "P1",
                "severity": "🔴 Nghiêm trọng",
                "issue_summary": "Lỗi liên kết logic",
                "student_error": "commuters open spaces",
                "teacher_fix": "Sử dụng từ nối phù hợp",
                "student_outcome": "Đã Nắm Vững"
            }
        ],
        "next_lesson_briefing": {
            "warmup_quiz_questions": ["Phân biệt bucket list và wish list"],
            "teacher_followup_focus": ["Kiểm soát mạch PEEL"],
            "student_homework_checklist": ["Task 4: Điền từ"]
        }
    }

    result = generate_mermaid_fallback(sample_data)
    assert "mindmap" in result
    assert "flowchart" in result

    # Check mindmap
    mindmap = result["mindmap"]
    assert mindmap.startswith("mindmap")
    assert "root((" in mindmap
    assert "Kien Thuc Da Day" in mindmap
    assert "Loi Hoc Vien" in mindmap
    assert "Buoi Sau" in mindmap

    # Check flowchart
    flowchart = result["flowchart"]
    assert flowchart.startswith("graph TD")
    assert "START[" in flowchart
    assert "classDef" in flowchart


def test_generate_mermaid_fallback_empty_data():
    """Verify that fallback works gracefully on empty or malformed dicts."""
    res_empty = generate_mermaid_fallback({})
    assert res_empty["mindmap"].startswith("mindmap")
    assert res_empty["flowchart"].startswith("graph TD")

    res_none = generate_mermaid_fallback(None)
    assert res_none["mindmap"].startswith("mindmap")
    assert res_none["flowchart"].startswith("graph TD")


def test_generate_mermaid_diagrams_unified_llm():
    """Verify single-pass unified LLM generation with mock response."""
    sample_data = {
        "lesson_summary": {"core_topic": "IELTS Speaking Part 3"},
        "what_taught": [{"category": "Fluency", "topic": "Chunking"}],
        "student_problems_and_solutions": [],
        "next_lesson_briefing": {}
    }

    mock_llm_json = json.dumps({
        "mindmap": "mindmap\n  root((IELTS Speaking Part 3))\n    🎯 Topic\n      Chunking",
        "flowchart": "graph TD\n  START[IELTS Speaking] --> T1[Chunking]\n  classDef action fill:#74c0fc;"
    })

    class MockResponse:
        text = mock_llm_json

    class MockModels:
        def generate_content(self, model, contents, config=None):
            return MockResponse()

    class MockClient:
        def __init__(self, api_key=None):
            self.models = MockModels()

    with patch("google.genai.Client", side_effect=MockClient):
        diagrams = generate_mermaid_diagrams(sample_data, api_key="fake-key", use_llm=True)

    assert "mindmap" in diagrams
    assert "flowchart" in diagrams
    assert diagrams["mindmap"].startswith("mindmap")
    assert diagrams["flowchart"].startswith("graph TD")


def test_generate_mermaid_diagrams_llm_failure_fallback():
    """Verify that an LLM failure automatically returns fallback diagrams without throwing."""
    sample_data = {
        "lesson_summary": {"core_topic": "Pronunciation Drill"},
        "what_taught": [{"category": "Phonetics", "topic": "Vowel length"}],
        "student_problems_and_solutions": [],
        "next_lesson_briefing": {}
    }

    class FailingClient:
        def __init__(self, api_key=None):
            pass

        @property
        def models(self):
            raise RuntimeError("503 Service Unavailable")

    with patch("google.genai.Client", side_effect=FailingClient):
        diagrams = generate_mermaid_diagrams(sample_data, api_key="fake-key", use_llm=True)

    assert "mindmap" in diagrams
    assert "flowchart" in diagrams
    assert diagrams["mindmap"].startswith("mindmap")
    assert diagrams["flowchart"].startswith("graph TD")


def test_query_ollama_qwen_chat_payload_and_num_ctx():
    """Verify Qwen3 routes to /api/chat, uses num_ctx=16384, and sets top-level think=False."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "model": "qwen3:14b",
        "message": {
            "role": "assistant",
            "content": "```json\n{\"what_taught\": [{\"topic\": \"PEEL structure\"}], \"student_problems\": [], \"teacher_solutions\": []}\n```"
        },
        "done": True
    }

    with patch("scripts.audio_teaching_logger.pipeline_local_consensus.requests.post", return_value=mock_resp) as mock_post:
        result = query_ollama("qwen3:14b", "Analyze teaching session", temperature=0.2, max_tokens=8192, force_json=True)

    assert result["success"] is True
    assert result["model"] == "qwen3:14b"
    assert result["parsed"]["what_taught"][0]["topic"] == "PEEL structure"

    mock_post.assert_called_once()
    call_url = mock_post.call_args[0][0]
    call_payload = mock_post.call_args[1]["json"]

    # Endpoint must be /api/chat
    assert call_url.endswith("/api/chat")

    # Payload must have messages (chat format)
    assert "messages" in call_payload
    assert isinstance(call_payload["messages"], list)
    assert call_payload["messages"][0]["role"] == "user"

    # num_ctx must be recalibrated to 16384 (not 32768)
    assert call_payload["options"]["num_ctx"] == 16384

    # Top-level think: False for Qwen3 (non-reasoning model where JSON output is expected)
    assert "think" in call_payload
    assert call_payload["think"] is False

    # think must NOT be inside options
    assert "think" not in call_payload["options"]


def test_query_ollama_gemma_chat_payload_and_think_false():
    """Verify Gemma4 routes to /api/chat, uses num_ctx=16384, and sets top-level think=False."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "model": "gemma4:12b",
        "message": {
            "role": "assistant",
            "content": "```json\n{\"what_taught\": [], \"student_problems\": [], \"teacher_solutions\": []}\n```"
        },
        "done": True
    }

    with patch("scripts.audio_teaching_logger.pipeline_local_consensus.requests.post", return_value=mock_resp) as mock_post:
        result = query_ollama("gemma4:12b", "Analyze teaching session", force_json=True)

    assert result["success"] is True
    call_payload = mock_post.call_args[1]["json"]

    # Top-level think: False for Gemma4
    assert "think" in call_payload
    assert call_payload["think"] is False
    assert "think" not in call_payload["options"]

    # num_ctx must be 16384
    assert call_payload["options"]["num_ctx"] == 16384


def test_query_ollama_deepseek_r1_retains_thinking():
    """Verify DeepSeek-R1 reasoning model does NOT have think: False injected."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "model": "deepseek-r1:14b",
        "message": {
            "role": "assistant",
            "content": "<think>\nStep-by-step reasoning\n</think>\n```json\n{\"what_taught\": [], \"student_problems\": [], \"teacher_solutions\": []}\n```"
        },
        "done": True
    }

    with patch("scripts.audio_teaching_logger.pipeline_local_consensus.requests.post", return_value=mock_resp) as mock_post:
        result = query_ollama("deepseek-r1:14b", "Analyze teaching session", force_json=True)

    assert result["success"] is True
    call_payload = mock_post.call_args[1]["json"]

    # DeepSeek-R1 is a reasoning model: think: False should NOT be present
    assert call_payload.get("think") is not False
    # Format json is used for DeepSeek
    assert call_payload.get("format") == "json"
    # num_ctx must be 16384
    assert call_payload["options"]["num_ctx"] == 16384


def test_query_ollama_response_fallback_and_repair():
    """Verify query_ollama supports raw response fallback and soft JSON bracket repair."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    # Returns legacy generate endpoint format with truncated JSON
    mock_resp.json.return_value = {
        "response": '{"what_taught": [], "student_problems": [], "teacher_solutions": []'
    }

    with patch("scripts.audio_teaching_logger.pipeline_local_consensus.requests.post", return_value=mock_resp):
        result = query_ollama("qwen3:14b", "Analyze chunk", force_json=True)

    assert result["success"] is True
    assert isinstance(result["parsed"], dict)
    assert "what_taught" in result["parsed"]


def test_query_ollama_http_error_handling():
    """Verify query_ollama handles HTTP error status cleanly without crashing."""
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "Internal Server Error"

    with patch("scripts.audio_teaching_logger.pipeline_local_consensus.requests.post", return_value=mock_resp):
        result = query_ollama("qwen3:14b", "Analyze chunk")

    assert result["success"] is False
    assert "HTTP 500" in result["error"]


def test_query_ollama_trailing_slash_url_sanitization():
    """Verify that trailing slashes on OLLAMA_URL do not create duplicate paths like /api/generate/api/chat."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "message": {"content": '{"what_taught": []}'}
    }

    test_urls = [
        ("http://localhost:11434/api/generate/", "http://localhost:11434/api/chat"),
        ("http://localhost:11434/api/chat/", "http://localhost:11434/api/chat"),
        ("http://localhost:11434/", "http://localhost:11434/api/chat"),
        ("http://localhost:11434", "http://localhost:11434/api/chat"),
    ]

    for input_url, expected_url in test_urls:
        with patch("scripts.audio_teaching_logger.pipeline_local_consensus.OLLAMA_URL", input_url):
            with patch("scripts.audio_teaching_logger.pipeline_local_consensus.requests.post", return_value=mock_resp) as mock_post:
                query_ollama("qwen3:14b", "test prompt")
                called_url = mock_post.call_args[0][0]
                assert called_url == expected_url, f"Failed for input_url '{input_url}': got '{called_url}', expected '{expected_url}'"


def test_query_ollama_qwq_reasoning_model_retains_thinking():
    """Verify QwQ reasoning model is recognized as reasoning and think: False is NOT injected."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "message": {"content": '{"what_taught": []}'}
    }

    with patch("scripts.audio_teaching_logger.pipeline_local_consensus.requests.post", return_value=mock_resp) as mock_post:
        result = query_ollama("qwq:32b", "test prompt", force_json=True)

    assert result["success"] is True
    call_payload = mock_post.call_args[1]["json"]
    assert "think" not in call_payload or call_payload.get("think") is not False


def test_config_embed_url_derivation():
    """Verify OLLAMA_EMBED_URL is derived cleanly from OLLAMA_URL without malformed paths."""
    from scripts.audio_teaching_logger.config import OLLAMA_EMBED_URL
    assert OLLAMA_EMBED_URL.endswith("/api/embed")
    assert "/api/chat" not in OLLAMA_EMBED_URL
    assert "/api/generate" not in OLLAMA_EMBED_URL


