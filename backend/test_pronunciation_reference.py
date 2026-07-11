import hashlib
import json
import os
import re
import unittest
import unicodedata

from backend.local_server.pronunciation_reference import (
    ALGORITHM_VERSION,
    DIALECT,
    SCHEMA_VERSION,
    build_pronunciation_reference,
    build_pronunciation_variant,
    stable_variant_id,
    validate_reference_invariants,
)


FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "tests",
    "fixtures",
    "pronunciation-reference",
)


def load_json(filename):
    with open(os.path.join(FIXTURE_DIR, filename), encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


class PronunciationReferenceContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = load_json("reference-v2.schema.json")
        cls.fixtures = load_json("edge-cases.json")

    def build_fixture_variant(self, fixture, **overrides):
        values = {
            "word": fixture["word"],
            "part_of_speech": fixture.get("partOfSpeech"),
            "definition": fixture.get("definition", "fixture definition"),
            "entry_id": fixture.get("entryId", fixture["word"]),
            "exact_match": fixture.get("exactMatch", True),
            "raw_ipa": fixture.get("rawIpa"),
            "headword": fixture.get("headword"),
            "audio_filename": fixture.get("audioFilename", f"{fixture['word']}.mp3"),
            "audio_url": fixture.get("audioUrl", f"https://audio.example/{fixture['word']}.mp3"),
        }
        values.update(overrides)
        return build_pronunciation_variant(**values)

    def test_schema_freezes_public_versions_and_conflict_codes(self):
        self.assertEqual(self.schema["properties"]["schemaVersion"]["const"], 9)
        self.assertEqual(
            self.schema["properties"]["algorithmVersion"]["const"],
            "pronunciation-reference-v2",
        )
        conflict_codes = set(
            self.schema["$defs"]["variant"]["properties"]["validation"]
            ["properties"]["conflicts"]["items"]["enum"]
        )
        self.assertEqual(
            conflict_codes,
            {
                "NON_EXACT_ENTRY",
                "COUNT_CONFLICT",
                "STRESS_CONFLICT",
                "MISSING_IPA",
                "ACOUSTIC_CONFLICT",
            },
        )

    def test_edge_case_variants_have_correct_count_display_and_stress(self):
        for fixture in self.fixtures["valid"]:
            with self.subTest(word=fixture["word"], pos=fixture.get("partOfSpeech")):
                variant = self.build_fixture_variant(fixture)
                self.assertEqual(variant["validation"]["status"], "valid", variant)
                self.assertEqual(variant["displayIpa"], fixture["expectedDisplayIpa"])
                self.assertEqual(variant["syllableCount"], fixture["expectedCount"])
                self.assertEqual(variant["primaryStress"], fixture["expectedPrimaryStress"])
                self.assertEqual(variant["secondaryStress"], fixture["expectedSecondaryStress"])
                self.assertEqual(len(variant["syllables"]), fixture["expectedCount"])
                self.assertEqual(
                    variant["validation"]["evidence"]["headwordCountExplicit"],
                    "·" in fixture["headword"],
                )

    def test_monosyllables_keep_internal_stress_without_display_mark(self):
        for fixture in self.fixtures["valid"]:
            if fixture["expectedCount"] != 1:
                continue
            with self.subTest(word=fixture["word"]):
                variant = self.build_fixture_variant(fixture)
                self.assertEqual(variant["primaryStress"], 0)
                self.assertNotIn("ˈ", variant["displayIpa"])
                self.assertEqual(variant["syllables"][0]["stress"], "primary")

    def test_diphthongs_rhotics_and_syllabic_consonants_are_single_nuclei(self):
        by_word = {
            (fixture["word"], fixture.get("partOfSpeech")): fixture
            for fixture in self.fixtures["valid"]
        }
        self.assertEqual(self.build_fixture_variant(by_word[("car", "noun")])["syllableCount"], 1)
        self.assertEqual(self.build_fixture_variant(by_word[("weird", "adjective")])["syllableCount"], 1)
        self.assertEqual(self.build_fixture_variant(by_word[("tunnel", "noun")])["syllableCount"], 2)
        self.assertTrue(
            self.build_fixture_variant(by_word[("tunnel", "noun")])["syllables"][1]
            ["syllabicConsonant"]
        )

    def test_explicit_breaks_can_support_implicit_syllabic_sonorants(self):
        by_word = {fixture["word"]: fixture for fixture in self.fixtures["valid"]}
        for word in ("button", "bottle", "rhythm"):
            with self.subTest(word=word):
                variant = self.build_fixture_variant(by_word[word])
                self.assertEqual(variant["validation"]["status"], "valid", variant)
                self.assertEqual(variant["syllableCount"], 2)
                self.assertTrue(variant["syllables"][1]["syllabicConsonant"])

    def test_mw_glides_and_tied_affricates_are_normalized_as_phonemes(self):
        by_word = {fixture["word"]: fixture for fixture in self.fixtures["valid"]}
        time = self.build_fixture_variant(by_word["time"])
        judge = self.build_fixture_variant(by_word["judge"])
        self.assertEqual(time["displayIpa"], "/taɪm/")
        self.assertEqual(time["syllableCount"], 1)
        self.assertEqual(judge["displayIpa"], "/dʒʌdʒ/")
        self.assertEqual(judge["syllableCount"], 1)

    def test_oxford_display_maps_phonemes_without_inventing_allophones(self):
        by_word = {fixture["word"]: fixture for fixture in self.fixtures["valid"]}
        right = self.build_fixture_variant(by_word["right"])
        water = self.build_fixture_variant(by_word["water"])
        self.assertEqual(right["displayIpa"], "/raɪt/")
        self.assertEqual(water["displayIpa"], "/ˈwɔɾər/")
        self.assertIn("ɾ", water["displayIpa"])

    def test_structured_syllables_own_stress_and_display_labels(self):
        by_word = {fixture["word"]: fixture for fixture in self.fixtures["valid"]}
        expire = self.build_fixture_variant(by_word["expire"])
        self.assertEqual(
            [(item["index"], item["ipa"], item["label"], item["stress"]) for item in expire["syllables"]],
            [
                (0, "ɪk", "ex", "unstressed"),
                (1, "spaɪr", "pire", "primary"),
            ],
        )
        fundamental = self.build_fixture_variant(by_word["fundamental"])
        self.assertEqual([item["stress"] for item in fundamental["syllables"]], [
            "secondary",
            "unstressed",
            "primary",
            "unstressed",
        ])

    def test_explicit_headword_break_resolves_hour_flower_ambiguity(self):
        fixtures = {fixture["word"]: fixture for fixture in self.fixtures["valid"]}
        hour = self.build_fixture_variant(fixtures["hour"])
        flower = self.build_fixture_variant(fixtures["flower"])
        self.assertEqual(hour["syllableCount"], 1)
        self.assertFalse(hour["validation"]["evidence"]["headwordCountExplicit"])
        self.assertEqual(flower["syllableCount"], 2)
        self.assertTrue(flower["validation"]["evidence"]["headwordCountExplicit"])
        self.assertEqual([part["label"] for part in flower["syllables"]], ["flow", "er"])

    def test_learners_star_breaks_are_not_authoritative_syllable_evidence(self):
        variant = build_pronunciation_variant(
            word="overseas",
            part_of_speech="adverb",
            definition="fixture",
            entry_id="overseas",
            exact_match=True,
            raw_ipa="ˌoʊvɚˈsiːz",
            headword="over*seas",
            audio_filename="overse02",
            audio_url="https://media.merriam-webster.com/overse02.mp3",
        )
        self.assertEqual(variant["syllableCount"], 3)
        self.assertEqual(variant["validation"]["status"], "valid")
        self.assertFalse(variant["validation"]["evidence"]["headwordCountExplicit"])
        self.assertIsNone(variant["validation"]["evidence"]["headwordCount"])

    def test_unicode_is_nfc_normalized_without_losing_diacritics(self):
        fixture = next(item for item in self.fixtures["valid"] if item["word"] == "cafe")
        self.assertNotEqual(fixture["rawIpa"], unicodedata.normalize("NFC", fixture["rawIpa"]))
        variant = self.build_fixture_variant(fixture)
        self.assertEqual(variant["rawIpa"], unicodedata.normalize("NFC", fixture["rawIpa"]))
        self.assertIn("é", variant["displayIpa"])

    def test_conflicts_fail_closed_with_stable_codes(self):
        for fixture in self.fixtures["conflicts"]:
            with self.subTest(word=fixture["word"]):
                variant = self.build_fixture_variant(fixture)
                self.assertEqual(variant["validation"]["status"], "conflict")
                self.assertTrue(set(fixture["expectedConflicts"]).issubset(variant["validation"]["conflicts"]))
                self.assertFalse(variant["capabilities"]["scoreCountStress"])
                self.assertFalse(variant["capabilities"]["showNativeGraphs"])
                self.assertEqual(
                    variant["capabilities"]["playAudio"],
                    bool(variant["audioUrl"] and variant["source"]["exactMatch"]),
                )

    def test_variant_id_is_normalized_sha256_prefix(self):
        variant_id = stable_variant_id(" Café ", "NOUN", "kæˈfé", "CAFE01.MP3")
        normalized = "café|noun|kæˈfé|cafe01.mp3"
        self.assertEqual(variant_id, hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16])
        self.assertRegex(variant_id, re.compile(r"^[0-9a-f]{16}$"))

    def test_reference_selects_first_valid_exact_variant_and_deduplicates(self):
        car_fixture = next(item for item in self.fixtures["valid"] if item["word"] == "car")
        invalid = self.build_fixture_variant(
            car_fixture,
            exact_match=False,
            entry_id="automobile",
            audio_filename="automobile.mp3",
        )
        valid = self.build_fixture_variant(car_fixture)
        reference = build_pronunciation_reference(
            word="car",
            variants=[invalid, valid, dict(valid)],
            deployment_version="deadbeef",
        )
        self.assertEqual(reference["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(reference["algorithmVersion"], ALGORITHM_VERSION)
        self.assertEqual(reference["dialect"], DIALECT)
        self.assertEqual(reference["defaultVariantId"], valid["id"])
        self.assertEqual(len(reference["variants"]), 2)
        self.assertEqual(validate_reference_invariants(reference), [])

    def test_cross_field_invariant_validator_rejects_mixed_data(self):
        fixture = next(item for item in self.fixtures["valid"] if item["word"] == "import")
        variant = self.build_fixture_variant(fixture)
        variant["syllableCount"] += 1
        variant["primaryStress"] = 99
        variant["secondaryStress"] = [98]
        reference = build_pronunciation_reference(
            word="import",
            variants=[variant],
            deployment_version="deadbeef",
        )
        errors = validate_reference_invariants(reference)
        self.assertIn("SYLLABLE_LENGTH_MISMATCH", errors)
        self.assertIn("PRIMARY_STRESS_OUT_OF_RANGE", errors)
        self.assertIn("SECONDARY_STRESS_OUT_OF_RANGE", errors)


if __name__ == "__main__":
    unittest.main()
