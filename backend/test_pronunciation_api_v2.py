import io
import os
import unittest
from unittest.mock import patch

from backend.local_server import server


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = "fixture"
        self.content = b"fixture"

    def json(self):
        return self._payload


def mw_entry(
    entry_id,
    *,
    headword=None,
    part_of_speech="noun",
    ipa="ˈkɑɚ",
    audio="car0001",
    definitions=None,
):
    pronunciation = {}
    if ipa is not None:
        pronunciation["ipa"] = ipa
    if audio is not None:
        pronunciation["sound"] = {"audio": audio}
    hwi = {"hw": headword if headword is not None else entry_id.split(":")[0]}
    if ipa is not None or audio is not None:
        hwi["prs"] = [pronunciation]
    return {
        "meta": {"id": entry_id},
        "hwi": hwi,
        "fl": part_of_speech,
        "shortdef": ["fixture definition"] if definitions is None else definitions,
    }


class PronunciationDictionaryV2ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.app.testing = True
        cls.client = server.app.test_client()

    def setUp(self):
        self.original_api_key = server.MW_API_KEY
        server.MW_API_KEY = "test-key"

    def tearDown(self):
        server.MW_API_KEY = self.original_api_key

    def test_production_frontend_origin_is_cors_allowed(self):
        response = self.client.get(
            "/health",
            headers={"Origin": "https://betterenglishlearning.com"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("Access-Control-Allow-Origin"),
            "https://betterenglishlearning.com",
        )

    def test_car_returns_one_valid_canonical_variant(self):
        with patch.object(
            server.http_requests,
            "get",
            return_value=FakeResponse([mw_entry("car:1")]),
        ) as get:
            response = self.client.get("/dictionary/v2/car")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload["schemaVersion"], 10)
        self.assertEqual(payload["algorithmVersion"], "pronunciation-reference-v4")
        self.assertEqual(payload["word"], "car")
        self.assertEqual(len(payload["variants"]), 1)
        variant = payload["variants"][0]
        self.assertEqual(variant["rawIpa"], "ˈkɑɚ")
        self.assertEqual(variant["displayIpa"], "/kɑr/")
        self.assertEqual(variant["syllableCount"], 1)
        self.assertEqual(variant["primaryStress"], 0)
        self.assertEqual(payload["defaultVariantId"], variant["id"])
        self.assertTrue(variant["capabilities"]["scoreCountStress"])
        self.assertEqual(get.call_count, 1)

    def test_en_us_reference_excludes_british_pronunciation_but_keeps_missing_ipa_evidence(self):
        entries = [
            {
                "meta": {"id": "photograph:1"},
                "hwi": {
                    "hw": "pho*to*graph",
                    "prs": [
                        {
                            "ipa": "ˈfoʊtəˌgræf",
                            "sound": {"audio": "photog13"},
                        },
                        {
                            "ipa": "ˈfəʊtəˌgrɑːf",
                            "l": "British",
                        },
                    ],
                },
                "fl": "noun",
                "shortdef": ["a picture made by a camera"],
            },
            {
                "meta": {"id": "photograph:2"},
                "hwi": {"hw": "photograph", "prs": []},
                "fl": "verb",
                "shortdef": ["to take a photograph of something"],
            },
        ]
        with patch.object(
            server.http_requests,
            "get",
            return_value=FakeResponse(entries),
        ):
            response = self.client.get("/dictionary/v2/photograph")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(len(payload["variants"]), 2)
        selected = next(
            item for item in payload["variants"]
            if item["id"] == payload["defaultVariantId"]
        )
        self.assertEqual(selected["rawIpa"], "ˈfoʊtəˌgræf")
        self.assertEqual(selected["displayIpa"], "/ˈfoʊtəˌɡræf/")
        self.assertEqual(selected["primaryStress"], 0)
        self.assertEqual(selected["secondaryStress"], [2])
        self.assertEqual(selected["source"]["dialect"], "en-US")
        self.assertEqual(selected["source"]["labels"], [])
        self.assertNotIn(
            "ˈfəʊtəˌgrɑːf",
            [variant["rawIpa"] for variant in payload["variants"]],
        )
        unavailable_verb = next(
            item for item in payload["variants"]
            if item["source"]["entryId"] == "photograph:2"
        )
        self.assertEqual(unavailable_verb["validation"]["status"], "conflict")
        self.assertIn("MISSING_IPA", unavailable_verb["validation"]["conflicts"])

    def test_en_us_reference_rejects_explicit_non_us_regions_and_retains_source_labels(self):
        pronunciations = [
            {"ipa": "ˈteɪst", "sound": {"audio": "default-us"}},
            {"ipa": "ˈtɛst", "l": "US", "sound": {"audio": "explicit-us"}},
            {"ipa": "ˈtɑst", "l": "Australian", "sound": {"audio": "australian"}},
            {"ipa": "ˈtɪst", "l": "Canadian", "sound": {"audio": "canadian"}},
            {"ipa": "ˈtɔst", "l": "South African", "sound": {"audio": "south-african"}},
        ]
        entry = {
            "meta": {"id": "test:1"},
            "hwi": {"hw": "test", "prs": pronunciations},
            "fl": "noun",
            "shortdef": ["fixture"],
        }
        with patch.object(
            server.http_requests,
            "get",
            return_value=FakeResponse([entry]),
        ):
            response = self.client.get("/dictionary/v2/test")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        variants = response.get_json()["variants"]
        self.assertEqual({variant["rawIpa"] for variant in variants}, {"ˈteɪst", "ˈtɛst"})
        explicit_us = next(variant for variant in variants if variant["rawIpa"] == "ˈtɛst")
        self.assertEqual(explicit_us["source"]["dialect"], "en-US")
        self.assertEqual(explicit_us["source"]["labels"], ["US"])

    def test_loose_root_entry_is_quarantined_and_never_relabelled(self):
        loose = mw_entry(
            "correct:1",
            headword="cor·rect",
            part_of_speech="adjective",
            ipa="kəˈrɛkt",
            audio="correct01",
        )
        with patch.object(
            server.http_requests,
            "get",
            side_effect=[
                FakeResponse([loose]),
                FakeResponse([loose]),
                FakeResponse([loose]),
            ],
        ):
            response = self.client.get("/dictionary/v2/correctly")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload["word"], "correctly")
        selected = next(
            item for item in payload["variants"]
            if item["id"] == payload["defaultVariantId"]
        )
        self.assertEqual(selected["source"]["provider"], "cmu-pronouncing-dictionary")
        self.assertGreaterEqual(len(payload["variants"]), 1)
        variant = next(
            item for item in payload["variants"]
            if item["source"]["entryId"] == "correct:1"
        )
        self.assertEqual(variant["source"]["entryId"], "correct:1")
        self.assertFalse(variant["source"]["exactMatch"])
        self.assertIn("NON_EXACT_ENTRY", variant["validation"]["conflicts"])
        self.assertFalse(variant["capabilities"]["scoreCountStress"])
        self.assertFalse(variant["capabilities"]["showNativeGraphs"])

    def test_exact_run_on_with_own_pronunciation_becomes_valid_variant(self):
        loose_parent = mw_entry(
            "architecture",
            headword="ar*chi*tec*ture",
            part_of_speech="noun",
            ipa="ˈɑɚkəˌtɛktʃɚ",
            audio="archit01",
        )
        loose_parent["uros"] = [{
            "ure": "ar*chi*tec*tur*al",
            "fl": "adjective",
            "prs": [{
                "ipa": "ˌɑɚkəˈtɛktʃərəl",
                "sound": {"audio": "archit05"},
            }],
        }]
        with patch.object(
            server.http_requests,
            "get",
            side_effect=[
                FakeResponse([loose_parent]),
                FakeResponse([loose_parent]),
                FakeResponse([loose_parent]),
            ],
        ):
            response = self.client.get("/dictionary/v2/architectural")

        payload = response.get_json()
        selected = next(
            item for item in payload["variants"]
            if item["id"] == payload["defaultVariantId"]
        )
        self.assertEqual(selected["partOfSpeech"], "adjective")
        self.assertEqual(selected["rawIpa"], "ˌɑɚkəˈtɛktʃərəl")
        self.assertEqual(selected["source"]["entryId"], "architecture#uro:0")
        self.assertTrue(selected["source"]["exactMatch"])
        self.assertIsNone(selected["definition"])
        self.assertIn("archit05", selected["audioUrl"])
        self.assertEqual(selected["validation"]["status"], "valid")

    def test_exact_capitalization_variant_with_own_pronunciation_is_valid(self):
        exact = mw_entry(
            "communist",
            headword="com*mu*nist",
            part_of_speech="noun",
            ipa=None,
            audio=None,
        )
        exact["vrs"] = [{
            "va": "Communist",
            "prs": [{
                "ipa": "ˈkɑːmjənɪst",
                "sound": {"audio": "commun25"},
            }],
        }]
        with patch.object(
            server.http_requests,
            "get",
            return_value=FakeResponse([exact]),
        ):
            response = self.client.get("/dictionary/v2/communist")

        payload = response.get_json()
        selected = next(
            item for item in payload["variants"]
            if item["id"] == payload["defaultVariantId"]
        )
        self.assertEqual(selected["source"]["entryId"], "communist#vr:0")
        self.assertTrue(selected["source"]["exactMatch"])
        self.assertEqual(selected["rawIpa"], "ˈkɑːmjənɪst")

    def test_exact_run_on_without_pronunciation_does_not_inherit_parent_data(self):
        loose_parent = mw_entry(
            "correct:1",
            headword="cor*rect",
            part_of_speech="adjective",
            ipa="kəˈrɛkt",
            audio="correct01",
        )
        loose_parent["uros"] = [{
            "ure": "cor*rect*ly",
            "fl": "adverb",
            "prs": None,
        }]
        with patch.object(
            server.http_requests,
            "get",
            side_effect=[
                FakeResponse([loose_parent]),
                FakeResponse([loose_parent]),
                FakeResponse([loose_parent]),
            ],
        ):
            response = self.client.get("/dictionary/v2/correctly")

        payload = response.get_json()
        selected = next(
            item for item in payload["variants"]
            if item["id"] == payload["defaultVariantId"]
        )
        self.assertEqual(selected["source"]["provider"], "cmu-pronouncing-dictionary")
        exact_run_on = next(
            item for item in payload["variants"]
            if item["source"]["entryId"] == "correct:1#uro:0"
        )
        self.assertTrue(exact_run_on["source"]["exactMatch"])
        self.assertIsNone(exact_run_on["rawIpa"])
        self.assertIsNone(exact_run_on["audioUrl"])
        self.assertIsNone(exact_run_on["definition"])
        self.assertIn("MISSING_IPA", exact_run_on["validation"]["conflicts"])

    def test_empty_exact_media_entry_returns_structured_conflict(self):
        malformed = {
            "meta": {"id": "media:1"},
            "hwi": {"hw": "me·di·a", "prs": []},
            "fl": "noun",
            "shortdef": [],
        }
        with patch.object(
            server.http_requests,
            "get",
            return_value=FakeResponse([malformed]),
        ):
            response = self.client.get("/dictionary/v2/media")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        selected = next(
            item for item in payload["variants"]
            if item["id"] == payload["defaultVariantId"]
        )
        self.assertEqual(selected["source"]["provider"], "cmu-pronouncing-dictionary")
        variant = next(
            item for item in payload["variants"]
            if item["source"]["provider"] == "merriam-webster"
        )
        self.assertIsNone(variant["definition"])
        self.assertIsNone(variant["rawIpa"])
        self.assertIn("MISSING_IPA", variant["validation"]["conflicts"])

    def test_audio_inheritance_requires_matching_ipa_and_part_of_speech(self):
        entries = [
            mw_entry("import:1", headword="im·port", part_of_speech="noun", ipa="ˈɪmˌpɔɚt", audio=None),
            mw_entry("import:2", headword="im·port", part_of_speech="verb", ipa="ˈɪmˌpɔɚt", audio="import02"),
            mw_entry("import:3", headword="im·port", part_of_speech="noun", ipa="ˈɪmˌpɔɚt", audio="import03"),
        ]
        with patch.object(
            server.http_requests,
            "get",
            return_value=FakeResponse(entries),
        ):
            response = self.client.get("/dictionary/v2/import")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        variants = response.get_json()["variants"]
        noun_variants = [item for item in variants if item["partOfSpeech"] == "noun"]
        verb_variants = [item for item in variants if item["partOfSpeech"] == "verb"]
        self.assertTrue(noun_variants)
        self.assertTrue(verb_variants)
        self.assertTrue(all("import03" in (item["audioUrl"] or "") for item in noun_variants))
        self.assertTrue(all("import02" in (item["audioUrl"] or "") for item in verb_variants))

    def test_suggestions_produce_unavailable_reference_without_500(self):
        with patch.object(
            server.http_requests,
            "get",
            side_effect=[
                FakeResponse(["medium", "medial"]),
                FakeResponse(["medium", "medial"]),
                FakeResponse(["medium", "medial"]),
            ],
        ):
            response = self.client.get("/dictionary/v2/medai")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload["variants"], [])
        self.assertIsNone(payload["defaultVariantId"])
        self.assertEqual(payload["suggestions"], ["medium", "medial"])

    def test_cmu_fallback_converts_arpabet_to_canonical_ipa(self):
        variant = server.build_cmu_fallback_variant(
            "correctly",
            "K ER0 EH1 K T L IY0",
        )
        self.assertIsNotNone(variant)
        self.assertEqual(variant["source"]["provider"], "cmu-pronouncing-dictionary")
        self.assertEqual(variant["source"]["transcription"], "cmu-arpabet-converted")
        self.assertEqual(variant["source"]["entryId"], "cmudict:correctly")
        self.assertEqual(variant["displayIpa"], "/kərˈɛktli/")
        self.assertEqual(variant["syllableCount"], 3)
        self.assertEqual(variant["primaryStress"], 1)
        self.assertIsNone(variant["definition"])
        self.assertIsNone(variant["audioUrl"])
        self.assertTrue(variant["capabilities"]["scoreCountStress"])
        self.assertFalse(variant["capabilities"]["showNativeGraphs"])

    def test_cmu_fallback_rejects_unknown_arpabet_tokens(self):
        self.assertIsNone(server.build_cmu_fallback_variant("invalid", "IH1 N QX"))

    def test_cmu_loader_finds_repository_dictionary_in_local_development(self):
        original_cache = server._CMU_FALLBACK_CACHE
        try:
            server._CMU_FALLBACK_CACHE = None
            self.assertEqual(server.get_cmu_pronunciation("car"), "K AA1 R")
        finally:
            server._CMU_FALLBACK_CACHE = original_cache

    def test_dictionary_uses_cmu_only_when_mw_has_no_valid_variant(self):
        loose = mw_entry(
            "correct:1",
            headword="cor*rect",
            part_of_speech="adjective",
            ipa="kəˈrɛkt",
            audio="correct01",
        )
        with (
            patch.object(
                server.http_requests,
                "get",
                side_effect=[
                    FakeResponse([loose]),
                    FakeResponse([loose]),
                    FakeResponse([loose]),
                ],
            ),
            patch.object(
                server,
                "get_cmu_pronunciation",
                return_value="K ER0 EH1 K T L IY0",
            ),
        ):
            response = self.client.get("/dictionary/v2/correctly")

        payload = response.get_json()
        selected = next(
            item for item in payload["variants"]
            if item["id"] == payload["defaultVariantId"]
        )
        self.assertEqual(selected["source"]["provider"], "cmu-pronouncing-dictionary")
        self.assertEqual(selected["validation"]["status"], "valid")

    def test_dictionary_does_not_add_cmu_when_mw_is_valid(self):
        with (
            patch.object(
                server.http_requests,
                "get",
                return_value=FakeResponse([mw_entry("car:1")]),
            ),
            patch.object(
                server,
                "get_cmu_pronunciation",
                return_value="K AA1 R",
            ) as get_cmu,
        ):
            response = self.client.get("/dictionary/v2/car")

        payload = response.get_json()
        self.assertEqual(len(payload["variants"]), 1)
        self.assertEqual(payload["variants"][0]["source"]["provider"], "merriam-webster")
        get_cmu.assert_not_called()

    def test_health_exposes_contract_and_deployment_versions(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["schemaVersion"], 10)
        self.assertEqual(payload["algorithmVersion"], "pronunciation-reference-v4")
        self.assertEqual(payload["analysisVersion"], "pronunciation-analysis-v2")
        self.assertTrue(payload["deploymentVersion"])

    def test_health_prefers_git_sha_over_cloud_run_revision_name(self):
        with patch.dict(
            os.environ,
            {"GIT_SHA": "", "DEPLOYMENT_VERSION": "git-sha-fixture", "K_REVISION": "revision-fixture"},
            clear=False,
        ):
            self.assertEqual(server.get_deployment_version(), "git-sha-fixture")


# ============================================================================
# V3 PRONUNCIATION ANALYSIS API TESTS
# ============================================================================

_V2_FAKE_RESULT = {
    'analysisVersion': 'pronunciation-analysis-v2',
    'quality': {'rateable': True, 'confidence': 0.85, 'reasons': []},
    'segmentation': {'rawCandidateCount': 2, 'selectedCount': 2, 'method': 'independent-acoustic-detection'},
    'observed': {
        'syllableCount': 2,
        'primaryStress': 0,
        'syllables': [
            {'startTime': 0.10, 'endTime': 0.30, 'duration': 0.20, 'vowelDuration': 0.12, 'avgPitch': 150.0, 'maxPitch': 165.0, 'intensity': 72.0},
            {'startTime': 0.35, 'endTime': 0.55, 'duration': 0.20, 'vowelDuration': 0.11, 'avgPitch': 140.0, 'maxPitch': 155.0, 'intensity': 70.0},
        ],
        'stressEvidence': {'primaryStress': 0},
    },
    'pitch': {'times': [0.1, 0.2], 'values': [150.0, 145.0]},
    'intensity': {'times': [0.1, 0.2], 'values': [72.0, 70.0]},
    'duration': 0.65,
    'sampleRate': 44100,
}

_PHONEME_FAKE_RESULT = {
    'phonemes': [
        {'symbol': 'h', 'start_time': 0.05, 'end_time': 0.10, 'confidence': 0.94},
        {'symbol': 'ɛ', 'start_time': 0.10, 'end_time': 0.25, 'confidence': 0.93},
        {'symbol': 'l', 'start_time': 0.25, 'end_time': 0.35, 'confidence': 0.91},
        {'symbol': 'oʊ', 'start_time': 0.35, 'end_time': 0.55, 'confidence': 0.90},
    ],
    'syllables': [
        {'start_time': 0.05, 'end_time': 0.30, 'duration': 0.25, 'confidence': 0.935},
        {'start_time': 0.30, 'end_time': 0.55, 'duration': 0.25, 'confidence': 0.905},
    ],
    'confidence': 0.92,
    'is_rateable': True,
    'quality_reason': None,
}


class PronunciationV3ApiTest(unittest.TestCase):
    """Tests for /analyze/v3 endpoint in all three modes."""

    @classmethod
    def setUpClass(cls):
        server.app.testing = True
        cls.client = server.app.test_client()

    # -- /health includes v3 mode --

    def test_health_includes_pronunciation_v3_mode(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIn('pronunciationV3Mode', payload)
        self.assertIn(payload['pronunciationV3Mode'], ('off', 'shadow', 'active'))

    # -- off mode --

    def test_v3_off_mode_returns_v3_shape_with_praat_engine(self):
        with patch.object(server, '_PRONUNCIATION_V3_MODE', 'off'), \
             patch.object(server, 'analyze_audio_v2', return_value=dict(_V2_FAKE_RESULT)):
            response = self.client.post(
                "/analyze/v3",
                data={"audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['analysisVersion'], 'pronunciation-analysis-v3')
        self.assertEqual(payload['mode'], 'off')
        self.assertEqual(payload['engine'], 'praat-v2')
        self.assertTrue(payload['is_rateable'])
        self.assertEqual(payload['confidence'], 0.85)
        self.assertIsNone(payload['quality_reason'])
        self.assertFalse(payload['degraded'])
        self.assertEqual(payload['observed_phonemes'], [])
        self.assertEqual(payload['syllable_count'], 2)
        self.assertEqual(len(payload['observed_syllables']), 2)
        self.assertEqual(payload['observed_syllables'][0]['startTime'], 0.10)
        self.assertEqual(payload['observed_syllables'][0]['endTime'], 0.30)
        self.assertIsNone(payload['comparison'])
        self.assertIn('pitch', payload)
        self.assertIn('intensity', payload)
        self.assertEqual(payload['total_duration'], 0.65)
        self.assertEqual(payload['sample_rate'], 44100)
        self.assertFalse(payload['capabilities']['phoneme_alignment'])
        self.assertTrue(payload['capabilities']['graphs'])

    # -- shadow mode --

    def test_v3_shadow_mode_runs_both_returns_v2_adapted(self):
        mock_client = type('MockClient', (), {'recognize': lambda self, b: dict(_PHONEME_FAKE_RESULT)})()
        with patch.object(server, '_PRONUNCIATION_V3_MODE', 'shadow'), \
             patch.object(server, 'analyze_audio_v2', return_value=dict(_V2_FAKE_RESULT)), \
             patch('backend.local_server.phoneme_client.create_phoneme_client', return_value=mock_client):
            response = self.client.post(
                "/analyze/v3",
                data={
                    "audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav"),
                    "reference_ipa": "/hɛloʊ/",
                    "expected_syllables": "2",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['analysisVersion'], 'pronunciation-analysis-v3')
        self.assertEqual(payload['mode'], 'shadow')
        self.assertEqual(payload['engine'], 'praat-v2')
        self.assertFalse(payload['degraded'])

    # -- active mode --

    def test_v3_active_mode_returns_phoneme_based_result(self):
        mock_client = type('MockClient', (), {'recognize': lambda self, b: dict(_PHONEME_FAKE_RESULT)})()
        with patch.object(server, '_PRONUNCIATION_V3_MODE', 'active'), \
             patch.object(server, 'analyze_audio_v2', return_value=dict(_V2_FAKE_RESULT)), \
             patch('backend.local_server.phoneme_client.create_phoneme_client', return_value=mock_client):
            response = self.client.post(
                "/analyze/v3",
                data={
                    "audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav"),
                    "reference_ipa": "/hɛloʊ/",
                    "expected_syllables": "2",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['analysisVersion'], 'pronunciation-analysis-v3')
        self.assertEqual(payload['mode'], 'active')
        self.assertEqual(payload['engine'], 'ctc-praat')
        self.assertFalse(payload['degraded'])
        self.assertTrue(payload['is_rateable'])
        self.assertEqual(payload['confidence'], 0.92)
        self.assertEqual(len(payload['observed_phonemes']), 4)
        self.assertEqual(payload['syllable_count'], 2)
        self.assertEqual(payload['observed_syllables'][0]['startTime'], 0.05)
        self.assertEqual(payload['observed_syllables'][0]['endTime'], 0.30)
        self.assertEqual(payload['observed_syllables'][0]['duration'], 0.25)
        self.assertTrue(any(
            operation['op'] == 'match' and operation['obs'] == 'h'
            for operation in payload['comparison']['edit_operations']
        ))
        self.assertTrue(payload['capabilities']['phoneme_alignment'])

    # -- timeout --

    def test_v3_timeout_returns_fail_closed_contours(self):
        def slow_recognize(_self, wav_bytes):
            import time as _t
            _t.sleep(0.5)
            return {}

        mock_client = type('MockClient', (), {'recognize': slow_recognize})()
        with patch.object(server, '_PRONUNCIATION_V3_MODE', 'active'), \
             patch.object(server, '_V3_HARD_TIMEOUT_SECONDS', 0.1), \
             patch.object(server, 'analyze_audio_v2', return_value=dict(_V2_FAKE_RESULT)), \
             patch('backend.local_server.phoneme_client.create_phoneme_client', return_value=mock_client):
            response = self.client.post(
                "/analyze/v3",
                data={"audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['degraded'])
        self.assertFalse(payload['is_rateable'])
        self.assertIsNone(payload['syllable_count'])
        self.assertEqual(payload['quality_reason'], 'TIMEOUT')

    # -- active mode with unrateable recognition degrades --

    def test_v3_active_unrateable_hides_target_guided_count(self):
        unrateable_result = dict(_PHONEME_FAKE_RESULT)
        unrateable_result['is_rateable'] = False
        unrateable_result['quality_reason'] = 'LOW_CONFIDENCE'

        mock_client = type('MockClient', (), {'recognize': lambda self, b: unrateable_result})()
        with patch.object(server, '_PRONUNCIATION_V3_MODE', 'active'), \
             patch.object(server, 'analyze_audio_v2', return_value=dict(_V2_FAKE_RESULT)), \
             patch('backend.local_server.phoneme_client.create_phoneme_client', return_value=mock_client):
            response = self.client.post(
                "/analyze/v3",
                data={"audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['engine'], 'ctc-praat')
        self.assertTrue(payload['degraded'])
        self.assertFalse(payload['is_rateable'])
        self.assertIsNone(payload['syllable_count'])
        self.assertFalse(payload['capabilities']['syllable_duration'])

    # -- active with phoneme error degrades --

    def test_v3_active_phoneme_error_hides_target_guided_count(self):
        def failing_recognize(_self, wav_bytes):
            raise RuntimeError("Recognizer crashed")

        mock_client = type('MockClient', (), {'recognize': failing_recognize})()
        with patch.object(server, '_PRONUNCIATION_V3_MODE', 'active'), \
             patch.object(server, 'analyze_audio_v2', return_value=dict(_V2_FAKE_RESULT)), \
             patch('backend.local_server.phoneme_client.create_phoneme_client', return_value=mock_client):
            response = self.client.post(
                "/analyze/v3",
                data={"audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['engine'], 'ctc-praat')
        self.assertTrue(payload['degraded'])
        self.assertFalse(payload['is_rateable'])
        self.assertIsNone(payload['syllable_count'])
        self.assertEqual(payload['quality_reason'], 'MODEL_INFERENCE_FAILED')

    # -- existing v2 endpoints remain unaffected --

    def test_existing_v2_analyze_endpoint_still_works(self):
        with patch.object(server, 'analyze_audio_v2', return_value=dict(_V2_FAKE_RESULT)):
            response = self.client.post(
                "/analyze/v2",
                data={"audio": (io.BytesIO(b"RIFFfixture"), "attempt.wav")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['analysisVersion'], 'pronunciation-analysis-v2')

    # -- no audio returns 400 --

    def test_v3_no_audio_returns_400(self):
        with patch.object(server, '_PRONUNCIATION_V3_MODE', 'off'):
            response = self.client.post("/analyze/v3", content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
