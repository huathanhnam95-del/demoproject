import io
import json
import sys
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from connected_speech_worker import app


def make_wav_bytes(duration_ms=240, sample_rate=16000, amplitude=1200):
    sample_count = max(1, round(sample_rate * (duration_ms / 1000.0)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        frames = bytearray()
        for _ in range(sample_count):
            frames.extend(int(amplitude).to_bytes(2, byteorder="little", signed=True))
        wav_file.writeframes(bytes(frames))
    return buffer.getvalue()


def build_azure_payload(words, display=None):
    return {
        "NBest": [{
            "Display": display or " ".join(word["word"] for word in words),
            "PronunciationAssessment": {
                "AccuracyScore": 92.0,
                "FluencyScore": 88.0,
                "CompletenessScore": 100.0,
                "PronScore": 91.0,
            },
            "Words": [
                {
                    "Word": word["word"],
                    "Offset": word.get("offset"),
                    "Duration": word.get("duration"),
                    "PronunciationAssessment": {
                        "AccuracyScore": word.get("accuracy", 90),
                        "ErrorType": word.get("errorType", "None"),
                        "NBestPhonemes": [
                            {"Phoneme": phoneme, "Score": score}
                            for phoneme, score in word.get("phonemes", [])
                        ],
                    },
                }
                for word in words
            ],
        }]
    }


def build_spec(reference_text, question_id, events, words, audio_quality=None, azure_payload=None):
    return {
        "attemptId": "attempt-1",
        "questionId": question_id,
        "referenceText": reference_text,
        "azurePayload": azure_payload if azure_payload is not None else build_azure_payload(words),
        "events": events,
        "audioQuality": audio_quality or {"passed": True},
    }


def post_analysis(client, spec, wav_bytes=None):
    data = {"analysisSpec": json.dumps(spec)}
    audio = wav_bytes if wav_bytes is not None else make_wav_bytes()
    data["audio"] = (io.BytesIO(audio), "recording.wav")
    return client.post("/connected-speech/analyze", data=data, content_type="multipart/form-data")


def post_analysis_with_raw_spec(client, spec_json, wav_bytes=None):
    data = {"analysisSpec": spec_json}
    audio = wav_bytes if wav_bytes is not None else make_wav_bytes()
    data["audio"] = (io.BytesIO(audio), "recording.wav")
    return client.post("/connected-speech/analyze", data=data, content_type="multipart/form-data")


class ConnectedSpeechWorkerTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def assert_family_case(self, family, reference_text, question_id, event, words, expected_status, expected_summary_key):
        spec = build_spec(reference_text, question_id, [event], words)
        response = post_analysis(self.client, spec)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "complete")
        self.assertEqual(payload["summary"][expected_summary_key], 1)
        self.assertEqual(payload["events"][0]["family"], family)
        self.assertEqual(payload["events"][0]["status"], expected_status)

    def test_family_cases(self):
        cases = [
            (
                "catenation",
                "Pick it up now",
                {
                    "eventId": "catenation-1",
                    "family": "catenation",
                    "phrase": "Pick it",
                    "leftWord": "pick",
                    "rightWord": "it",
                    "startWordIndex": 0,
                    "endWordIndex": 1,
                    "allowedVariants": ["canonical", "linked"],
                    "detectorConfig": {"detectedThresholdMs": 140, "uncertainThresholdMs": 220},
                    "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
                },
                [
                    {"word": "pick", "offset": 0, "duration": 3000000, "accuracy": 95},
                    {"word": "it", "offset": 3120000, "duration": 1800000, "accuracy": 92},
                    {"word": "up", "offset": 5200000, "duration": 2000000, "accuracy": 90},
                    {"word": "now", "offset": 7400000, "duration": 2200000, "accuracy": 93},
                ],
                "detected",
                "detectedCount",
            ),
            (
                "same_consonant_merge",
                "big game",
                {
                    "eventId": "merge-1",
                    "family": "same_consonant_merge",
                    "phrase": "big game",
                    "leftWord": "big",
                    "rightWord": "game",
                    "startWordIndex": 0,
                    "endWordIndex": 1,
                    "allowedVariants": ["canonical", "merged"],
                    "detectorConfig": {"detectedThresholdMs": 140, "uncertainThresholdMs": 220},
                    "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
                },
                [
                    {"word": "big", "offset": 0, "duration": 2900000, "accuracy": 94},
                    {"word": "game", "offset": 3040000, "duration": 1900000, "accuracy": 93},
                ],
                "detected",
                "detectedCount",
            ),
            (
                "n_bilabial_assimilation",
                "green park",
                {
                    "eventId": "assim-1",
                    "family": "n_bilabial_assimilation",
                    "phrase": "green park",
                    "leftWord": "green",
                    "rightWord": "park",
                    "startWordIndex": 0,
                    "endWordIndex": 1,
                    "allowedVariants": ["canonical", "assimilated"],
                    "detectorConfig": {"place": "bilabial"},
                    "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
                },
                [
                    {"word": "green", "offset": 0, "duration": 2600000, "accuracy": 78},
                    {"word": "park", "offset": 2720000, "duration": 2200000, "accuracy": 91},
                ],
                "detected",
                "detectedCount",
            ),
            (
                "yod_coalescence",
                "would you",
                {
                    "eventId": "yod-1",
                    "family": "yod_coalescence",
                    "phrase": "would you",
                    "leftWord": "would",
                    "rightWord": "you",
                    "startWordIndex": 0,
                    "endWordIndex": 1,
                    "allowedVariants": ["canonical", "coalesced"],
                    "detectorConfig": {"phraseType": "fixed_template"},
                    "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
                },
                [
                    {"word": "would", "offset": 0, "duration": 2400000, "accuracy": 79},
                    {"word": "you", "offset": 2520000, "duration": 1600000, "accuracy": 90},
                ],
                "detected",
                "detectedCount",
            ),
            (
                "weak_form_reduction",
                "want to go",
                {
                    "eventId": "weak-1",
                    "family": "weak_form_reduction",
                    "phrase": "to",
                    "leftWord": "to",
                    "rightWord": "go",
                    "startWordIndex": 1,
                    "endWordIndex": 2,
                    "allowedVariants": ["canonical", "reduced_to"],
                    "detectorConfig": {"weakFormWord": "to"},
                    "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
                },
                [
                    {"word": "want", "offset": 0, "duration": 2500000, "accuracy": 94},
                    {"word": "to", "offset": 2580000, "duration": 900000, "accuracy": 78},
                    {"word": "go", "offset": 3600000, "duration": 2600000, "accuracy": 92},
                ],
                "detected",
                "detectedCount",
            ),
        ]

        for family, reference_text, event, words, expected_status, summary_key in cases:
            with self.subTest(family=family, expected_status=expected_status):
                self.assert_family_case(family, reference_text, "q-1", event, words, expected_status, summary_key)

    def test_uncertain_when_timing_missing(self):
        spec = build_spec(
            "Pick it up now",
            "q-1",
            [{
                "eventId": "catenation-uncertain",
                "family": "catenation",
                "phrase": "Pick it",
                "leftWord": "pick",
                "rightWord": "it",
                "startWordIndex": 0,
                "endWordIndex": 1,
                "allowedVariants": ["canonical", "linked"],
                "detectorConfig": {},
                "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
            }],
            [
                {"word": "pick"},
                {"word": "it"},
                {"word": "up"},
                {"word": "now"},
            ],
        )
        response = post_analysis(self.client, spec)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["events"][0]["status"], "uncertain")
        self.assertEqual(payload["summary"]["uncertainCount"], 1)

    def test_not_applicable_when_no_events(self):
        spec = build_spec("Pick it up now", "q-1", [], [])
        response = post_analysis(self.client, spec)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "not_applicable")
        self.assertEqual(payload["summary"]["detectedCount"], 0)

    def test_not_rateable_when_audio_quality_fails(self):
        spec = build_spec(
            "Pick it up now",
            "q-1",
            [{
                "eventId": "catenation-not-rateable",
                "family": "catenation",
                "phrase": "Pick it",
                "leftWord": "pick",
                "rightWord": "it",
                "startWordIndex": 0,
                "endWordIndex": 1,
                "allowedVariants": ["canonical", "linked"],
                "detectorConfig": {},
                "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
            }],
            [
                {"word": "pick", "offset": 0, "duration": 3000000, "accuracy": 95},
                {"word": "it", "offset": 3120000, "duration": 1800000, "accuracy": 92},
            ],
            audio_quality={"passed": False, "reason": "clipped"}
        )
        response = post_analysis(self.client, spec)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "not_rateable")
        self.assertEqual(payload["summary"]["detectedCount"], 0)
        self.assertEqual(payload["events"], [])

    def test_rejects_too_short_audio_container(self):
        spec = build_spec(
            "Pick it up now",
            "q-1",
            [{
                "eventId": "catenation-short-audio",
                "family": "catenation",
                "phrase": "Pick it",
                "leftWord": "pick",
                "rightWord": "it",
                "startWordIndex": 0,
                "endWordIndex": 1,
                "allowedVariants": ["canonical", "linked"],
                "detectorConfig": {},
                "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
            }],
            [
                {"word": "pick", "offset": 0, "duration": 3000000, "accuracy": 95},
                {"word": "it", "offset": 3120000, "duration": 1800000, "accuracy": 92},
            ]
        )
        response = post_analysis(self.client, spec, wav_bytes=make_wav_bytes(duration_ms=60))
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertEqual(payload["error"], "too_short")

    def test_malformed_internal_payloads_do_not_500(self):
        cases = [
            build_spec(
                "Did you see it?",
                "q-1",
                [{
                    "eventId": "bad-index",
                    "family": "yod_coalescence",
                    "phrase": "Did you",
                    "leftWord": "did",
                    "rightWord": "you",
                    "startWordIndex": "bad",
                    "endWordIndex": 1,
                    "allowedVariants": ["canonical", "coalesced"],
                    "detectorConfig": {"phraseType": "fixed_template"},
                    "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
                }],
                [
                    {"word": "did", "offset": 0, "duration": 2600000, "accuracy": 84},
                    {"word": "you", "offset": 3000000, "duration": 1500000, "accuracy": 89},
                ],
                azure_payload={"NBest": []}
            ),
            build_spec(
                "Did you see it?",
                "q-1",
                [{
                    "eventId": "bad-word-node",
                    "family": "yod_coalescence",
                    "phrase": "Did you",
                    "leftWord": "did",
                    "rightWord": "you",
                    "startWordIndex": 0,
                    "endWordIndex": 1,
                    "allowedVariants": ["canonical", "coalesced"],
                    "detectorConfig": {"phraseType": "fixed_template"},
                    "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
                }],
                [
                    {"word": "did", "offset": 0, "duration": 2600000, "accuracy": 84},
                    {"word": "you", "offset": 3000000, "duration": 1500000, "accuracy": 89, "phonemes": [("d\u0292", 91)]},
                ],
                azure_payload={
                    "NBest": [{
                        "Display": "Did you see it",
                        "PronunciationAssessment": {
                            "AccuracyScore": "bad",
                            "FluencyScore": 88.0,
                            "CompletenessScore": 100.0,
                            "PronScore": 91.0,
                        },
                        "Words": [None],
                    }]
                }
            ),
        ]

        for spec in cases:
            response = post_analysis(self.client, spec)
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertEqual(payload["status"], "complete")
            self.assertGreaterEqual(len(payload["events"]), 1)

    def test_phoneme_hint_normalization_handles_unicode(self):
        spec = build_spec(
            "Did you see it?",
            "q-1",
            [{
                "eventId": "yod-hint",
                "family": "yod_coalescence",
                "phrase": "Did you",
                "leftWord": "did",
                "rightWord": "you",
                "startWordIndex": 0,
                "endWordIndex": 1,
                "allowedVariants": ["canonical", "coalesced"],
                "detectorConfig": {"phraseType": "fixed_template"},
                "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
            }],
            [
                {"word": "did", "offset": 0, "duration": 2600000, "accuracy": 84},
                {"word": "you", "offset": 3000000, "duration": 1500000, "accuracy": 89, "phonemes": [("d\u0292", 91)]},
                {"word": "see", "offset": 4700000, "duration": 1800000, "accuracy": 93},
                {"word": "it", "offset": 6600000, "duration": 1500000, "accuracy": 91},
            ]
        )
        response = post_analysis(self.client, spec)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "complete")
        self.assertEqual(payload["events"][0]["status"], "detected")
        self.assertIn("rightPhonemeHints", payload["events"][0]["evidence"])

    def test_weak_form_event_has_base_schema_fields(self):
        spec = build_spec(
            "Want to go",
            "q-1",
            [{
                "eventId": "weak-schema",
                "family": "weak_form_reduction",
                "phrase": "to",
                "leftWord": "to",
                "rightWord": "go",
                "startWordIndex": 1,
                "endWordIndex": 2,
                "allowedVariants": ["canonical", "reduced_to"],
                "detectorConfig": {"weakFormWord": "to"},
                "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
            }],
            [
                {"word": "want", "offset": 0, "duration": 2000000, "accuracy": 94},
                {"word": "to", "offset": 2100000, "duration": 2200000, "accuracy": 90, "phonemes": [("\u0259", 93)]},
                {"word": "go", "offset": 4400000, "duration": 2200000, "accuracy": 92},
            ]
        )
        response = post_analysis(self.client, spec)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        event = payload["events"][0]
        self.assertEqual(event["family"], "weak_form_reduction")
        self.assertIn("phrase", event)
        self.assertIn("leftWord", event)
        self.assertIn("rightWord", event)
        self.assertIsInstance(event["startWordIndex"], int)
        self.assertIsInstance(event["endWordIndex"], int)

    def test_multipart_transport_preserves_ipa_phonemes(self):
        spec = build_spec(
            "Want to go",
            "q-1",
            [{
                "eventId": "weak-transport",
                "family": "weak_form_reduction",
                "phrase": "to",
                "leftWord": "to",
                "rightWord": "go",
                "startWordIndex": 1,
                "endWordIndex": 2,
                "allowedVariants": ["canonical", "reduced_to"],
                "detectorConfig": {"weakFormWord": "to"},
                "feedbackTemplates": {"detected": "ok", "not_detected": "no", "uncertain": "maybe"},
            }],
            [
                {"word": "want", "offset": 0, "duration": 2000000, "accuracy": 94},
                {"word": "to", "offset": 2100000, "duration": 2200000, "accuracy": 90, "phonemes": [("\u0259", 93)]},
                {"word": "go", "offset": 4400000, "duration": 2200000, "accuracy": 92},
            ]
        )
        response = post_analysis_with_raw_spec(self.client, json.dumps(spec, ensure_ascii=False))
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        event = payload["events"][0]
        self.assertEqual(event["status"], "detected")
        self.assertEqual(event["evidence"]["leftPhonemeHints"], ["\u0259"])
        self.assertEqual(event["evidence"]["variant"], "weak_form")


if __name__ == "__main__":
    unittest.main()
