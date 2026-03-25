import io
import json
import re
import time
import wave

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

VERSION = "cs-v1"
BILABIAL_INITS = {"b", "p", "m"}
YOD_COALESCENCE_PHRASES = {
    "did you",
    "would you",
    "could you",
    "don't you",
    "can't you",
    "should you",
    "have you",
    "what you",
    "got you",
}
WEAK_FORM_WORDS = {
    "to": ["canonical", "reduced_to"],
    "and": ["canonical", "reduced_and"],
    "of": ["canonical", "reduced_of"],
    "for": ["canonical", "reduced_for"],
    "have": ["canonical", "reduced_have"],
}


def normalize_word(value):
    return re.sub(r"[^a-z0-9' -]+", "", str(value or "").replace("\u2018", "'").replace("\u2019", "'")).strip().lower()


def to_ms(value):
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return round(numeric / 10000.0)


def parse_reference_words(reference_text):
    return [normalize_word(token) for token in re.findall(r"[A-Za-z0-9']+", str(reference_text or ""))]


def extract_azure_words(azure_payload):
    nbest = azure_payload.get("NBest", [{}])[0] if isinstance(azure_payload, dict) else {}
    words = nbest.get("Words", []) if isinstance(nbest, dict) else []
    parsed = []
    for index, node in enumerate(words):
        phoneme_candidates = []
        for candidate in node.get("PronunciationAssessment", {}).get("NBestPhonemes", []) or []:
            phoneme = str(candidate.get("Phoneme") or candidate.get("phoneme") or "").strip()
            if phoneme:
                phoneme_candidates.append(phoneme)
        parsed.append({
            "index": index,
            "word": normalize_word(node.get("Word") or node.get("Display") or node.get("Lexical")),
            "display": str(node.get("Word") or node.get("Display") or node.get("Lexical") or "").strip(),
            "offset_ms": to_ms(node.get("Offset")),
            "duration_ms": to_ms(node.get("Duration")),
            "accuracy_score": round(float(node.get("PronunciationAssessment", {}).get("AccuracyScore", 0) or 0)),
            "error_type": str(node.get("PronunciationAssessment", {}).get("ErrorType", "None")),
            "phonemes": phoneme_candidates,
        })
    return parsed


def summarize_events(events):
    summary = {"detectedCount": 0, "notDetectedCount": 0, "uncertainCount": 0}
    for event in events:
        if event["status"] == "detected":
            summary["detectedCount"] += 1
        elif event["status"] == "not_detected":
            summary["notDetectedCount"] += 1
        else:
            summary["uncertainCount"] += 1
    return summary


def normalize_phoneme_candidates(phonemes):
    return [normalize_word(phoneme) for phoneme in (phonemes or []) if normalize_word(phoneme)]


def has_any_phoneme_candidate(word_node, candidates):
    normalized = set(normalize_phoneme_candidates(word_node.get("phonemes", []) if isinstance(word_node, dict) else []))
    return any(normalize_word(candidate) in normalized for candidate in candidates)


def build_not_rateable_result(reason=None):
    return {
        "status": "not_rateable",
        "version": VERSION,
        "summary": {"detectedCount": 0, "notDetectedCount": 0, "uncertainCount": 0},
        "events": [],
        "reason": reason,
    }


def classify_gap_status(gap_ms, detector_config=None):
    detector_config = detector_config or {}
    detected_threshold = int(detector_config.get("detectedThresholdMs", 140))
    uncertain_threshold = int(detector_config.get("uncertainThresholdMs", 220))

    if gap_ms is None or gap_ms < 0:
        return "uncertain"
    if gap_ms <= detected_threshold:
        return "detected"
    if gap_ms >= uncertain_threshold:
        return "not_detected"
    return "uncertain"


def get_gap_ms(left_word, right_word):
    if not left_word or not right_word:
        return None
    if left_word["offset_ms"] is None or left_word["duration_ms"] is None or right_word["offset_ms"] is None:
        return None
    gap_ms = right_word["offset_ms"] - (left_word["offset_ms"] + left_word["duration_ms"])
    return None if gap_ms < 0 else gap_ms


def classify_event(event, reference_words, azure_words, reference_text, audio_quality=None):
    family = str(event.get("family", "")).strip()
    feedback_templates = event.get("feedbackTemplates", {})
    phrase = str(event.get("phrase", "")).strip()
    start = int(event.get("startWordIndex", -1))
    end = int(event.get("endWordIndex", -1))
    if start < 0 or end < start or start >= len(reference_words) or end >= len(reference_words):
        return {
            "eventId": event.get("eventId"),
            "family": family,
            "status": "uncertain",
            "confidence": 0.2,
            "startMs": None,
            "endMs": None,
            "feedbackText": event.get("feedbackTemplates", {}).get("uncertain", f'We could not judge "{event.get("phrase", "")}" reliably.'),
            "evidence": {"reason": "missing_span"},
        }

    left = azure_words[start] if start < len(azure_words) else None
    right = azure_words[end] if end < len(azure_words) else None
    gap_ms = get_gap_ms(left, right)

    if not left or not right:
        return {
            "eventId": event.get("eventId"),
            "family": family,
            "status": "uncertain",
            "confidence": 0.25,
            "startMs": left["offset_ms"] if left else None,
            "endMs": (right["offset_ms"] + right["duration_ms"]) if right and right["offset_ms"] is not None and right["duration_ms"] is not None else None,
            "feedbackText": event.get("feedbackTemplates", {}).get("uncertain", f'We could not judge "{event.get("phrase", "")}" reliably.'),
            "evidence": {"reason": "missing_azure_word_timing", "gapMs": gap_ms},
        }

    if left["offset_ms"] is None or left["duration_ms"] is None or right["offset_ms"] is None or right["duration_ms"] is None:
        return {
            "eventId": event.get("eventId"),
            "family": family,
            "status": "uncertain",
            "confidence": 0.5,
            "startMs": left["offset_ms"],
            "endMs": (right["offset_ms"] + right["duration_ms"]) if right["offset_ms"] is not None and right["duration_ms"] is not None else None,
            "feedbackText": feedback_templates.get("uncertain", f'We could not judge "{phrase}" reliably.'),
            "evidence": {"reason": "missing_timing_fields", "gapMs": gap_ms},
        }

    left_phoneme_hints = left.get("phonemes", [])
    right_phoneme_hints = right.get("phonemes", [])
    coalesced_hint = has_any_phoneme_candidate(right, ["dʒ", "ʤ", "tʃ", "ʧ", "ʒ"])
    reduced_hint = has_any_phoneme_candidate(left, ["ə", "ɐ", "ʊ", "ɪ"])
    bilabial_hint = has_any_phoneme_candidate(left, ["m"])

    if audio_quality and not audio_quality.get("passed", True):
        return {
            "eventId": event.get("eventId"),
            "family": family,
            "status": "uncertain",
            "confidence": 0.1,
            "startMs": None,
            "endMs": None,
            "feedbackText": feedback_templates.get("uncertain", f'We could not judge "{phrase}" reliably.'),
            "evidence": {
                "reason": "audio_not_rateable",
                "audioQualityReason": audio_quality.get("reason"),
            },
        }

    status = classify_gap_status(gap_ms, event.get("detectorConfig", {}))
    phrase = str(event.get("phrase", "")).strip()
    family = str(event.get("family", "")).strip()
    confidence_map = {
        "detected": 0.84 if family == "catenation" else 0.8 if family == "same_consonant_merge" else 0.74,
        "not_detected": 0.32 if family == "n_bilabial_assimilation" else 0.34 if family == "weak_form_reduction" else 0.3,
        "uncertain": 0.5,
    }
    prompt_text = normalize_word(reference_text)

    if family == "weak_form_reduction":
        reduced_word = normalize_word(event.get("detectorConfig", {}).get("weakFormWord") or event.get("leftWord") or phrase)
        next_word = azure_words[end] if end < len(azure_words) else None
        relative_duration = None
        if next_word and next_word.get("duration_ms") and left.get("duration_ms"):
            relative_duration = left["duration_ms"] / max(1, next_word["duration_ms"])
        if left["accuracy_score"] <= 78 or (relative_duration is not None and relative_duration <= 0.75) or reduced_hint:
            status = "detected"
        elif left["accuracy_score"] >= 94 and (relative_duration is None or relative_duration >= 1.15) and not reduced_hint:
            status = "not_detected"
        else:
            status = "uncertain"
        return {
            "eventId": event.get("eventId"),
            "family": family,
            "status": status,
            "confidence": confidence_map[status],
            "startMs": left["offset_ms"],
            "endMs": left["offset_ms"] + left["duration_ms"],
            "feedbackText": feedback_templates.get(status, f'Try reducing "{phrase}" more.'),
            "evidence": {
                "variant": "weak_form" if status == "detected" else "canonical",
                "gapMs": gap_ms,
                "relativeDuration": relative_duration,
                "leftPhonemeHints": left_phoneme_hints,
                "rightPhonemeHints": right_phoneme_hints,
                "targetWord": reduced_word,
                "promptText": prompt_text,
            },
        }

    if family == "n_bilabial_assimilation":
        status = "detected" if gap_ms is not None and gap_ms <= 125 and (left["accuracy_score"] <= 84 or bilabial_hint) else ("not_detected" if gap_ms is not None and gap_ms >= 280 and not bilabial_hint else "uncertain")
        return {
            "eventId": event.get("eventId"),
            "family": family,
            "status": status,
            "confidence": confidence_map[status],
            "startMs": left["offset_ms"],
            "endMs": right["offset_ms"] + right["duration_ms"],
            "feedbackText": feedback_templates.get(status, f'Try smoothing "{phrase}" more.'),
            "evidence": {
                "variant": "assimilated_n_to_m" if status == "detected" else "canonical",
                "gapMs": gap_ms,
                "leftPhonemeHints": left_phoneme_hints,
                "rightPhonemeHints": right_phoneme_hints,
                "leftAccuracy": left["accuracy_score"],
                "rightAccuracy": right["accuracy_score"],
                "promptText": prompt_text,
            },
        }

    if family == "yod_coalescence":
        status = "detected" if gap_ms is not None and (gap_ms <= 125 or coalesced_hint) else ("not_detected" if gap_ms is not None and gap_ms >= 280 and not coalesced_hint else "uncertain")
        return {
            "eventId": event.get("eventId"),
            "family": family,
            "status": status,
            "confidence": confidence_map[status],
            "startMs": left["offset_ms"],
            "endMs": right["offset_ms"] + right["duration_ms"],
            "feedbackText": feedback_templates.get(status, f'Try smoothing "{phrase}" more.'),
            "evidence": {
                "variant": "coalesced" if status == "detected" else "canonical",
                "gapMs": gap_ms,
                "leftPhonemeHints": left_phoneme_hints,
                "rightPhonemeHints": right_phoneme_hints,
                "promptText": prompt_text,
            },
        }

    status = classify_gap_status(gap_ms, event.get("detectorConfig", {}))
    return {
        "eventId": event.get("eventId"),
        "family": family,
        "status": status,
        "confidence": confidence_map[status],
        "startMs": left["offset_ms"],
        "endMs": right["offset_ms"] + right["duration_ms"],
        "feedbackText": feedback_templates.get(status, f'Try smoothing "{phrase}" more.'),
        "evidence": {
            "variant": "linked" if status == "detected" else "canonical",
            "gapMs": gap_ms,
            "leftPhonemeHints": left_phoneme_hints,
            "rightPhonemeHints": right_phoneme_hints,
            "promptText": prompt_text,
        },
    }


def analyze_connected_speech(spec, audio_bytes):
    reference_text = str(spec.get("referenceText", "")).strip()
    question_id = str(spec.get("questionId", "")).strip()
    events = list(spec.get("events", []) or [])
    audio_quality = spec.get("audioQuality", {}) if isinstance(spec.get("audioQuality", {}), dict) else {}
    if not question_id or not events:
        return {
            "status": "not_applicable",
            "version": VERSION,
            "summary": {"detectedCount": 0, "notDetectedCount": 0, "uncertainCount": 0},
            "events": [],
        }

    if audio_quality and not audio_quality.get("passed", True):
        return build_not_rateable_result(audio_quality.get("reason"))

    reference_words = parse_reference_words(reference_text)
    azure_words = extract_azure_words(spec.get("azurePayload", {}))
    scored_events = [classify_event(event, reference_words, azure_words, reference_text, audio_quality) for event in events]
    return {
        "status": "complete",
        "version": VERSION,
        "summary": summarize_events(scored_events),
        "events": scored_events,
    }


def read_wav_duration_ms(audio_bytes):
    with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
        frame_count = wav_file.getnframes()
        sample_rate = wav_file.getframerate() or 1
        return round((frame_count / float(sample_rate)) * 1000)


@app.route("/connected-speech/analyze", methods=["POST"])
def analyze_route():
    started = time.time()
    audio = request.files.get("audio")
    spec_raw = request.form.get("analysisSpec", "")

    if not audio or not spec_raw:
        return jsonify({
            "status": "unavailable",
            "version": VERSION,
            "summary": {"detectedCount": 0, "notDetectedCount": 0, "uncertainCount": 0},
            "events": [],
            "error": "missing_input",
        }), 400

    try:
        spec = json.loads(spec_raw)
    except json.JSONDecodeError:
        return jsonify({
            "status": "unavailable",
            "version": VERSION,
            "summary": {"detectedCount": 0, "notDetectedCount": 0, "uncertainCount": 0},
            "events": [],
            "error": "invalid_analysis_spec",
        }), 400

    try:
        audio_bytes = audio.read()
        read_wav_duration_ms(audio_bytes)
    except Exception:
        return jsonify({
            "status": "unavailable",
            "version": VERSION,
            "summary": {"detectedCount": 0, "notDetectedCount": 0, "uncertainCount": 0},
            "events": [],
            "error": "invalid_audio",
        }), 400

    result = analyze_connected_speech(spec, audio_bytes)
    if result.get("status") == "not_rateable":
        result["summary"] = {"detectedCount": 0, "notDetectedCount": 0, "uncertainCount": 0}
        result["events"] = []
    result["elapsedMs"] = round((time.time() - started) * 1000)
    return jsonify(result)


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "ok",
        "service": "connected-speech-worker",
        "version": VERSION,
    })


if __name__ == "__main__":
    import os

    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    app.run(host=host, port=port)
