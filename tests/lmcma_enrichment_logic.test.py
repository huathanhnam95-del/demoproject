import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "public" / "database" / "LMCMA" / "enrich_lmcma.py"


def load_module():
    spec = importlib.util.spec_from_file_location("enrich_lmcma", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_negative_question_prompt_labels_and_html_cleanup():
    module = load_module()
    captured = {}

    class FakeResponse:
        status_code = 200
        text = "ok"

        def json(self):
            return {"response": "```html\n<html><body><p>clean</p></body></html>\n```"}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["payload"] = json
        captured["timeout"] = timeout
        return FakeResponse()

    module.requests.post = fake_post
    parsed = module.parse_lmcma_content(
        """---
Which of the following statements are false?
---
[x] Bad guys are more likely to borrow money from others.
[] Nice people like to help others, even to their own detriment."""
    )

    assert module.is_negative_question(parsed["question"])
    explanation = module.generate_explanation(parsed, "Nice people may loan money when they cannot afford to.", base_url="http://test", model="fake-model")

    assert explanation == "<p>clean</p>"
    assert captured["url"] == "http://test/api/generate"
    assert captured["payload"]["model"] == "fake-model"
    prompt = captured["payload"]["prompt"]
    assert "negative stem: selected answers must be false, contradicted, or unsupported" in prompt
    assert "Bad guys are more likely to borrow money from others. (Selected answer: this statement should be false, contradicted, or unsupported)" in prompt
    assert "Nice people like to help others, even to their own detriment. (Not selected: this statement should be true or supported)" in prompt


if __name__ == "__main__":
    test_negative_question_prompt_labels_and_html_cleanup()
    print("LMCMA enrichment logic guardrails passed.")
