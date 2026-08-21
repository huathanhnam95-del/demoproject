from __future__ import annotations

import argparse
import json
from pathlib import Path

from .contracts import validate_manifest, validate_pack
from .pipeline import OllamaClient, run_batch
from .sources import load_collocation_allowlist


def _parse_ids(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    return [part.strip() for part in raw.split(",") if part.strip()]


def validate_output(output_root: Path) -> dict[str, int]:
    manifest = validate_manifest(json.loads((output_root / "manifest.json").read_text(encoding="utf-8")))
    checked = 0
    root = next((parent for parent in [output_root, *output_root.parents] if (parent / "public/database/The_Academic_Collocation_List.xlsx").exists()), Path.cwd())
    try:
        collocations = load_collocation_allowlist(root)
    except Exception:
        collocations = None
    for entry in manifest["questions"].values():
        filename = Path(entry["url"]).name
        pack = json.loads((output_root / "packs" / filename).read_text(encoding="utf-8"))
        validate_pack(pack, collocations)
        checked += 1
    return {"manifestEntries": len(manifest["questions"]), "packsChecked": checked}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate and audit PTE Write Essay Guided Support packs.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output-root", type=Path, default=None)
    parser.add_argument("--ids", help="comma-separated question IDs; omit for the full source set")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument("--timeout-s", type=int, default=180)
    parser.add_argument("--template-only", action="store_true", help="deterministic dry-run mode; not a production audit")
    parser.add_argument("--resume", action="store_true", help="resume an existing sidecar, skipping already published questions")
    parser.add_argument("--quarantine-only", action="store_true", help="rerun only questions currently marked QUARANTINED")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    output_root = args.output_root or (args.root / "public" / "database" / "Write Essay" / "support" / "v1")
    if args.validate_only:
        print(json.dumps(validate_output(output_root), indent=2))
        return 0
    client = None if args.template_only else OllamaClient(args.ollama_url, args.timeout_s)
    report = run_batch(
        args.root,
        output_root,
        question_ids=_parse_ids(args.ids),
        template_only=args.template_only,
        client=client,
        resume=args.resume,
        quarantine_only=args.quarantine_only,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not report["generationErrorIds"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
