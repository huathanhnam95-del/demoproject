import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "public" / "database" / "RMCSA" / "enrich_rmcsa.py"

spec = importlib.util.spec_from_file_location("enrich_rmcsa", MODULE_PATH)
enrich_rmcsa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrich_rmcsa)


def test_parse_rmcsa_content_matches_runtime_answer_shape():
    answer = (
        "A passage with a separator-like phrase --- inside the prose.\r\n"
        "---\r\n"
        "Which option is supported?\r\n"
        "---\r\n"
        "[] Unsupported distractor\r\n"
        "[X] Supported answer\r\n"
        "[] Another distractor with --- punctuation\r\n"
    )

    parsed = enrich_rmcsa.parse_rmcsa_content(answer)

    assert parsed["passage"] == "A passage with a separator-like phrase --- inside the prose."
    assert parsed["question"] == "Which option is supported?"
    assert parsed["choices"] == [
        {"text": "Unsupported distractor", "is_correct": False},
        {"text": "Supported answer", "is_correct": True},
        {"text": "Another distractor with --- punctuation", "is_correct": False},
    ]


if __name__ == "__main__":
    test_parse_rmcsa_content_matches_runtime_answer_shape()
