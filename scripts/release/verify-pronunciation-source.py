"""Verify that a Cloud Build image came from the exact committed upload source.

This is a read-only gate. It compares every file in Cloud Build's immutable
source archive with Git objects and the current gcloud upload inventory. It
never extracts archive members to disk.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile


MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_SOURCE_BYTES = 300 * 1024 * 1024
MAX_MEMBERS = 10000


class VerificationError(Exception):
    pass


def run(argv: list[str], *, cwd: Path | None = None) -> bytes:
    executable = shutil.which(argv[0])
    if not executable:
        raise VerificationError(f"Command is unavailable: {argv[0]}")
    result = subprocess.run([executable, *argv[1:]], cwd=cwd, capture_output=True, check=False)
    if result.returncode:
        # Cloud tools may echo sensitive values on failure; report the command only.
        raise VerificationError(f"Command failed: {argv[0]} {argv[1]}")
    return result.stdout


def safe_path(raw: str) -> str:
    if not raw or "\\" in raw or "\x00" in raw or raw.startswith("/"):
        raise VerificationError(f"Unsafe archive path: {raw!r}")
    path = PurePosixPath(raw)
    if any(part in ("", ".", "..") for part in raw.split("/")) or ":" in path.parts[0]:
        raise VerificationError(f"Unsafe archive path: {raw!r}")
    return str(path)


def clean_git_inventory(source_root: Path, source_sha: str) -> set[str]:
    root = Path(os.path.realpath(source_root))
    if not root.is_dir():
        raise VerificationError("Source root does not exist")
    top = Path(os.path.realpath(run(["git", "-C", str(root), "rev-parse", "--show-toplevel"]).decode().strip()))
    if top != root:
        raise VerificationError("Source root must be the Git repository root")
    head = run(["git", "-C", str(root), "rev-parse", "HEAD"]).decode().strip()
    if head != source_sha:
        raise VerificationError("Source root HEAD does not match the build SHA")
    if run(["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"]).strip():
        raise VerificationError("Source root is dirty")
    upload = run(["gcloud", "meta", "list-files-for-upload"], cwd=root).decode().splitlines()
    paths = [safe_path(line.strip().replace("\\", "/")) for line in upload if line.strip()]
    if not paths or len(paths) != len(set(paths)):
        raise VerificationError("Upload inventory is empty or has duplicate paths")
    tracked = set(run(["git", "-C", str(root), "ls-files", "-z"]).decode().split("\x00"))
    if any(path not in tracked for path in paths):
        raise VerificationError("Upload inventory includes noncommitted content")
    return set(paths)


def build_archive(build: dict, *, build_id: str, source_sha: str,
                  image_repository: str, image_digest: str) -> tuple[str, str]:
    expected_name = f"{image_repository}:{source_sha}"
    images = build.get("results", {}).get("images", [])
    if (build.get("id") != build_id or build.get("status") != "SUCCESS"
            or build.get("substitutions", {}).get("_GIT_SHA") != source_sha
            or sum(i.get("name") == expected_name and i.get("digest") == image_digest for i in images) != 1):
        raise VerificationError("Build ID, status, source SHA, image tag, or digest differs")
    source = build.get("source", {}).get("storageSource") or {}
    resolved = build.get("sourceProvenance", {}).get("resolvedStorageSource") or {}
    fields = ("bucket", "object", "generation")
    if not all(source.get(k) and str(source.get(k)) == str(resolved.get(k)) for k in fields):
        raise VerificationError("Build source and resolved immutable archive differ")
    bucket = str(resolved["bucket"])
    object_name = str(resolved["object"])
    generation = str(resolved["generation"])
    if (not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,222}", bucket)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", object_name)
            or ".." in PurePosixPath(object_name).parts
            or not re.fullmatch(r"[0-9]+", generation)):
        raise VerificationError("Build source archive address is invalid")
    uri = f"gs://{bucket}/{object_name}#{generation}"
    file_hashes = build.get("sourceProvenance", {}).get("fileHashes") or {}
    hashes = file_hashes.get(uri, {}).get("fileHash") or []
    sha_values = [item.get("value") for item in hashes if item.get("type") == "SHA256"]
    if len(sha_values) != 1 or not sha_values[0]:
        raise VerificationError("Build record lacks one SHA-256 for the immutable archive")
    return uri, sha_values[0]


def verify_archive(archive_bytes: bytes, archive_hash: str, expected: set[str],
                   source_root: Path, source_sha: str) -> int:
    if not archive_bytes or len(archive_bytes) > MAX_ARCHIVE_BYTES:
        raise VerificationError("Source archive size is outside the allowed range")
    try:
        digest = base64.urlsafe_b64decode(archive_hash + "=" * (-len(archive_hash) % 4))
    except (ValueError, base64.binascii.Error) as error:
        raise VerificationError("Build archive SHA-256 is malformed") from error
    if len(digest) != 32 or hashlib.sha256(archive_bytes).digest() != digest:
        raise VerificationError("Downloaded archive hash differs from Cloud Build provenance")
    seen: set[str] = set()
    total_size = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:*") as archive:
            for index, member in enumerate(archive):
                if index >= MAX_MEMBERS:
                    raise VerificationError("Archive has too many members")
                name = safe_path(member.name.rstrip("/") if member.isdir() else member.name)
                if name in seen:
                    raise VerificationError(f"Duplicate archive path: {name}")
                seen.add(name)
                if member.isdir():
                    if not any(p.startswith(name + "/") for p in expected):
                        raise VerificationError(f"Unexpected archive directory: {name}")
                    continue
                if not member.isfile() or name not in expected:
                    raise VerificationError(f"Unsafe or unexpected archive member: {name}")
                total_size += member.size
                if total_size > MAX_SOURCE_BYTES:
                    raise VerificationError("Archive expands beyond the allowed source size")
                stream = archive.extractfile(member)
                if stream is None:
                    raise VerificationError(f"Could not read archive member: {name}")
                actual = stream.read()
                committed = run(["git", "-C", str(source_root), "show", f"{source_sha}:{name}"])
                if actual != committed:
                    raise VerificationError(f"Archive content differs from commit: {name}")
    except tarfile.TarError as error:
        raise VerificationError("Cloud Build source is not a valid tar archive") from error
    missing = expected - seen
    if missing:
        raise VerificationError(f"Archive is missing {len(missing)} committed upload files")
    return len(expected)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--build-id", required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--image-repository", required=True)
    parser.add_argument("--digest", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.sha) or not re.fullmatch(r"sha256:[0-9a-f]{64}", args.digest):
        raise VerificationError("Commit SHA or image digest is malformed")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", args.build_id):
        raise VerificationError("Cloud Build ID is malformed")
    expected = clean_git_inventory(args.source_root, args.sha)
    build = json.loads(run(["gcloud", "builds", "describe", args.build_id,
                            f"--project={args.project}", "--format=json"]))
    uri, archive_hash = build_archive(build, build_id=args.build_id,
                                      source_sha=args.sha, image_repository=args.image_repository,
                                      image_digest=args.digest)
    with tempfile.TemporaryDirectory(prefix="pronunciation-source-proof-") as temp:
        archive_path = Path(temp) / "source.tgz"
        run(["gcloud", "storage", "cp", uri, str(archive_path), "--quiet"])
        count = verify_archive(archive_path.read_bytes(), archive_hash, expected,
                               args.source_root, args.sha)
    print(f"Verified build {args.build_id}: {count} committed upload files, immutable archive, image {args.digest}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (VerificationError, OSError, json.JSONDecodeError) as error:
        print(f"Source verification failed: {error}", file=sys.stderr)
        sys.exit(1)
