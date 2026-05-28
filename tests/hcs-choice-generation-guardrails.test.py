import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "generate_hcs_choices.py"


def load_module():
    spec = importlib.util.spec_from_file_location("generate_hcs_choices", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_raises_value_error(callback, expected_message):
    try:
        callback()
    except ValueError as error:
        assert expected_message in str(error), f"Expected {expected_message!r}, got {str(error)!r}"
        return
    raise AssertionError(f"Expected ValueError containing {expected_message!r}")


def main():
    module = load_module()
    valid_choices = [
        {"text": "This is the correct summary.", "isCorrect": True},
        {"text": "This distractor is too broad.", "isCorrect": False},
        {"text": "This distractor is too narrow.", "isCorrect": False},
        {"text": "This distractor changes a fact.", "isCorrect": False},
    ]

    formatted = module.format_answer_column("Click on the paragraph that best relates to the recording.", valid_choices)
    assert formatted.count("[x]") == 1
    assert formatted.count("[]") == 3

    assert_raises_value_error(
        lambda: module.format_answer_column("Prompt", valid_choices[:3]),
        "exactly 4 choices",
    )
    assert_raises_value_error(
        lambda: module.format_answer_column(
            "Prompt",
            [
                {"text": "Correct one.", "isCorrect": True},
                {"text": "Correct two.", "isCorrect": True},
                {"text": "Distractor one.", "isCorrect": False},
                {"text": "Distractor two.", "isCorrect": False},
            ],
        ),
        "exactly 1 correct",
    )
    assert_raises_value_error(
        lambda: module.format_answer_column(
            "Prompt",
            [
                {"text": "Correct one.", "isCorrect": True},
                {"text": "", "isCorrect": False},
                {"text": "Distractor one.", "isCorrect": False},
                {"text": "Distractor two.", "isCorrect": False},
            ],
        ),
        "non-empty text",
    )
    assert_raises_value_error(
        lambda: module.validate_hcs_payload({
            "question": "Click on the paragraph that best relates to the recording.",
            "choices": valid_choices,
            "explanation": "<p>The correct option is the first choice.</p>",
        }),
        "must not refer to choices by position",
    )


if __name__ == "__main__":
    main()
