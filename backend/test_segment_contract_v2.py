import unittest
from backend.local_server.segment_contract import (
    SampleSpan,
    BoundaryRange,
    duration_ms,
    validate_timing_envelope
)


class TestSegmentContractV2(unittest.TestCase):

    def test_sample_span_valid(self):
        span = SampleSpan(100, 500)
        validated = span.validate(1000)
        self.assertEqual(validated.start_sample, 100)
        self.assertEqual(validated.end_sample, 500)

    def test_sample_span_invalid_types(self):
        with self.assertRaises(ValueError):
            SampleSpan(100.5, 500).validate(1000)
        with self.assertRaises(ValueError):
            SampleSpan(100, 500).validate(0)
        with self.assertRaises(ValueError):
            SampleSpan(100, 500).validate(-10)

    def test_sample_span_out_of_range(self):
        with self.assertRaises(ValueError):
            SampleSpan(-1, 500).validate(1000)
        with self.assertRaises(ValueError):
            SampleSpan(500, 500).validate(1000)
        with self.assertRaises(ValueError):
            SampleSpan(600, 500).validate(1000)
        with self.assertRaises(ValueError):
            SampleSpan(100, 1001).validate(1000)

    def test_boundary_range(self):
        br = BoundaryRange(100, 100)
        validated = br.validate(500)
        self.assertEqual(validated.lower_sample, 100)
        self.assertEqual(validated.upper_sample, 100)

        with self.assertRaises(ValueError):
            BoundaryRange(200, 100).validate(500)
        with self.assertRaises(ValueError):
            BoundaryRange(-1, 100).validate(500)
        with self.assertRaises(ValueError):
            BoundaryRange(100, 501).validate(500)

    def test_duration_ms(self):
        self.assertIsNone(duration_ms(None, 16000))
        span = SampleSpan(0, 16000)
        self.assertEqual(duration_ms(span, 16000), 1000.0)
        span2 = SampleSpan(8000, 12000)
        self.assertEqual(duration_ms(span2, 16000), 250.0)

        with self.assertRaises(ValueError):
            duration_ms(span, 0)
        with self.assertRaises(ValueError):
            duration_ms(span, -16000)

    def test_validate_timing_envelope(self):
        envelope = {
            "schemaVersion": "pronounce-timing-v2",
            "audio": {
                "sampleRateHz": 16000,
                "sampleCount": 32000
            },
            "syllables": [
                {
                    "syllableId": "syl-1",
                    "syllableSpan": {"startSample": 1600, "endSample": 4800},
                    "nucleusSpan": {"startSample": 2400, "endSample": 4000}
                },
                {
                    "syllableId": "syl-2",
                    "syllableSpan": {"startSample": 4800, "endSample": 8000},
                    "nucleusSpan": {"startSample": 5200, "endSample": 7000}
                }
            ]
        }
        validated = validate_timing_envelope(envelope)
        self.assertIsNotNone(validated)

        # Invalid envelope schema
        with self.assertRaises(ValueError):
            validate_timing_envelope({"schemaVersion": "invalid"})

        # Overlapping syllables
        bad_envelope = {
            "schemaVersion": "pronounce-timing-v2",
            "audio": {"sampleRateHz": 16000, "sampleCount": 32000},
            "syllables": [
                {"syllableSpan": {"startSample": 1600, "endSample": 5000}},
                {"syllableSpan": {"startSample": 4800, "endSample": 8000}}
            ]
        }
        with self.assertRaises(ValueError):
            validate_timing_envelope(bad_envelope)


if __name__ == '__main__':
    unittest.main()
