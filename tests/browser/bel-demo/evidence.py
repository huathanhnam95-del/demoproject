"""Evidence capture, token redaction, and acceptance reporting for BEL browser tests."""
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

# Robust regex patterns for token and credential redaction
_PATTERNS = [
    # 1. URL Query and Hash parameters: ?token=xyz or &token=xyz or #token=xyz (quoted or unquoted)
    (re.compile(r'([?&#])(token|credential|credentials|secret|auth|apiKey|api_key|password|bearer)=["\']?([^&#\s"\']+)["\']?', re.IGNORECASE), r'\1\2=[REDACTED]'),
    (re.compile(r'(#.*?token=)["\']?([^&#\s"\']+)["\']?', re.IGNORECASE), r'\1[REDACTED]'),
    # 2. Authorization headers (with or without Bearer):
    (re.compile(r'(["\']?)(authorization)\1\s*:\s*(["\']?)(?:bearer\s+)?([a-zA-Z0-9_\-\.]+)\3', re.IGNORECASE), r'\1\2\1: \3Bearer [REDACTED]\3'),
    # 3. Standalone Bearer tokens:
    (re.compile(r'\b(bearer\s+)["\']?([a-zA-Z0-9_\-\.]+)["\']?', re.IGNORECASE), r'\1[REDACTED]'),
    # 4. Channels: bel-local:sessionId:seat:actorId:token or bel-world:sessionId:actorId:token
    (re.compile(r'\b(bel-(?:local|world):[^:\s"\']+:(?:seat:)?[a-zA-Z0-9_-]+:)([a-zA-Z0-9_-]{16,128})\b', re.IGNORECASE), r'\1[REDACTED]'),
    # 5. Key-value pairs in JSON / Python dict / YAML with quotes: "token": "..." or 'token': '...'
    (re.compile(r'(["\']?)(token|credential|credentials|secret|password|auth|apiKey|api_key|ownerToken)\1\s*:\s*(["\'])(.*?)\3', re.IGNORECASE), r'\1\2\1: \3[REDACTED]\3'),
    # 6. Key-value pairs with unquoted / bare values: token: secret
    (re.compile(r'(["\']?)(token|credential|credentials|secret|password|auth|apiKey|api_key|ownerToken)\1\s*:\s*([a-zA-Z0-9_\-\.]+)', re.IGNORECASE), r'\1\2\1: [REDACTED]'),
    # 7. Quoted assignments: token="secret" or token='secret'
    (re.compile(r'\b(token|credential|credentials|secret|password|auth|apiKey|api_key|authorization|ownerToken)\s*=\s*(["\'])(.*?)\2', re.IGNORECASE), r'\1=\2[REDACTED]\2'),
    # 8. Standalone bare assignments: token=abc
    (re.compile(r'\btoken\s*=\s*([a-zA-Z0-9_\-\.]+)', re.IGNORECASE), 'token=[REDACTED]'),
]

def redact_text(text: str) -> str:
    """Strip token=... and session credentials from text, URLs, repr, and logs."""
    if not isinstance(text, str):
        return text
    for pat, rep in _PATTERNS:
        text = pat.sub(rep, text)
    return text

def redact_data(obj: Any) -> Any:
    """Recursively redact tokens and session credentials from dictionaries, lists, and strings."""
    if isinstance(obj, dict):
        cleaned = {}
        for k, v in obj.items():
            k_lower = str(k).lower()
            if k_lower in {'token', 'credentials', 'credential', 'secret', 'password', 'auth', 'apikey', 'api_key', 'authorization', 'ownertoken'}:
                cleaned[k] = '[REDACTED]'
            else:
                cleaned[k] = redact_data(v)
        return cleaned
    elif isinstance(obj, list):
        return [redact_data(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(redact_data(item) for item in obj)
    elif isinstance(obj, set):
        return {redact_data(item) for item in obj}
    elif isinstance(obj, str):
        stripped = obj.strip()
        if (stripped.startswith('{') and stripped.endswith('}')) or (stripped.startswith('[') and stripped.endswith(']')):
            try:
                parsed = json.loads(obj)
                redacted_parsed = redact_data(parsed)
                return json.dumps(redacted_parsed, ensure_ascii=False)
            except Exception:
                pass
        return redact_text(obj)
    return obj



class EvidenceCollector:
    """Manages chrome-events.jsonl, console-errors.jsonl, network-failures.jsonl,

    screenshots (.png), checkpoints (checkpoint-*.json), and acceptance-report.json.
    """

    def __init__(self, evidence_dir: Union[str, Path], session_id: Optional[str] = None):
        self.evidence_dir = Path(evidence_dir).resolve()
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self.session_id = session_id
        self.start_time = time.time()

        self.events_file = self.evidence_dir / 'chrome-events.jsonl'
        self.console_errors_file = self.evidence_dir / 'console-errors.jsonl'
        self.network_failures_file = self.evidence_dir / 'network-failures.jsonl'
        self.report_file = self.evidence_dir / 'acceptance-report.json'

        # Ensure evidence files exist on disk immediately
        self.events_file.touch(exist_ok=True)
        self.console_errors_file.touch(exist_ok=True)
        self.network_failures_file.touch(exist_ok=True)

        self.events: List[Dict[str, Any]] = []
        self.console_errors: List[Dict[str, Any]] = []
        self.network_failures: List[Dict[str, Any]] = []
        self.screenshots: List[str] = []
        self.checkpoints: Dict[str, Dict[str, Any]] = {}
        self.cases: Dict[str, Dict[str, Any]] = {}
        self._attached_pages = set()


    def log_event(self, event: str, actor: Optional[str] = None, **data) -> Dict[str, Any]:
        """Log a redacted event row to chrome-events.jsonl and memory."""
        row = {'time': time.time(), 'event': event}
        if actor is not None:
            row['actor'] = actor
        row.update(data)
        cleaned_row = redact_data(row)
        self.events.append(cleaned_row)

        with self.events_file.open('a', encoding='utf-8') as f:
            f.write(json.dumps(cleaned_row, ensure_ascii=False) + '\n')
        print(f"[{event}] {json.dumps(redact_data(data), ensure_ascii=False)}", flush=True)
        return cleaned_row

    def log(self, event: str, **data) -> Dict[str, Any]:
        """Alias for compatibility with existing Driver.log."""
        actor = data.pop('actor', None)
        return self.log_event(event, actor=actor, **data)

    def log_console_error(
        self,
        actor: str,
        error: str,
        url: Optional[str] = None,
        line: Optional[int] = None
    ) -> Dict[str, Any]:
        """Record an error to console-errors.jsonl with token redaction."""
        record = {
            'time': time.time(),
            'actor': actor,
            'error': redact_text(str(error)),
            'url': redact_text(str(url)) if url else None,
            'line': line
        }
        self.console_errors.append(record)
        with self.console_errors_file.open('a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
        self.log_event('console_error', actor=actor, error=record['error'])
        return record

    def log_network_failure(
        self,
        actor: str,
        url: str,
        status: Optional[int] = None,
        error_text: Optional[str] = None,
        method: str = 'GET'
    ) -> Dict[str, Any]:
        """Record a failed network request to network-failures.jsonl with token redaction."""
        record = {
            'time': time.time(),
            'actor': actor,
            'url': redact_text(url),
            'method': method,
            'status': status,
            'error': redact_text(str(error_text)) if error_text else None
        }
        self.network_failures.append(record)
        with self.network_failures_file.open('a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
        self.log_event('network_failure', actor=actor, url=record['url'], status=status)
        return record

    def shot(self, target: Any, actor: str, name: str) -> Path:
        """Capture a screenshot to {name}.png and record it."""
        name_clean = name[:-4] if name.endswith('.png') else name
        out_path = self.evidence_dir / f"{name_clean}.png"
        page = None
        if hasattr(target, 'screenshot') and callable(target.screenshot):
            page = target
        elif hasattr(target, 'pages') and isinstance(target.pages, dict) and actor in target.pages:
            page = target.pages[actor]

        if page:
            page.screenshot(path=str(out_path))
        else:
            # Touch or write fallback if mock/dummy
            if not out_path.exists():
                out_path.write_bytes(b'')

        if name_clean not in self.screenshots:
            self.screenshots.append(name_clean)
        self.log_event('screenshot', actor=actor, name=name_clean, path=str(out_path.name))
        return out_path

    def checkpoint(self, name: str, states: Dict[str, Any], errors: Optional[List[Any]] = None) -> Path:
        """Save a sanitized checkpoint record to checkpoint-{name}.json."""
        session_ids = set()
        for s in states.values():
            if isinstance(s, dict):
                sid = s.get('session', {}).get('id')
                if sid:
                    session_ids.add(sid)
        same_session = len(session_ids) <= 1

        record = {
            'name': name,
            'time': time.time(),
            'sameSession': same_session,
            'states': redact_data(states),
            'errors': redact_data(errors or [])
        }
        out_path = self.evidence_dir / f"checkpoint-{name}.json"
        out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding='utf-8')
        self.checkpoints[name] = record
        self.log_event('checkpoint', name=name, errors_count=len(errors or []))
        return out_path

    def record_case(
        self,
        case_id: str,
        status: str,
        duration_sec: float = 0.0,
        message: str = "",
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Record acceptance case evaluation result."""
        valid_statuses = {'PASS', 'FAIL', 'SKIPPED', 'BLOCKED'}
        status_norm = status.upper()
        if status_norm not in valid_statuses:
            status_norm = 'FAIL'

        record = {
            'id': case_id,
            'status': status_norm,
            'durationSec': round(duration_sec, 3),
            'message': redact_text(message),
            'metadata': redact_data(metadata or {})
        }
        self.cases[case_id] = record
        self.log_event('case_result', case_id=case_id, status=status_norm, duration=duration_sec)
        return record

    def attach_to_page(self, page: Any, actor: str):
        """Attach error and network monitoring listeners to a Playwright Page."""
        if page is None or id(page) in self._attached_pages:
            return
        self._attached_pages.add(id(page))
        try:
            page.on('pageerror', lambda e: self.log_console_error(actor, str(e)))
        except Exception:
            pass

        try:
            page.on('console', lambda msg: self.log_console_error(actor, msg.text) if getattr(msg, 'type', '') == 'error' else None)
        except Exception:
            pass

        try:
            page.on('requestfailed', lambda req: self.log_network_failure(
                actor, getattr(req, 'url', ''), error_text=str(getattr(req, 'failure', ''))
            ))
        except Exception:
            pass

        try:
            page.on('response', lambda res: self.log_network_failure(
                actor, getattr(res, 'url', ''), status=getattr(res, 'status', 0), error_text=getattr(res, 'status_text', '')
            ) if getattr(res, 'status', 0) >= 400 else None)
        except Exception:
            pass

    def generate_report(self, run_metadata: Optional[Dict[str, Any]] = None) -> Path:
        """Compile and emit acceptance-report.json."""
        end_time = time.time()
        cases_list = list(self.cases.values())
        summary = {
            'total': len(cases_list),
            'passed': sum(1 for c in cases_list if c['status'] == 'PASS'),
            'failed': sum(1 for c in cases_list if c['status'] == 'FAIL'),
            'skipped': sum(1 for c in cases_list if c['status'] == 'SKIPPED'),
            'blocked': sum(1 for c in cases_list if c['status'] == 'BLOCKED'),
            'consoleErrorsCount': len(self.console_errors),
            'networkFailuresCount': len(self.network_failures),
            'checkpointsCount': len(self.checkpoints),
            'screenshotsCount': len(self.screenshots),
            'durationSec': round(end_time - self.start_time, 2)
        }

        report = {
            'version': '1.0.0',
            'sessionId': self.session_id,
            'startTime': self.start_time,
            'endTime': end_time,
            'durationSec': summary['durationSec'],
            'summary': summary,
            'metadata': redact_data(run_metadata or {}),
            'cases': cases_list,
            'checkpoints': list(self.checkpoints.keys()),
            'screenshots': self.screenshots,
            'consoleErrors': self.console_errors,
            'networkFailures': self.network_failures
        }

        self.report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        self.log_event('acceptance_report_generated', path=str(self.report_file.name), summary=summary)
        return self.report_file
