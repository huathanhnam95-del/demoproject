import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "generate_smw_explanations.py"

spec = importlib.util.spec_from_file_location("generate_smw_explanations", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_sanitize_explanation_html_strips_attributes_and_unsupported_tags():
    dirty = (
        '<h2 style="color:red">Heading</h2>'
        '<p onclick="alert(1)">Use <strong class="accent">context</strong> '
        '<span style="display:none">carefully</span>.</p>'
        '<h5 id="small">Small heading</h5>'
        '<code>token</code>'
    )

    clean = module.sanitize_explanation_html(dirty)

    assert "<h2" not in clean
    assert "<h5" not in clean
    assert "<span" not in clean
    assert "<code" not in clean
    assert "style=" not in clean
    assert "onclick=" not in clean
    assert "class=" not in clean
    assert "<p>Use <strong>context</strong> carefully.</p>" in clean
    assert "Heading" in clean
    assert "Small heading" in clean
    assert "token" in clean


def test_sanitize_explanation_html_removes_markdown_fences():
    clean = module.sanitize_explanation_html("```html\n<h3 style=\"color:blue\">Analysis</h3>\n```")

    assert clean == "<h3>Analysis</h3>"


if __name__ == "__main__":
    test_sanitize_explanation_html_strips_attributes_and_unsupported_tags()
    test_sanitize_explanation_html_removes_markdown_fences()
    print("SMW explanation sanitizer tests passed.")
