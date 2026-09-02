#!/usr/bin/env python3
"""Lease-safe local worker for the Deep AI PTE Write Essay queue.

The worker defaults to the Firestore emulator. Production requires the explicit
``--production`` flag and a repository-root service account file. The model
pipeline remains DeepSeek -> Qwen -> Gemma, but queue claiming, terminal writes,
notifications, backfill scans, and worker health are deterministic and
transactional.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import requests

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1.field_path import FieldPath
except ImportError:  # pragma: no cover - import failures are reported by startup.
    firebase_admin = None
    credentials = None
    firestore = None
    AnonymousCredentials = None
    FieldPath = None


PROJECT_ID = "listening-tasks-3ae34"
ROOT = Path(__file__).resolve().parents[1]
RUBRIC_PATH = ROOT / "public" / "database" / "knowledge-base" / "Write Essay Score Guide.txt"
DEFAULT_EMULATOR_HOST = "127.0.0.1:8080"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
LEASE_SECONDS = 600
HEARTBEAT_SECONDS = 15
HEARTBEAT_STALE_SECONDS = 45
PAGE_SIZE = 200
MAX_RETRIES = 3
MODEL_PHASE_1 = os.getenv("MODEL_PHASE_1", os.getenv("LOCAL_DEEPSEEK_MODEL", "deepseek-r1:14b"))
MODEL_PHASE_2 = os.getenv("MODEL_PHASE_2", os.getenv("LOCAL_QWEN_MODEL", "qwen3:14b"))
MODEL_PHASE_3 = os.getenv("MODEL_PHASE_3", os.getenv("LOCAL_GEMMA_MODEL", "gemma4:12b"))

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [EssayBatchWorker] %(message)s",
)


class RuntimeConfigurationError(RuntimeError):
    pass


class ModelOutputError(ValueError):
    pass


class OllamaHttpError(RuntimeError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class RuntimeConfig:
    mode: str
    project_id: str
    firestore_emulator_host: str | None
    service_account_path: str | None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def compute_queue_id(uid: str, attempt_id: str) -> str:
    if not isinstance(uid, str) or not uid or not isinstance(attempt_id, str) or not attempt_id:
        raise ValueError("uid and attempt_id are required")
    return hashlib.sha256(f"{uid}:{attempt_id}".encode("utf-8")).hexdigest()


def extract_archive_payload(attempt: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(attempt, dict):
        raise ValueError("archive document is not an object")
    if (
        attempt.get("practiceScope") != "pte"
        or attempt.get("canonicalMode") != "write_essay"
        or attempt.get("status") != "submitted"
    ):
        raise ValueError("archive is not a submitted PTE Write Essay")
    uid = str(attempt.get("ownerUid") or "").strip()
    essay = str((attempt.get("responseSnapshot") or {}).get("text") or "").strip()
    prompt = str((attempt.get("promptSnapshot") or {}).get("text") or "").strip()
    if not uid or not (50 <= len(essay) <= 6000):
        raise ValueError("archive essay length is outside Deep AI limits")
    if not (1 <= len(prompt) <= 2000):
        raise ValueError("archive prompt length is outside Deep AI limits")
    question_id = str((attempt.get("promptSnapshot") or {}).get("promptId") or "").strip()[:128] or None
    return {"uid": uid, "essayText": essay, "promptText": prompt, "questionId": question_id}


def parse_model_output(raw: str) -> dict[str, Any]:
    if not isinstance(raw, str):
        raise ModelOutputError("model output is not text")
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).replace("```", "").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ModelOutputError("model output did not contain a JSON object")
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ModelOutputError("model output JSON is malformed") from exc
    if not isinstance(value, dict):
        raise ModelOutputError("model output JSON must be an object")
    return value


SCORE_MAXIMA = {
    "content": 6,
    "form": 2,
    "development_structure_coherence": 6,
    "grammar": 2,
    "general_linguistic_range": 6,
    "vocabulary_range": 2,
    "spelling": 2,
}


def _bounded_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _bounded_list(value: Any, limit: int, item_limit: int = 1000) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_bounded_text(item, item_limit) for item in value[:limit] if str(item or "").strip()]


def normalize_result_snapshot(phase1: dict[str, Any], phase2: dict[str, Any], teacher_advice: str) -> dict[str, Any]:
    source_scores = phase1.get("scores") if isinstance(phase1, dict) else {}
    source_scores = source_scores if isinstance(source_scores, dict) else {}
    scores: dict[str, dict[str, Any]] = {}
    total = 0
    for key, maximum in SCORE_MAXIMA.items():
        raw = source_scores.get(key) if isinstance(source_scores.get(key), dict) else {}
        try:
            score = int(float(raw.get("score", 0)))
        except (TypeError, ValueError):
            score = 0
        score = max(0, min(maximum, score))
        rationale = _bounded_text(raw.get("rationale"), 2000)
        evidence = _bounded_list(raw.get("evidence"), 3, 1000)
        scores[key] = {"score": score, "max": maximum, "rationale": rationale, "evidence": evidence}
        total += score
    rewrites = []
    for item in (phase2.get("sentenceRewrites") if isinstance(phase2, dict) else [])[:3] if isinstance(phase2, dict) and isinstance(phase2.get("sentenceRewrites"), list) else []:
        if isinstance(item, dict):
            rewrites.append({
                "original": _bounded_text(item.get("original"), 1000),
                "improved": _bounded_text(item.get("improved"), 1000),
                "explanation": _bounded_text(item.get("explanation"), 1000),
            })
    upgrades = []
    for item in (phase2.get("vocabularyUpgrades") if isinstance(phase2, dict) else [])[:3] if isinstance(phase2, dict) and isinstance(phase2.get("vocabularyUpgrades"), list) else []:
        if isinstance(item, dict):
            upgrades.append({
                "originalWord": _bounded_text(item.get("originalWord"), 500),
                "suggestedWord": _bounded_text(item.get("suggestedWord"), 500),
                "context": _bounded_text(item.get("context"), 500),
            })
    return {
        "scores": scores,
        "overall": {"total": total, "maxTotal": 26, "percent": round(total / 26 * 100)},
        "sentenceRewrites": rewrites,
        "vocabularyUpgrades": upgrades,
        "teacherAdviceChat": _bounded_text(teacher_advice, 4000),
    }


def classify_ollama_error(error: BaseException) -> str:
    if isinstance(error, ModelOutputError):
        return "model_output"
    if isinstance(error, OllamaHttpError):
        return "infrastructure"
    if isinstance(error, (ConnectionError, TimeoutError, requests.exceptions.ConnectionError, requests.exceptions.Timeout)):
        return "infrastructure"
    return "infrastructure"


def resolve_runtime_config(options: dict[str, Any] | None = None) -> RuntimeConfig:
    options = options or {}
    production = bool(options.get("production", False))
    project_id = str(options.get("project_id") or PROJECT_ID)
    if not production:
        emulator_host = str(options.get("emulator_host") or os.getenv("FIRESTORE_EMULATOR_HOST") or DEFAULT_EMULATOR_HOST)
        return RuntimeConfig("emulator", project_id, emulator_host, None)
    service_path = str(options.get("service_account_path") or (ROOT / "serviceAccountKey.json"))
    if not Path(service_path).is_file():
        raise RuntimeConfigurationError("--production requires an existing serviceAccountKey.json")
    return RuntimeConfig("production", project_id, None, service_path)


def claim_document_data(data: dict[str, Any], worker_id: str, now: datetime, lease_seconds: int = LEASE_SECONDS) -> dict[str, Any] | None:
    status = data.get("status")
    expiry = data.get("leaseExpiresAt")
    if status == "processing" and isinstance(expiry, datetime) and expiry > now:
        return None
    if status not in {"pending", "processing"}:
        return None
    claimed = dict(data)
    claimed.update({
        "status": "processing",
        "workerId": worker_id,
        "claimedAt": now,
        "leaseExpiresAt": now + timedelta(seconds=lease_seconds),
    })
    return claimed


def refresh_scan_lease_data(
    data: dict[str, Any],
    worker_id: str,
    now: datetime,
    lease_seconds: int = LEASE_SECONDS,
) -> dict[str, Any] | None:
    lease = data.get("leaseExpiresAt")
    if (
        data.get("status") != "processing"
        or data.get("workerId") != worker_id
        or not isinstance(lease, datetime)
        or lease <= now
    ):
        return None
    return {"leaseExpiresAt": now + timedelta(seconds=lease_seconds)}


def build_control_completion_updates(
    control: dict[str, Any],
    job: dict[str, Any],
    job_id: str,
    updated_at: Any,
) -> dict[str, Any]:
    updates = {"updatedAt": updated_at}
    if job.get("mode") == "preview":
        updates["latestCompletedPreviewJobId"] = job_id
        if control.get("activePreviewJobId") == job_id:
            updates["activePreviewJobId"] = None
    else:
        updates["latestEnqueueJobId"] = job_id
        if control.get("activeEnqueueJobId") == job_id:
            updates["activeEnqueueJobId"] = None
    return updates


def completion_notification_id(queue_id: str, generation: int) -> str:
    return f"deep-ai:{queue_id}:g{int(generation)}:completed"


def failure_notification_id(queue_id: str, generation: int) -> str:
    return f"deep-ai:{queue_id}:g{int(generation)}:failed"


def failure_alert_id(queue_id: str, generation: int) -> str:
    return f"deep-ai-failure:{queue_id}:g{int(generation)}"


def build_terminal_side_effects(
    data: dict[str, Any],
    queue_id: str,
    generation: int,
    status: str,
    error: str | None,
    created_at: Any,
) -> dict[str, Any]:
    uid = str(data.get("uid") or "")
    if status == "completed":
        notification_id = completion_notification_id(queue_id, generation)
        title = "Deep AI feedback is ready"
        message = "Your in-depth PTE Write Essay review is ready to view."
    else:
        notification_id = failure_notification_id(queue_id, generation)
        title = "Deep AI review needs attention"
        message = "The local review failed after three model-output attempts. Try Instant AI feedback or ask an admin to retry it."
    effects = {
        "notificationId": notification_id,
        "notification": {
            "uid": uid,
            "queueId": queue_id,
            "attemptId": data.get("attemptId", ""),
            "runGeneration": generation,
            "terminalState": status,
            "title": title,
            "message": message,
            "isRead": False,
            "createdAt": created_at,
            "error": error,
        },
        "alertId": None,
        "alert": None,
    }
    if status == "failed":
        effects["alertId"] = failure_alert_id(queue_id, generation)
        effects["alert"] = {
            "uid": uid,
            "queueId": queue_id,
            "attemptId": data.get("attemptId", ""),
            "runGeneration": generation,
            "severity": "error",
            "message": error or "Deep AI model output failed.",
            "status": "unresolved",
            "resolution": None,
            "createdAt": created_at,
            "resolvedAt": None,
        }
    return effects


def reset_failed_queue_data(data: dict[str, Any], job_id: str, now: datetime) -> dict[str, Any]:
    result = dict(data)
    result.update({
        "status": "pending",
        "runGeneration": int(data.get("runGeneration", 0)) + 1,
        "retryCount": 0,
        "error": None,
        "workerId": None,
        "claimedAt": None,
        "leaseExpiresAt": None,
        "completedAt": None,
        "resultSnapshot": None,
        "isRead": False,
        "resetCount": int(data.get("resetCount", 0)) + 1,
        "lastResetAt": now,
        "lastResetByBackfillJobId": job_id,
    })
    return result


def build_pending_queue_data(payload: dict[str, Any], attempt_id: str, now: datetime) -> dict[str, Any]:
    return {
        "uid": payload["uid"],
        "attemptId": attempt_id,
        "questionId": payload.get("questionId"),
        "essayText": payload["essayText"],
        "promptText": payload["promptText"],
        "status": "pending",
        "submittedAt": now,
        "claimedAt": None,
        "leaseExpiresAt": None,
        "workerId": None,
        "completedAt": None,
        "runGeneration": 0,
        "retryCount": 0,
        "error": None,
        "resetCount": 0,
        "lastResetAt": None,
        "lastResetByBackfillJobId": None,
        "isRead": False,
        "resultSnapshot": None,
    }


def encode_scan_cursor(submitted_at: datetime, attempt_id: str) -> dict[str, str]:
    return {"submittedAt": submitted_at.astimezone(timezone.utc).isoformat(), "attemptId": attempt_id}


def decode_scan_cursor(cursor: dict[str, Any]) -> tuple[datetime, str]:
    return datetime.fromisoformat(str(cursor["submittedAt"]).replace("Z", "+00:00")), str(cursor["attemptId"])


def is_worker_ready(status: dict[str, Any], now: datetime) -> bool:
    heartbeat = status.get("lastHeartbeatAt")
    if isinstance(heartbeat, str):
        try:
            heartbeat = datetime.fromisoformat(heartbeat.replace("Z", "+00:00"))
        except ValueError:
            return False
    if not isinstance(heartbeat, datetime):
        return False
    if heartbeat.tzinfo is None:
        heartbeat = heartbeat.replace(tzinfo=timezone.utc)
    age_seconds = (now - heartbeat).total_seconds()
    return (
        status.get("state") != "stopping"
        and 0 <= age_seconds <= HEARTBEAT_STALE_SECONDS
        and bool(status.get("ollamaReachable"))
        and bool(status.get("modelsReady"))
    )


def set_low_process_priority() -> None:
    try:
        if os.name == "nt":
            import ctypes
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)
        else:
            os.nice(10)
    except Exception as error:  # pragma: no cover
        logging.warning("Could not set low process priority: %s", error)


class WorkerProcessLock:
    def __init__(self, project_id: str, mode: str):
        self.path = Path(tempfile.gettempdir()) / f"bel-essay-ai-worker-{project_id}-{mode}.lock"
        self.handle = None

    def acquire(self) -> bool:
        self.handle = open(self.path, "a+", encoding="utf-8")
        try:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:  # pragma: no cover
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except (OSError, IOError):
            self.handle.close()
            self.handle = None
            return False

    def release(self) -> None:
        if not self.handle:
            return
        try:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:  # pragma: no cover
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()
            self.handle = None


class OllamaClient:
    def __init__(self, url: str = DEFAULT_OLLAMA_URL, mock_path: str | None = None):
        self.url = url
        self.mock = json.loads(Path(mock_path).read_text(encoding="utf-8")) if mock_path else None
        self.mock_index = 0

    def health(self) -> tuple[bool, bool]:
        if self.mock is not None:
            return True, True
        try:
            response = requests.get(self.url.rsplit("/api/", 1)[0] + "/api/tags", timeout=5)
            response.raise_for_status()
            names = {str(item.get("name")) for item in response.json().get("models", [])}
            return True, all(name in names for name in (MODEL_PHASE_1, MODEL_PHASE_2, MODEL_PHASE_3))
        except Exception:
            return False, False

    def generate(self, model: str, prompt: str, system_prompt: str = "", timeout: int = 120) -> str:
        if self.mock is not None:
            phases = self.mock.get("phases", self.mock)
            key = "phase1" if model == MODEL_PHASE_1 else "phase2" if model == MODEL_PHASE_2 else "phase3"
            value = phases.get(key, {}) if isinstance(phases, dict) else {}
            return value if isinstance(value, str) else json.dumps(value)
        payload = {"model": model, "prompt": prompt, "system": system_prompt, "stream": False, "keep_alive": "10s", "options": {"temperature": 0.2}}
        try:
            response = requests.post(self.url, json=payload, timeout=timeout)
        except (requests.exceptions.RequestException, TimeoutError) as error:
            raise ConnectionError(str(error)) from error
        if response.status_code >= 400:
            raise OllamaHttpError(response.status_code, response.text[:500])
        try:
            return str(response.json().get("response", ""))
        except (ValueError, AttributeError) as error:
            raise ModelOutputError("Ollama response was not JSON") from error


def _transactional(transaction_factory: Callable[[], Any], callback: Callable[[Any], Any]) -> Any:
    transaction = transaction_factory()
    try:
        result = callback(transaction)
        transaction.commit()
        return result
    except Exception:
        try:
            transaction.rollback()
        except Exception:
            pass
        raise


class EssayWorker:
    def __init__(self, db: Any, ollama: OllamaClient, worker_id: str | None = None, clock: Callable[[], datetime] = utc_now):
        self.db = db
        self.ollama = ollama
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:12]}"
        self.clock = clock
        self.stop_event = threading.Event()
        self.current_job_id: str | None = None

    def _server_timestamp(self) -> Any:
        return firestore.SERVER_TIMESTAMP if firestore else self.clock()

    def _write_heartbeat(self, state: str, current_job_id: str | None = None, ollama_reachable: bool = True, models_ready: bool = True) -> None:
        self.db.collection("essay_ai_worker_status").document("current").set({
            "workerId": self.worker_id,
            "mode": "production" if os.getenv("ESSAY_WORKER_MODE") == "production" else "emulator",
            "state": state,
            "ollamaReachable": ollama_reachable,
            "modelsReady": models_ready,
            "currentJobId": current_job_id,
            "version": "essay-ai-worker-v1",
            "lastHeartbeatAt": self._server_timestamp(),
        }, merge=True)

    def claim_queue_document(self, document: Any) -> Any | None:
        ref = document.reference
        now = self.clock()
        transaction = self.db.transaction()
        @firestore.transactional
        def claim(tx):
            snapshot = next(iter(tx.get(ref)))
            if not snapshot.exists:
                return None
            data = snapshot.to_dict() or {}
            claimed = claim_document_data(data, self.worker_id, now)
            if claimed is None:
                return None
            tx.set(ref, claimed, merge=True)
            return claimed
        return claim(transaction)

    def _terminal_write(
        self,
        queue_ref: Any,
        expected_generation: int,
        updates: dict[str, Any],
        side_effects: dict[str, Any] | None = None,
    ) -> bool:
        transaction = self.db.transaction()
        @firestore.transactional
        def finish(tx):
            snapshot = next(iter(tx.get(queue_ref)))
            if not snapshot.exists:
                return False
            current = snapshot.to_dict() or {}
            if current.get("workerId") != self.worker_id or int(current.get("runGeneration", 0)) != expected_generation:
                return False
            tx.set(queue_ref, updates, merge=True)
            if side_effects:
                notification_ref = self.db.collection("user_notifications").document(side_effects["notificationId"])
                tx.set(notification_ref, side_effects["notification"])
                if side_effects.get("alertId") and side_effects.get("alert"):
                    alert_ref = self.db.collection("crm_system_alerts").document(side_effects["alertId"])
                    tx.set(alert_ref, side_effects["alert"])
            return True
        return bool(finish(transaction))

    def _run_pipeline(self, data: dict[str, Any]) -> dict[str, Any]:
        rubric = RUBRIC_PATH.read_text(encoding="utf-8") if RUBRIC_PATH.is_file() else "PTE Write Essay standard rubric"
        essay = data.get("essayText", "")
        prompt = data.get("promptText", "")
        p1_raw = self.ollama.generate(MODEL_PHASE_1, f"Score this essay against PTE criteria. Prompt: {prompt[:1000]} Essay: {essay[:4000]} Rubric: {rubric[:3000]}", "You are a strict PTE examiner. Output JSON only.")
        p1 = parse_model_output(p1_raw)
        p2_raw = self.ollama.generate(MODEL_PHASE_2, f"Generate sentence rewrites and vocabulary upgrades for this essay: {essay[:4000]} Diagnostics: {json.dumps(p1.get('scores', {}))[:2000]}", "You are an expert PTE writing coach. Output JSON only.")
        p2 = parse_model_output(p2_raw)
        p3 = self.ollama.generate(MODEL_PHASE_3, f"Write teacher advice from diagnostics and rewrites: {json.dumps(p1.get('scores', {}))[:1500]} {json.dumps(p2)[:1500]}", "You are a warm PTE teacher.")
        return normalize_result_snapshot(p1, p2, p3)

    def process_queue_document(self, document: Any) -> bool:
        self.current_job_id = document.id
        claimed = self.claim_queue_document(document)
        if claimed is None:
            self.current_job_id = None
            return False
        queue_id = document.id
        queue_ref = document.reference
        generation = int(claimed.get("runGeneration", 0))
        retry_count = int(claimed.get("retryCount", 0))
        while retry_count < MAX_RETRIES:
            try:
                result = self._run_pipeline(claimed)
                completed_effects = build_terminal_side_effects(
                    claimed, queue_id, generation, "completed", None, self._server_timestamp()
                )
                if self._terminal_write(queue_ref, generation, {
                    "status": "completed", "completedAt": self._server_timestamp(), "resultSnapshot": result,
                    "isRead": False, "error": None, "claimedAt": None, "leaseExpiresAt": None, "workerId": None,
                }, completed_effects):
                    self.current_job_id = None
                    return True
                self.current_job_id = None
                return False
            except Exception as error:
                if classify_ollama_error(error) == "infrastructure":
                    self._terminal_write(queue_ref, generation, {
                        "status": "pending", "workerId": None, "claimedAt": None, "leaseExpiresAt": None,
                        "error": str(error)[:500],
                    })
                    self._write_heartbeat("degraded", queue_id, False, False)
                    self.current_job_id = None
                    return False
                retry_count += 1
                self._terminal_write(queue_ref, generation, {"retryCount": retry_count, "error": str(error)[:500]})
                if retry_count < MAX_RETRIES:
                    time.sleep(0)
        failure_message = "Model output failed after three retries."
        failed_effects = build_terminal_side_effects(
            claimed, queue_id, generation, "failed", failure_message, self._server_timestamp()
        )
        self._terminal_write(queue_ref, generation, {
            "status": "failed", "error": failure_message,
            "workerId": None, "claimedAt": None, "leaseExpiresAt": None,
        }, failed_effects)
        self.current_job_id = None
        return False

    def _claim_scan_job(self, document: Any) -> dict[str, Any] | None:
        ref = document.reference
        now = self.clock()
        transaction = self.db.transaction()
        @firestore.transactional
        def claim(tx):
            snapshot = next(iter(tx.get(ref)))
            if not snapshot.exists:
                return None
            data = snapshot.to_dict() or {}
            claimed = claim_document_data(data, self.worker_id, now)
            if claimed is None:
                return None
            claimed.setdefault("pageSize", PAGE_SIZE)
            claimed.setdefault("scannedCount", 0)
            claimed.setdefault("candidateCount", 0)
            claimed.setdefault("enqueuedCount", 0)
            claimed.setdefault("skippedCount", 0)
            claimed.setdefault("invalidCount", 0)
            tx.set(ref, claimed, merge=True)
            return claimed
        return claim(transaction)

    @staticmethod
    def _coerce_datetime(value: Any) -> datetime:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return utc_now()

    def _advance_scan_attempt(self, job_ref: Any, attempt_document: Any, job_data: dict[str, Any]) -> bool:
        attempt_id = attempt_document.id
        attempt = attempt_document.to_dict() or {}
        submitted_at = self._coerce_datetime(attempt.get("submittedAt"))
        mode = str(job_data.get("mode") or "preview")
        include_failed = bool(job_data.get("includeFailed"))
        queue_id = None
        queue_ref = None
        payload = None
        try:
            payload = extract_archive_payload(attempt)
            queue_id = compute_queue_id(payload["uid"], attempt_id)
            queue_ref = self.db.collection("essay_ai_queue").document(queue_id)
        except ValueError:
            payload = None

        transaction = self.db.transaction()
        @firestore.transactional
        def advance(tx):
            job_snapshot = next(iter(tx.get(job_ref)))
            if not job_snapshot.exists:
                return False
            current_job = job_snapshot.to_dict() or {}
            now = self.clock()
            lease_update = refresh_scan_lease_data(current_job, self.worker_id, now)
            if lease_update is None:
                return False
            queue_snapshot = next(iter(tx.get(queue_ref))) if queue_ref is not None else None
            updates = {
                "scannedCount": int(current_job.get("scannedCount", 0)) + 1,
                "cursorSubmittedAt": submitted_at,
                "cursorAttemptId": attempt_id,
                **lease_update,
            }
            if payload is None:
                updates["invalidCount"] = int(current_job.get("invalidCount", 0)) + 1
            elif mode == "preview":
                queue_data = queue_snapshot.to_dict() if queue_snapshot and queue_snapshot.exists else None
                eligible = queue_data is None or (include_failed and queue_data.get("status") == "failed")
                key = "candidateCount" if eligible else "skippedCount"
                updates[key] = int(current_job.get(key, 0)) + 1
            else:
                queue_data = queue_snapshot.to_dict() if queue_snapshot and queue_snapshot.exists else None
                if queue_data is None:
                    tx.create(queue_ref, build_pending_queue_data(payload, attempt_id, self.clock()))
                    updates["enqueuedCount"] = int(current_job.get("enqueuedCount", 0)) + 1
                elif queue_data.get("status") == "failed" and include_failed:
                    generation = int(queue_data.get("runGeneration", 0))
                    tx.set(queue_ref, reset_failed_queue_data(queue_data, str(job_ref.id), self.clock()))
                    tx.set(self.db.collection("crm_system_alerts").document(failure_alert_id(queue_id, generation)), {
                        "status": "resolved", "resolution": "retry_started", "resolvedAt": self._server_timestamp()
                    }, merge=True)
                    updates["enqueuedCount"] = int(current_job.get("enqueuedCount", 0)) + 1
                else:
                    updates["skippedCount"] = int(current_job.get("skippedCount", 0)) + 1
            tx.set(job_ref, updates, merge=True)
            return True
        return bool(advance(transaction))

    def process_backfill_job(self, document: Any) -> bool:
        job_data = self._claim_scan_job(document)
        if job_data is None:
            return False
        job_ref = document.reference
        self.current_job_id = document.id
        try:
            cutoff = self._coerce_datetime(job_data.get("scanCutoffAt"))
            while True:
                current_snapshot = job_ref.get()
                if not current_snapshot.exists:
                    return False
                current_job = current_snapshot.to_dict() or {}
                if current_job.get("workerId") != self.worker_id or current_job.get("status") != "processing":
                    return False
                query = self.db.collection("speakingAttempts") \
                    .where("practiceScope", "==", "pte") \
                    .where("canonicalMode", "==", "write_essay") \
                    .where("status", "==", "submitted") \
                    .where("submittedAt", "<=", cutoff) \
                    .order_by("submittedAt") \
                    .order_by(FieldPath.document_id()) \
                    .limit(int(current_job.get("pageSize", PAGE_SIZE)))
                cursor_time = current_job.get("cursorSubmittedAt")
                cursor_id = str(current_job.get("cursorAttemptId") or "")
                if cursor_time and cursor_id:
                    query = query.start_after([self._coerce_datetime(cursor_time), self.db.collection("speakingAttempts").document(cursor_id)])
                documents = list(query.stream())
                if not documents:
                    self._complete_scan_job(job_ref, current_job)
                    break
                for attempt_document in documents:
                    if not self._advance_scan_attempt(job_ref, attempt_document, current_job):
                        raise RuntimeError("Backfill lease was lost while scanning")
            return True
        except Exception as error:
            logging.exception("Backfill job %s failed", document.id)
            self._fail_scan_job(job_ref, str(error)[:500])
            return False
        finally:
            self.current_job_id = None

    def _complete_scan_job(self, job_ref: Any, claimed_data: dict[str, Any]) -> None:
        transaction = self.db.transaction()
        @firestore.transactional
        def finish(tx):
            current_snapshot = next(iter(tx.get(job_ref)))
            control_ref = self.db.collection("essay_ai_backfill_control").document("current")
            control_snapshot = next(iter(tx.get(control_ref)))
            if not current_snapshot.exists:
                return
            current = current_snapshot.to_dict() or {}
            if current.get("workerId") != self.worker_id:
                return
            now = self._server_timestamp()
            tx.set(job_ref, {"status": "completed", "completedAt": now, "workerId": None, "claimedAt": None, "leaseExpiresAt": None}, merge=True)
            control = control_snapshot.to_dict() if control_snapshot.exists else {}
            updates = build_control_completion_updates(control, current, job_ref.id, now)
            tx.set(control_ref, updates, merge=True)
        finish(transaction)

    def _fail_scan_job(self, job_ref: Any, message: str) -> None:
        transaction = self.db.transaction()
        @firestore.transactional
        def fail(tx):
            snapshot = next(iter(tx.get(job_ref)))
            if not snapshot.exists:
                return
            current = snapshot.to_dict() or {}
            if current.get("workerId") != self.worker_id:
                return
            tx.set(job_ref, {"status": "failed", "error": message[:500], "workerId": None, "claimedAt": None, "leaseExpiresAt": None, "completedAt": self._server_timestamp()}, merge=True)
            control_ref = self.db.collection("essay_ai_backfill_control").document("current")
            control_snapshot = next(iter(tx.get(control_ref)))
            control = control_snapshot.to_dict() if control_snapshot.exists else {}
            key = "activePreviewJobId" if current.get("mode") == "preview" else "activeEnqueueJobId"
            if control.get(key) == job_ref.id:
                tx.set(control_ref, {key: None, "updatedAt": self._server_timestamp()}, merge=True)
        fail(transaction)

    def process_backfill_jobs(self) -> int:
        processed = 0
        seen = set()
        for query in (
            self.db.collection("essay_ai_backfill_jobs").where("status", "==", "pending").order_by("createdAt").limit(5),
            self.db.collection("essay_ai_backfill_jobs").where("status", "==", "processing").where("leaseExpiresAt", "<=", self.clock()).order_by("leaseExpiresAt").limit(5),
        ):
            for document in query.stream():
                if document.id in seen:
                    continue
                seen.add(document.id)
                processed += int(self.process_backfill_job(document))
        return processed

    def _heartbeat_loop(self, stop_event: threading.Event | None = None) -> None:
        heartbeat_stop = stop_event or self.stop_event
        while not heartbeat_stop.wait(HEARTBEAT_SECONDS):
            try:
                reachable, ready = self.ollama.health()
                self._write_heartbeat("processing" if self.current_job_id else "idle", self.current_job_id, reachable, ready)
            except Exception as error:  # pragma: no cover
                logging.warning("Heartbeat update failed: %s", error)

    def process_pending_queue(self) -> int:
        queries = [
            self.db.collection("essay_ai_queue").where("status", "==", "pending").order_by("submittedAt").limit(20),
            self.db.collection("essay_ai_queue").where("status", "==", "processing").where("leaseExpiresAt", "<=", self.clock()).order_by("leaseExpiresAt").limit(20),
        ]
        processed = 0
        seen = set()
        for query in queries:
            for document in query.stream():
                if document.id in seen:
                    continue
                seen.add(document.id)
                if self.process_queue_document(document):
                    processed += 1
        return processed

    def run_once(self) -> int:
        reachable, models_ready = self.ollama.health()
        self._write_heartbeat("idle" if reachable and models_ready else "degraded", None, reachable, models_ready)
        if not reachable or not models_ready:
            raise RuntimeConfigurationError("Ollama is unavailable or required models are missing")
        heartbeat_stop = threading.Event()
        heartbeat = threading.Thread(
            target=self._heartbeat_loop,
            args=(heartbeat_stop,),
            name="essay-ai-heartbeat",
            daemon=True,
        )
        heartbeat.start()
        try:
            return self.process_backfill_jobs() + self.process_pending_queue()
        finally:
            heartbeat_stop.set()
            heartbeat.join(timeout=2)
            self._write_heartbeat("idle", None, reachable, models_ready)


def run_worker_loop(worker: Any, single_run: bool, poll_seconds: float = 2.0) -> int:
    processed = 0
    try:
        while not worker.stop_event.is_set():
            processed += int(worker.run_once())
            if single_run or worker.stop_event.wait(max(0.0, poll_seconds)):
                break
        return processed
    finally:
        if hasattr(worker, "_write_heartbeat"):
            worker._write_heartbeat("stopping", None, False, False)


def init_firebase(config: RuntimeConfig):
    if firebase_admin is None:
        raise RuntimeConfigurationError("firebase-admin is required")
    if not firebase_admin._apps:
        if config.mode == "emulator":
            os.environ["FIRESTORE_EMULATOR_HOST"] = config.firestore_emulator_host or DEFAULT_EMULATOR_HOST
            firebase_admin.initialize_app(AnonymousCredentials(), options={"projectId": config.project_id})
        else:
            firebase_admin.initialize_app(credentials.Certificate(config.service_account_path))
    return firestore.client()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lease-safe Deep AI Essay worker")
    parser.add_argument("--single-run", action="store_true")
    parser.add_argument("--production", action="store_true")
    parser.add_argument("--mock-ollama")
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    args = parser.parse_args(argv)
    config = resolve_runtime_config({"production": args.production, "emulator_host": os.getenv("FIRESTORE_EMULATOR_HOST")})
    os.environ["ESSAY_WORKER_MODE"] = config.mode
    lock = WorkerProcessLock(config.project_id, config.mode)
    if not lock.acquire():
        logging.error("Another essay worker is already running for %s/%s", config.project_id, config.mode)
        return 2
    try:
        set_low_process_priority()
        db = init_firebase(config)
        worker = EssayWorker(db, OllamaClient(args.ollama_url, args.mock_ollama))
        run_worker_loop(worker, single_run=args.single_run)
        return 0
    except RuntimeConfigurationError as error:
        logging.error("Worker startup failed: %s", error)
        return 1
    finally:
        lock.release()


if __name__ == "__main__":
    raise SystemExit(main())
