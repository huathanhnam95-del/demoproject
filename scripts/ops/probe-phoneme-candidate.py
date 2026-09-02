"""Probe zero-traffic Cloud Run phoneme-recognizer candidate."""
import concurrent.futures
import datetime
import io
import json
import os
import subprocess
import struct
import sys
import time
import urllib.request
import urllib.error
import wave


def make_wav_bytes(duration_sec=1.0, sample_rate=16000):
    n_samples = int(duration_sec * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        raw = struct.pack(f"<{n_samples}h", *([0] * n_samples))
        wf.writeframes(raw)
    return buf.getvalue()


def get_id_token():
    out = subprocess.check_output(
        ["gcloud", "auth", "print-identity-token"],
        stderr=subprocess.PIPE,
        shell=True,
    )
    return out.decode("utf-8").strip()


def send_multipart_request(url, token, audio_bytes, fields=None):
    boundary = "----WebKitFormBoundary" + str(int(time.time() * 1000))
    body = io.BytesIO()

    # Audio part
    body.write(f"--{boundary}\r\n".encode("utf-8"))
    body.write(b'Content-Disposition: form-data; name="audio"; filename="test.wav"\r\n')
    body.write(b"Content-Type: audio/wav\r\n\r\n")
    body.write(audio_bytes)
    body.write(b"\r\n")

    # Other fields
    if fields:
        for k, v in fields.items():
            body.write(f"--{boundary}\r\n".encode("utf-8"))
            body.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode("utf-8"))
            body.write(str(v).encode("utf-8"))
            body.write(b"\r\n")

    body.write(f"--{boundary}--\r\n".encode("utf-8"))
    data = body.getvalue()

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            duration_ms = round((time.monotonic() - t0) * 1000, 2)
            resp_bytes = resp.read()
            return {
                "status": resp.status,
                "duration_ms": duration_ms,
                "body": json.loads(resp_bytes.decode("utf-8")),
                "error": None,
            }
    except urllib.error.HTTPError as e:
        duration_ms = round((time.monotonic() - t0) * 1000, 2)
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_body)
        except Exception:
            err_json = err_body
        return {
            "status": e.code,
            "duration_ms": duration_ms,
            "body": None,
            "error": err_json,
        }
    except Exception as e:
        duration_ms = round((time.monotonic() - t0) * 1000, 2)
        return {
            "status": 0,
            "duration_ms": duration_ms,
            "body": None,
            "error": str(e),
        }


def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else "https://candfe64e1f5a4a9---phoneme-recognizer-oq3kyypf4q-uc.a.run.app"
    print(f"Targeting: {base_url}")

    token = get_id_token()
    wav_bytes = make_wav_bytes(duration_sec=1.0)

    # 1. Readyz check
    print("Checking /readyz...")
    req_ready = urllib.request.Request(
        f"{base_url}/readyz",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req_ready, timeout=30) as r:
        ready_body = json.loads(r.read().decode("utf-8"))
        print(f"Readyz status: {ready_body}")

    results = []

    # 2. Sequential probe /recognize/v1
    print("Sending sequential request 1 (/recognize/v1)...")
    res1 = send_multipart_request(f"{base_url}/recognize/v1", token, wav_bytes)
    print(f"Seq 1 status: {res1['status']} in {res1['duration_ms']}ms")
    results.append(res1)

    # 3. Sequential probe /recognize/v2
    print("Sending sequential request 2 (/recognize/v2)...")
    res2 = send_multipart_request(
        f"{base_url}/recognize/v2",
        token,
        wav_bytes,
        fields={
            "reference_syllables": json.dumps(["hɛ", "loʊ"]),
            "expected_syllable_count": "2",
            "reference_ipa": "/hɛˈloʊ/",
        },
    )
    print(f"Seq 2 status: {res2['status']} in {res2['duration_ms']}ms")
    results.append(res2)

    # 4. Concurrent burst: 3 simultaneous requests to /recognize/v1
    print("Sending 3 concurrent burst requests to /recognize/v1...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(send_multipart_request, f"{base_url}/recognize/v1", token, wav_bytes)
            for _ in range(3)
        ]
        burst_results = [f.result() for f in futures]

    for i, b in enumerate(burst_results):
        print(f"Burst req {i+1} status: {b['status']} in {b['duration_ms']}ms")
        results.append(b)

    # Compute summary
    statuses = [r["status"] for r in results]
    durations = [r["duration_ms"] for r in results if r["status"] == 200]
    durations.sort()

    p50 = durations[len(durations) // 2] if durations else 0
    p95 = durations[min(int(len(durations) * 0.95), len(durations) - 1)] if durations else 0

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join("test-results", "v4-a2-availability", timestamp)
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "candidate.json")

    report = {
        "timestampUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "candidateUrl": base_url,
        "revision": "phoneme-recognizer-00018-dis",
        "concurrency": 1,
        "totalRequests": len(results),
        "statusCounts": {str(s): statuses.count(s) for s in set(statuses)},
        "latency": {
            "minMs": min(durations) if durations else None,
            "p50Ms": p50,
            "p95Ms": p95,
            "maxMs": max(durations) if durations else None,
        },
        "all200": all(s == 200 for s in statuses),
        "busyCount": statuses.count(503),
        "results": [
            {
                "status": r["status"],
                "duration_ms": r["duration_ms"],
                "has_phonemes": bool(r["body"] and "phonemes" in r["body"]),
                "error": r["error"],
            }
            for r in results
        ],
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\n--- CANDIDATE PROBE REPORT ---")
    print(json.dumps(report, indent=2))
    print(f"\nArtifact written to: {out_file}")


if __name__ == "__main__":
    main()
