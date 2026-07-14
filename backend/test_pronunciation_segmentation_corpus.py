"""Unit tests for the pronunciation segmentation corpus manifest.

Validates the manifest against the JSON Schema and checks business rules
including unique sample IDs, valid SHA-256 hashes, and mandatory word coverage.

Run with:
    python -m unittest backend.test_pronunciation_segmentation_corpus -v
"""

import json
import re
import unittest
from pathlib import Path

try:
    import jsonschema
except ImportError:
    jsonschema = None

# Paths relative to the repository root (tests run from repo root).
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "pronunciation-segmentation"
MANIFEST_PATH = FIXTURES_DIR / "manifest.json"
SCHEMA_PATH = FIXTURES_DIR / "manifest.schema.json"

SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")

MANDATORY_WORDS = {"busy", "photograph", "photography", "banana", "camera", "university"}


class TestPronunciationSegmentationCorpus(unittest.TestCase):
    """Tests for the pronunciation segmentation corpus manifest."""

    @classmethod
    def setUpClass(cls):
        """Load manifest and schema once for all tests."""
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            cls.manifest = json.load(f)

        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            cls.schema = json.load(f)

        cls.entries = cls.manifest.get("entries", [])

    def test_manifest_validates_against_schema(self):
        """The manifest must conform to the JSON Schema."""
        if jsonschema is None:
            self.skipTest("jsonschema package not installed")

        try:
            jsonschema.validate(instance=self.manifest, schema=self.schema)
        except jsonschema.ValidationError as e:
            self.fail(f"Manifest failed schema validation: {e.message}")

    def test_unique_sample_ids(self):
        """All sample IDs must be unique."""
        if not self.entries:
            self.skipTest("No entries in manifest — skipping uniqueness check")

        sample_ids = [e["sampleId"] for e in self.entries]
        duplicates = [sid for sid in sample_ids if sample_ids.count(sid) > 1]
        self.assertEqual(
            len(set(duplicates)),
            0,
            f"Duplicate sample IDs found: {set(duplicates)}",
        )

    def test_source_hashes_are_valid_sha256(self):
        """All sourceHash values must be valid 64-character hex SHA-256 strings."""
        if not self.entries:
            self.skipTest("No entries in manifest — skipping hash check")

        for entry in self.entries:
            source_hash = entry["sourceHash"]
            self.assertRegex(
                source_hash,
                SHA256_PATTERN,
                f"Invalid SHA-256 hash for sample {entry['sampleId']}: {source_hash}",
            )

    def test_mandatory_word_coverage(self):
        """The corpus must contain at least one sample for each mandatory word."""
        if not self.entries:
            self.skipTest("No entries in manifest — skipping mandatory word check")

        covered_words = {e["targetWord"].lower() for e in self.entries}
        missing = MANDATORY_WORDS - covered_words
        self.assertEqual(
            len(missing),
            0,
            f"Missing mandatory words in corpus: {missing}",
        )


if __name__ == "__main__":
    unittest.main()
