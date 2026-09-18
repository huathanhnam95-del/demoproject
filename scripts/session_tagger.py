#!/usr/bin/env python3
"""
scripts/session_tagger.py

Manages production deployment and readiness markers for Google Antigravity chat session titles.
Convention:
- When user indicates readiness for deployment ("R4D"), tag title with prefix '(R) '.
- When a session ends with a production deployment ("PAR" / release), tag title with prefix '(D) '.
- When a conversation continues/resumes and is answered, remove prefix '(D) '.

Usage:
  python scripts/session_tagger.py mark-ready [--cid <conversation_id>]
  python scripts/session_tagger.py remove-ready [--cid <conversation_id>]
  python scripts/session_tagger.py list-ready
  python scripts/session_tagger.py mark-deployed [--cid <conversation_id>]
  python scripts/session_tagger.py remove-deployed [--cid <conversation_id>]
  python scripts/session_tagger.py list-deployed
  python scripts/session_tagger.py status [--cid <conversation_id>]
"""

import argparse
import glob
import json
import os
import re
import shutil
import sqlite3
import ssl
import subprocess
import sys
import urllib.error
import urllib.request

DEFAULT_PB_PATH = os.path.expanduser(r"~\.gemini\antigravity\agyhub_summaries_proto.pb")
DEFAULT_CONV_DIR = os.path.expanduser(r"~\.gemini\antigravity\conversations")
DEFAULT_ANNOTATIONS_DIR = os.path.expanduser(r"~\.gemini\antigravity\annotations")
DEFAULT_SUMMARIES_DB = os.path.expanduser(r"~\.gemini\antigravity\conversation_summaries.db")
DEFAULT_BRAIN_DIR = os.path.expanduser(r"~\.gemini\antigravity\brain")
DEFAULT_TASK_TRACKER = os.path.join(r"c:\Cursor AI", "TASK_TRACKER.csv")


def encode_varint(val: int) -> bytes:
    b = bytearray()
    while True:
        to_write = val & 0x7F
        val >>= 7
        if val:
            b.append(to_write | 0x80)
        else:
            b.append(to_write)
            break
    return bytes(b)


def parse_raw_fields(buf: bytes):
    offset = 0
    fields = []
    buf_len = len(buf)
    while offset < buf_len:
        tag_wire = 0
        shift = 0
        while True:
            if offset >= buf_len:
                break
            b = buf[offset]
            offset += 1
            tag_wire |= (b & 0x7F) << shift
            if not (b & 0x80):
                break
            shift += 7
        wire_type = tag_wire & 7
        field_num = tag_wire >> 3
        if wire_type == 2:  # length delimited
            length = 0
            shift = 0
            while True:
                if offset >= buf_len:
                    break
                b = buf[offset]
                offset += 1
                length |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            val = buf[offset : offset + length]
            fields.append((field_num, wire_type, val))
            offset += length
        elif wire_type == 0:  # varint
            val = 0
            shift = 0
            while True:
                if offset >= buf_len:
                    break
                b = buf[offset]
                offset += 1
                val |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            fields.append((field_num, wire_type, val))
        elif wire_type == 1:  # 64-bit
            val = buf[offset : offset + 8]
            fields.append((field_num, wire_type, val))
            offset += 8
        elif wire_type == 5:  # 32-bit
            val = buf[offset : offset + 4]
            fields.append((field_num, wire_type, val))
            offset += 4
        else:
            raise ValueError(f"Unsupported wire type {wire_type} at offset {offset}")
    return fields


def serialize_raw_fields(fields) -> bytes:
    out = bytearray()
    for field_num, wire_type, val in fields:
        tag_wire = (field_num << 3) | wire_type
        out.extend(encode_varint(tag_wire))
        if wire_type == 0:
            out.extend(encode_varint(val))
        elif wire_type == 2:
            out.extend(encode_varint(len(val)))
            out.extend(val)
        elif wire_type in (1, 5):
            out.extend(val)
    return bytes(out)


def resolve_active_cid(conv_dir: str = DEFAULT_CONV_DIR) -> str:
    env_cid = os.environ.get("ANTIGRAVITY_CONVERSATION_ID")
    if env_cid:
        return env_cid.strip()

    pattern = os.path.join(conv_dir, "*.db")
    db_files = [f for f in glob.glob(pattern) if not f.endswith("-wal") and not f.endswith("-shm")]
    if not db_files:
        raise FileNotFoundError(f"No conversation database files found in {conv_dir}")

    db_files.sort(key=os.path.getmtime, reverse=True)
    latest_file = db_files[0]
    cid = os.path.splitext(os.path.basename(latest_file))[0]
    return cid


_LS_INFO_CACHE = None


def get_ls_server_info(use_cache: bool = True):
    """Discover running language_server.exe CSRF token and local ports."""
    global _LS_INFO_CACHE
    if use_cache and _LS_INFO_CACHE is not None:
        return _LS_INFO_CACHE

    cmd_cli = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name like \'%language_server%\'\\").CommandLine"'
    try:
        res = subprocess.run(cmd_cli, shell=True, capture_output=True, text=True, timeout=5)
        out = res.stdout.strip()
    except Exception:
        out = ""

    if not out:
        return None, []

    csrf_match = re.search(r"--csrf_token(?:=|\s+)([^\s]+)", out)
    csrf = csrf_match.group(1) if csrf_match else None

    cmd_pid = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name like \'%language_server%\'\\").ProcessId"'
    try:
        res_pid = subprocess.run(cmd_pid, shell=True, capture_output=True, text=True, timeout=5)
        pids = [p.strip() for p in res_pid.stdout.strip().split() if p.strip().isdigit()]
    except Exception:
        pids = []

    ports = []
    if pids:
        cmd_ports = f"powershell -NoProfile -Command \"Get-NetTCPConnection -OwningProcess {pids[0]} | Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -ExpandProperty LocalPort\""
        try:
            res_ports = subprocess.run(cmd_ports, shell=True, capture_output=True, text=True, timeout=5)
            for line in res_ports.stdout.strip().split():
                if line.strip().isdigit():
                    p = int(line.strip())
                    if p not in ports:
                        ports.append(p)
        except Exception:
            pass

    if csrf and ports:
        _LS_INFO_CACHE = (csrf, ports)
    return csrf, ports


def update_via_rpc(cid: str, new_title: str) -> bool:
    """Call language_server UpdateConversationAnnotations RPC."""
    csrf, ports = get_ls_server_info()
    if not csrf or not ports:
        return False

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    headers = {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrf,
    }
    body = {
        "cascadeId": cid,
        "annotations": {
            "title": new_title,
        },
    }
    payload = json.dumps(body).encode("utf-8")

    for port in ports:
        for scheme in ("http", "https"):
            url = f"{scheme}://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/UpdateConversationAnnotations"
            try:
                req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
                res = urllib.request.urlopen(req, context=ctx, timeout=3)
                if res.status == 200:
                    return True
            except Exception:
                continue
    return False


def get_session_title(
    cid: str,
    pb_path: str = DEFAULT_PB_PATH,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
):
    # 1. Check annotation file first (explicit custom title overrides summary)
    annot_file = os.path.join(annotations_dir, f"{cid}.pbtxt")
    if os.path.exists(annot_file):
        try:
            with open(annot_file, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            m = re.search(r'title\s*:\s*"((?:[^"\\]|\\.)*)"', content)
            if m:
                raw_t = m.group(1)
                unescaped = raw_t.replace(r'\"', '"').replace(r'\\', '\\')
                if unescaped:
                    return unescaped
        except Exception:
            pass

    # 2. Check protobuf summaries
    if os.path.exists(pb_path):
        try:
            with open(pb_path, "rb") as f:
                data = f.read()

            root_fields = parse_raw_fields(data)
            cid_bytes = cid.encode("utf-8")
            for _, _, conv_bytes in root_fields:
                if isinstance(conv_bytes, bytes) and cid_bytes in conv_bytes:
                    conv_fields = parse_raw_fields(conv_bytes)
                    is_match = any(fnum == 1 and sval == cid_bytes for fnum, _, sval in conv_fields)
                    if is_match:
                        for f2num, _, summary_val in conv_fields:
                            if f2num == 2 and isinstance(summary_val, bytes):
                                sfields = parse_raw_fields(summary_val)
                                for sfnum, _, title_val in sfields:
                                    if sfnum == 1 and isinstance(title_val, bytes):
                                        return title_val.decode("utf-8", errors="ignore")
        except Exception:
            pass

    # 3. Check conversation_summaries.db
    if os.path.exists(summaries_db):
        try:
            con = sqlite3.connect(summaries_db)
            cur = con.cursor()
            row = cur.execute(
                "SELECT title, preview FROM conversation_summaries WHERE conversation_id=?;",
                (cid,),
            ).fetchone()
            con.close()
            if row:
                if row[0]:
                    return row[0]
                if row[1]:
                    return row[1]
        except Exception:
            pass

    return None


def update_pb_title(cid: str, new_title: str, pb_path: str = DEFAULT_PB_PATH) -> bool:
    if not os.path.exists(pb_path):
        return False
    with open(pb_path, "rb") as f:
        data = f.read()

    root_fields = parse_raw_fields(data)
    cid_bytes = cid.encode("utf-8")
    found = False
    new_root_fields = []

    for fnum, wtype, conv_bytes in root_fields:
        if isinstance(conv_bytes, bytes) and cid_bytes in conv_bytes:
            conv_fields = parse_raw_fields(conv_bytes)
            is_match = any(cfnum == 1 and cfval == cid_bytes for cfnum, _, cfval in conv_fields)
            if is_match:
                new_conv_fields = []
                for cfnum, cfwtype, cfval in conv_fields:
                    if cfnum == 2 and isinstance(cfval, bytes):
                        summary_fields = parse_raw_fields(cfval)
                        new_summary_fields = []
                        for sfnum, sfwtype, sfval in summary_fields:
                            if sfnum == 1:
                                new_summary_fields.append((sfnum, sfwtype, new_title.encode("utf-8")))
                            else:
                                new_summary_fields.append((sfnum, sfwtype, sfval))
                        new_conv_fields.append((cfnum, cfwtype, serialize_raw_fields(new_summary_fields)))
                    else:
                        new_conv_fields.append((cfnum, cfwtype, cfval))
                new_root_fields.append((fnum, wtype, serialize_raw_fields(new_conv_fields)))
                found = True
                continue
        new_root_fields.append((fnum, wtype, conv_bytes))

    if found:
        new_data = serialize_raw_fields(new_root_fields)
        tmp_path = pb_path + ".tmp"
        with open(tmp_path, "wb") as f:
            f.write(new_data)
        shutil.move(tmp_path, pb_path)
        return True
    return False


def update_annotation_file(cid: str, new_title: str, annotations_dir: str = DEFAULT_ANNOTATIONS_DIR):
    os.makedirs(annotations_dir, exist_ok=True)
    annot_file = os.path.join(annotations_dir, f"{cid}.pbtxt")
    content = ""
    if os.path.exists(annot_file):
        try:
            with open(annot_file, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            pass

    escaped_title = new_title.replace("\\", "\\\\").replace('"', '\\"')

    if re.search(r'title\s*:\s*"(?:[^"\\]|\\.)*"', content):
        content = re.sub(
            r'title\s*:\s*"(?:[^"\\]|\\.)*"',
            lambda _: f'title:"{escaped_title}"',
            content,
        )
    else:
        content = f'title:"{escaped_title}" {content}'.strip()

    try:
        with open(annot_file, "w", encoding="utf-8") as f:
            f.write(content + "\n")
        return True
    except Exception:
        return False


def sync_db_title(cid: str, old_title: str, new_title: str, conv_dir: str = DEFAULT_CONV_DIR):
    db_path = os.path.join(conv_dir, f"{cid}.db")
    if not os.path.exists(db_path):
        return
    try:
        con = sqlite3.connect(db_path)
        cur = con.cursor()
        rows = cur.execute("SELECT idx, step_payload FROM steps WHERE idx=1;").fetchall()
        for idx, payload in rows:
            if payload and old_title.encode("utf-8") in payload:
                new_payload = payload.replace(old_title.encode("utf-8"), new_title.encode("utf-8"))
                cur.execute("UPDATE steps SET step_payload=? WHERE idx=?;", (new_payload, idx))
                con.commit()
        con.close()
    except Exception:
        pass


def sync_summaries_db_title(cid: str, new_title: str, db_path: str = DEFAULT_SUMMARIES_DB) -> bool:
    if not os.path.exists(db_path):
        return False
    try:
        con = sqlite3.connect(db_path)
        cur = con.cursor()
        row = cur.execute(
            "SELECT title, preview FROM conversation_summaries WHERE conversation_id=?;",
            (cid,),
        ).fetchone()
        if not row:
            con.close()
            return False
        cur_title, cur_preview = row
        new_preview = cur_preview
        if new_title.startswith("(D) "):
            # marking deployed
            if cur_preview:
                clean_prev = re.sub(r"^\((?:D|R)\)\s*", "", cur_preview)
                if not cur_title or cur_title == cur_preview or cur_preview.startswith("(R) "):
                    new_preview = f"(D) {clean_prev}"
        elif new_title.startswith("(R) "):
            # marking ready
            if cur_preview:
                clean_prev = re.sub(r"^\((?:D|R)\)\s*", "", cur_preview)
                if not cur_title or cur_title == cur_preview or cur_preview.startswith("(D) "):
                    new_preview = f"(R) {clean_prev}"
        else:
            # removing prefix
            if cur_preview and re.match(r"^\((?:D|R)\)\s*", cur_preview):
                new_preview = re.sub(r"^\((?:D|R)\)\s*", "", cur_preview)

        cur.execute(
            "UPDATE conversation_summaries SET title=?, preview=? WHERE conversation_id=?;",
            (new_title, new_preview if new_preview is not None else new_title, cid),
        )
        con.commit()
        con.close()
        return True
    except Exception:
        return False


def mark_deployed(
    cid: str,
    pb_path: str = DEFAULT_PB_PATH,
    conv_dir: str = DEFAULT_CONV_DIR,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
):
    title = get_session_title(cid, pb_path=pb_path, annotations_dir=annotations_dir, summaries_db=summaries_db)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}

    if title.startswith("(D) "):
        return {
            "status": "noop",
            "message": "Already marked as deployed.",
            "cid": cid,
            "title": title,
            "is_deployed": True,
            "is_ready": False,
        }

    clean_title = re.sub(r"^\((?:D|R)\)\s*", "", title).strip()
    new_title = f"(D) {clean_title}"
    rpc_ok = update_via_rpc(cid, new_title)
    pb_ok = update_pb_title(cid, new_title, pb_path=pb_path)
    annot_ok = update_annotation_file(cid, new_title, annotations_dir=annotations_dir)
    sync_db_title(cid, title, new_title, conv_dir=conv_dir)
    sum_ok = sync_summaries_db_title(cid, new_title, db_path=summaries_db)

    if rpc_ok or pb_ok or annot_ok or sum_ok:
        return {
            "status": "success",
            "action": "marked_deployed",
            "cid": cid,
            "old_title": title,
            "new_title": new_title,
            "is_deployed": True,
            "is_ready": False,
            "method": "rpc" if rpc_ok else "disk",
        }
    return {"status": "error", "message": "Failed to update title via RPC or disk."}


def remove_deployed(
    cid: str,
    pb_path: str = DEFAULT_PB_PATH,
    conv_dir: str = DEFAULT_CONV_DIR,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
):
    title = get_session_title(cid, pb_path=pb_path, annotations_dir=annotations_dir, summaries_db=summaries_db)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}

    match = re.match(r"^\(D\)\s*", title)
    if not match:
        return {
            "status": "noop",
            "message": "Title is not currently marked with (D).",
            "cid": cid,
            "title": title,
            "is_deployed": False,
            "is_ready": bool(re.match(r"^\(R\)\s*", title)),
        }

    new_title = title[match.end() :].strip()
    rpc_ok = update_via_rpc(cid, new_title)
    pb_ok = update_pb_title(cid, new_title, pb_path=pb_path)
    annot_ok = update_annotation_file(cid, new_title, annotations_dir=annotations_dir)
    sync_db_title(cid, title, new_title, conv_dir=conv_dir)
    sum_ok = sync_summaries_db_title(cid, new_title, db_path=summaries_db)

    if rpc_ok or pb_ok or annot_ok or sum_ok:
        return {
            "status": "success",
            "action": "removed_deployed",
            "cid": cid,
            "old_title": title,
            "new_title": new_title,
            "is_deployed": False,
            "is_ready": bool(re.match(r"^\(R\)\s*", new_title)),
            "method": "rpc" if rpc_ok else "disk",
        }
    return {"status": "error", "message": "Failed to update title via RPC or disk."}


def mark_ready(
    cid: str,
    pb_path: str = DEFAULT_PB_PATH,
    conv_dir: str = DEFAULT_CONV_DIR,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
):
    title = get_session_title(cid, pb_path=pb_path, annotations_dir=annotations_dir, summaries_db=summaries_db)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}

    if title.startswith("(R) "):
        return {
            "status": "noop",
            "message": "Already marked as ready for deployment.",
            "cid": cid,
            "title": title,
            "is_ready": True,
            "is_deployed": False,
        }

    clean_title = re.sub(r"^\((?:D|R)\)\s*", "", title).strip()
    new_title = f"(R) {clean_title}"
    rpc_ok = update_via_rpc(cid, new_title)
    pb_ok = update_pb_title(cid, new_title, pb_path=pb_path)
    annot_ok = update_annotation_file(cid, new_title, annotations_dir=annotations_dir)
    sync_db_title(cid, title, new_title, conv_dir=conv_dir)
    sum_ok = sync_summaries_db_title(cid, new_title, db_path=summaries_db)

    if rpc_ok or pb_ok or annot_ok or sum_ok:
        return {
            "status": "success",
            "action": "marked_ready",
            "cid": cid,
            "old_title": title,
            "new_title": new_title,
            "is_ready": True,
            "is_deployed": False,
            "method": "rpc" if rpc_ok else "disk",
        }
    return {"status": "error", "message": "Failed to update title via RPC or disk."}


def remove_ready(
    cid: str,
    pb_path: str = DEFAULT_PB_PATH,
    conv_dir: str = DEFAULT_CONV_DIR,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
):
    title = get_session_title(cid, pb_path=pb_path, annotations_dir=annotations_dir, summaries_db=summaries_db)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}

    match = re.match(r"^\(R\)\s*", title)
    if not match:
        return {
            "status": "noop",
            "message": "Title is not currently marked with (R).",
            "cid": cid,
            "title": title,
            "is_ready": False,
            "is_deployed": bool(re.match(r"^\(D\)\s*", title)),
        }

    new_title = title[match.end() :].strip()
    rpc_ok = update_via_rpc(cid, new_title)
    pb_ok = update_pb_title(cid, new_title, pb_path=pb_path)
    annot_ok = update_annotation_file(cid, new_title, annotations_dir=annotations_dir)
    sync_db_title(cid, title, new_title, conv_dir=conv_dir)
    sum_ok = sync_summaries_db_title(cid, new_title, db_path=summaries_db)

    if rpc_ok or pb_ok or annot_ok or sum_ok:
        return {
            "status": "success",
            "action": "removed_ready",
            "cid": cid,
            "old_title": title,
            "new_title": new_title,
            "is_ready": False,
            "is_deployed": bool(re.match(r"^\(D\)\s*", new_title)),
            "method": "rpc" if rpc_ok else "disk",
        }
    return {"status": "error", "message": "Failed to update title via RPC or disk."}


def get_status(
    cid: str,
    pb_path: str = DEFAULT_PB_PATH,
    conv_dir: str = DEFAULT_CONV_DIR,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
    **kwargs,
):
    title = get_session_title(cid, pb_path=pb_path, annotations_dir=annotations_dir, summaries_db=summaries_db)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}
    return {
        "status": "ok",
        "cid": cid,
        "title": title,
        "is_deployed": bool(re.match(r"^\(D\)\s*", title)),
        "is_ready": bool(re.match(r"^\(R\)\s*", title)),
    }


def list_ready(
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    pb_path: str = DEFAULT_PB_PATH,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
):
    """List all conversations marked with (R)."""
    ready = []
    seen = set()

    pattern = os.path.join(annotations_dir, "*.pbtxt")
    for f in glob.glob(pattern):
        try:
            with open(f, "r", encoding="utf-8", errors="ignore") as fp:
                content = fp.read()
            m = re.search(r'title\s*:\s*"((?:[^"\\]|\\.)*)"', content)
            if m:
                raw_t = m.group(1)
                t = raw_t.replace(r'\"', '"').replace(r'\\', '\\')
                if re.match(r"^\(R\)\s*", t):
                    cid = os.path.splitext(os.path.basename(f))[0]
                    ready.append({"cid": cid, "title": t, "source": "annotation"})
                    seen.add(cid)
        except Exception:
            pass

    if os.path.exists(pb_path):
        try:
            with open(pb_path, "rb") as f:
                data = f.read()
            root_fields = parse_raw_fields(data)
            for _, _, conv_bytes in root_fields:
                if isinstance(conv_bytes, bytes):
                    conv_fields = parse_raw_fields(conv_bytes)
                    cid_val = None
                    for fnum, _, val in conv_fields:
                        if fnum == 1 and isinstance(val, bytes):
                            cid_val = val.decode("utf-8", errors="ignore")
                    if cid_val and cid_val not in seen:
                        for fnum, _, val in conv_fields:
                            if fnum == 2 and isinstance(val, bytes):
                                sfields = parse_raw_fields(val)
                                for sfnum, _, tval in sfields:
                                    if sfnum == 1 and isinstance(tval, bytes):
                                        title_str = tval.decode("utf-8", errors="ignore")
                                        if re.match(r"^\(R\)\s*", title_str):
                                            ready.append({"cid": cid_val, "title": title_str, "source": "proto"})
                                            seen.add(cid_val)
        except Exception:
            pass

    if os.path.exists(summaries_db):
        try:
            con = sqlite3.connect(summaries_db)
            cur = con.cursor()
            rows = cur.execute(
                "SELECT conversation_id, title, preview FROM conversation_summaries WHERE title LIKE '(R)%' OR preview LIKE '(R)%';"
            ).fetchall()
            con.close()
            for cid_val, t, prev in rows:
                if cid_val not in seen:
                    title_str = t or prev
                    ready.append({"cid": cid_val, "title": title_str, "source": "summaries_db"})
                    seen.add(cid_val)
        except Exception:
            pass

    return ready



def list_deployed(
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    pb_path: str = DEFAULT_PB_PATH,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
):
    """List all conversations marked with (D)."""
    deployed = []
    seen = set()

    pattern = os.path.join(annotations_dir, "*.pbtxt")
    for f in glob.glob(pattern):
        try:
            with open(f, "r", encoding="utf-8", errors="ignore") as fp:
                content = fp.read()
            m = re.search(r'title\s*:\s*"((?:[^"\\]|\\.)*)"', content)
            if m:
                raw_t = m.group(1)
                t = raw_t.replace(r'\"', '"').replace(r'\\', '\\')
                if re.match(r"^\(D\)\s*", t):
                    cid = os.path.splitext(os.path.basename(f))[0]
                    deployed.append({"cid": cid, "title": t, "source": "annotation"})
                    seen.add(cid)
        except Exception:
            pass

    if os.path.exists(pb_path):
        try:
            with open(pb_path, "rb") as f:
                data = f.read()
            root_fields = parse_raw_fields(data)
            for _, _, conv_bytes in root_fields:
                if isinstance(conv_bytes, bytes):
                    conv_fields = parse_raw_fields(conv_bytes)
                    cid_val = None
                    for fnum, _, val in conv_fields:
                        if fnum == 1 and isinstance(val, bytes):
                            cid_val = val.decode("utf-8", errors="ignore")
                    if cid_val and cid_val not in seen:
                        for fnum, _, val in conv_fields:
                            if fnum == 2 and isinstance(val, bytes):
                                sfields = parse_raw_fields(val)
                                for sfnum, _, tval in sfields:
                                    if sfnum == 1 and isinstance(tval, bytes):
                                        title_str = tval.decode("utf-8", errors="ignore")
                                        if re.match(r"^\(D\)\s*", title_str):
                                            deployed.append({"cid": cid_val, "title": title_str, "source": "proto"})
                                            seen.add(cid_val)
        except Exception:
            pass

    if os.path.exists(summaries_db):
        try:
            con = sqlite3.connect(summaries_db)
            cur = con.cursor()
            rows = cur.execute(
                "SELECT conversation_id, title, preview FROM conversation_summaries WHERE title LIKE '(D)%' OR preview LIKE '(D)%';"
            ).fetchall()
            con.close()
            for cid_val, t, prev in rows:
                if cid_val not in seen:
                    title_str = t or prev
                    deployed.append({"cid": cid_val, "title": title_str, "source": "summaries_db"})
                    seen.add(cid_val)
        except Exception:
            pass

    return deployed


def search_sessions(
    query: str,
    limit: int = 25,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
    pb_path: str = DEFAULT_PB_PATH,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
):
    """Search for sessions matching query by title, preview, or CID."""
    results = []
    seen = set()
    query = (query or "").strip()
    if not query:
        return []
    q_lower = query.lower()

    if os.path.exists(summaries_db):
        try:
            con = sqlite3.connect(summaries_db)
            cur = con.cursor()
            # 1. Exact substring match first
            like_pat = f"%{query}%"
            rows = cur.execute(
                """
                SELECT conversation_id, title, preview, last_modified_time
                FROM conversation_summaries
                WHERE (conversation_id LIKE ? OR title LIKE ? OR preview LIKE ?)
                ORDER BY last_modified_time DESC
                LIMIT ?;
                """,
                (like_pat, like_pat, like_pat, limit * 2),
            ).fetchall()

            # 2. Multi-token match if exact substring yielded fewer than limit
            tokens = [t for t in re.split(r"\W+", query) if len(t) >= 2]
            if len(rows) < limit and len(tokens) > 1:
                where_clauses = []
                params = []
                for tok in tokens:
                    p = f"%{tok}%"
                    where_clauses.append("(conversation_id LIKE ? OR title LIKE ? OR preview LIKE ?)")
                    params.extend([p, p, p])
                where_sql = " AND ".join(where_clauses)
                params.append(limit * 2)
                more_rows = cur.execute(
                    f"""
                    SELECT conversation_id, title, preview, last_modified_time
                    FROM conversation_summaries
                    WHERE {where_sql}
                    ORDER BY last_modified_time DESC
                    LIMIT ?;
                    """,
                    params,
                ).fetchall()
                existing_cids = {r[0] for r in rows}
                for mr in more_rows:
                    if mr[0] not in existing_cids:
                        rows.append(mr)

            con.close()
            for cid, t_col, prev_col, lmt in rows:
                if cid not in seen:
                    effective_title = (
                        get_session_title(
                            cid,
                            pb_path=pb_path,
                            annotations_dir=annotations_dir,
                            summaries_db=summaries_db,
                        )
                        or t_col
                        or prev_col
                        or ""
                    )
                    results.append(
                        {
                            "cid": cid,
                            "title": effective_title,
                            "is_deployed": bool(re.match(r"^\(D\)\s*", effective_title)),
                            "is_ready": bool(re.match(r"^\(R\)\s*", effective_title)),
                            "last_modified": lmt,
                        }
                    )
                    seen.add(cid)
        except Exception:
            pass

    if len(results) < limit and os.path.exists(annotations_dir):
        pattern = os.path.join(annotations_dir, "*.pbtxt")
        tokens = [t.lower() for t in re.split(r"\W+", query) if len(t) >= 2]
        for f in glob.glob(pattern):
            cid = os.path.splitext(os.path.basename(f))[0]
            if cid in seen:
                continue
            try:
                with open(f, "r", encoding="utf-8", errors="ignore") as fp:
                    content = fp.read()
                m = re.search(r'title\s*:\s*"((?:[^"\\]|\\.)*)"', content)
                if m:
                    raw_t = m.group(1)
                    t = raw_t.replace(r'\"', '"').replace(r'\\', '\\')
                    t_lower = t.lower()
                    cid_lower = cid.lower()
                    if q_lower in t_lower or q_lower in cid_lower or (tokens and all(tok in t_lower or tok in cid_lower for tok in tokens)):
                        results.append(
                            {
                                "cid": cid,
                                "title": t,
                                "is_deployed": bool(re.match(r"^\(D\)\s*", t)),
                                "is_ready": bool(re.match(r"^\(R\)\s*", t)),
                                "last_modified": None,
                            }
                        )
                        seen.add(cid)
            except Exception:
                pass

    return results[:limit]


def trace_deploy_sessions(
    tasks=None,
    keywords=None,
    cids=None,
    deploy_cid=None,
    include_ready: bool = True,
    summaries_db: str = DEFAULT_SUMMARIES_DB,
    pb_path: str = DEFAULT_PB_PATH,
    conv_dir: str = DEFAULT_CONV_DIR,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    brain_dir: str = DEFAULT_BRAIN_DIR,
    task_tracker_path: str = DEFAULT_TASK_TRACKER,
):
    """
    Traces back to origin development sessions by task IDs, keywords, or CIDs,
    and marks them (plus deploy_cid and any readied sessions) with (D) .
    """
    to_mark = []
    seen_cids = set()

    # Default to current active conversation if deploy_cid not provided
    if not deploy_cid:
        try:
            deploy_cid = resolve_active_cid(conv_dir)
        except Exception:
            deploy_cid = None

    task_set = set(str(t).strip() for t in (tasks or []))

    # 0. Include all readied sessions (R)
    if include_ready:
        ready_sessions = list_ready(
            annotations_dir=annotations_dir,
            pb_path=pb_path,
            summaries_db=summaries_db,
        )
        for rs in ready_sessions:
            rcid = rs["cid"]
            if rcid not in seen_cids:
                to_mark.append((rcid, "readied_session"))
                seen_cids.add(rcid)

    # 1. Add deploy_cid and inspect its artifacts for tracks and embedded tasks
    if deploy_cid:
        if deploy_cid not in seen_cids:
            to_mark.append((deploy_cid, "deploy_session"))
            seen_cids.add(deploy_cid)

        if os.path.exists(brain_dir):
            deploy_brain = os.path.join(brain_dir, deploy_cid)
            for doc_name in ["implementation_plan.md", "walkthrough.md"]:
                doc_p = os.path.join(deploy_brain, doc_name)
                if os.path.exists(doc_p):
                    try:
                        with open(doc_p, "r", encoding="utf-8", errors="ignore") as fp:
                            doc_text = fp.read()

                        # Extract explicitly numbered tracks or Track headers
                        extracted_tracks = re.findall(
                            r"^\s*\d+\.\s+\*\*([^*]+)\*\*", doc_text, re.MULTILINE
                        )
                        header_tracks = re.findall(
                            r"^#{2,4}\s+Track\s+\d+:?\s*([^\n\r]+)", doc_text, re.MULTILINE
                        )
                        SKIP_TRACK_TERMS = {
                            "verification", "evidence", "proposed", "execution",
                            "user review", "smoke check", "endpoint", "session tagging",
                            "objective", "summary", "trade-off", "trade-offs", "options",
                            "changes", "pros", "cons", "commit", "subject", "task tracker",
                            "status", "results", "metrics", "proof", "release candidate",
                            "firebase deployment", "automated pre-deployment", "scope",
                            "methodology", "checklist"
                        }
                        for raw_tr in extracted_tracks + header_tracks:
                            clean_tr = re.sub(
                                r"\s*\([^)]*Task[^)]*\)", "", raw_tr, flags=re.IGNORECASE
                            ).strip(".:-\t ")
                            if len(clean_tr) < 6:
                                continue
                            if any(skip in clean_tr.lower() for skip in SKIP_TRACK_TERMS):
                                continue
                            found = search_sessions(
                                clean_tr,
                                limit=1,
                                summaries_db=summaries_db,
                                pb_path=pb_path,
                                annotations_dir=annotations_dir,
                            )
                            for f in found:
                                fcid = f["cid"]
                                if fcid != deploy_cid and fcid not in seen_cids:
                                    to_mark.append((fcid, f"deploy_artifact_track:{clean_tr}"))
                                    seen_cids.add(fcid)
                    except Exception:
                        pass

    # 2. Add explicit CIDs
    if cids:
        for c in cids:
            if c not in seen_cids:
                to_mark.append((c, "explicit_cid"))
                seen_cids.add(c)

    # 3. Search keywords
    if keywords:
        for kw in keywords:
            found = search_sessions(
                kw,
                limit=3,
                summaries_db=summaries_db,
                pb_path=pb_path,
                annotations_dir=annotations_dir,
            )
            for item in found:
                cid = item["cid"]
                if cid not in seen_cids:
                    to_mark.append((cid, f"keyword:{kw}"))
                    seen_cids.add(cid)

    # 4. Search tasks if explicitly provided
    if tasks:
        task_set = set(str(t).strip() for t in tasks)
        task_descriptions = {}
        if os.path.exists(task_tracker_path):
            try:
                with open(task_tracker_path, "r", encoding="utf-8", errors="ignore") as fp:
                    for line in fp:
                        parts = line.strip().split(",")
                        if len(parts) >= 3 and parts[0].strip() in task_set:
                            task_descriptions[parts[0].strip()] = parts[2].strip()
            except Exception:
                pass

        # 4a. Match task numbers in recent sessions' brain files (most recent 30 sessions)
        if os.path.exists(brain_dir):
            recent_dirs = sorted(
                glob.glob(os.path.join(brain_dir, "*")),
                key=lambda x: os.path.getmtime(x),
                reverse=True,
            )[:30]
            for bf in recent_dirs:
                bcid = os.path.basename(bf)
                if bcid == deploy_cid:
                    continue
                for doc_name in ["task.md", "walkthrough.md", "implementation_plan.md"]:
                    p = os.path.join(bf, doc_name)
                    if os.path.exists(p):
                        try:
                            with open(p, "r", encoding="utf-8", errors="ignore") as fp:
                                content = fp.read()
                            for t in task_set:
                                if re.search(r"\bTask\s+" + re.escape(t) + r"\b", content, re.IGNORECASE) or \
                                   re.search(r"\b#" + re.escape(t) + r"\b", content):
                                    if bcid not in seen_cids:
                                        desc = task_descriptions.get(t, "")
                                        reason = f"task:{t}" + (f" ({desc[:30]}...)" if desc else "")
                                        to_mark.append((bcid, reason))
                                        seen_cids.add(bcid)
                        except Exception:
                            pass

        # 4b. Match task numbers in session titles or previews (e.g. "Task 1176")
        for t in task_set:
            found = search_sessions(
                f"Task {t}",
                limit=1,
                summaries_db=summaries_db,
                pb_path=pb_path,
                annotations_dir=annotations_dir,
            )
            for item in found:
                cid = item["cid"]
                if cid != deploy_cid and cid not in seen_cids:
                    to_mark.append((cid, f"task_title:{t}"))
                    seen_cids.add(cid)



    results = []
    for cid, reason in to_mark:
        res = mark_deployed(
            cid,
            pb_path=pb_path,
            conv_dir=conv_dir,
            annotations_dir=annotations_dir,
            summaries_db=summaries_db,
        )
        res["trace_reason"] = reason
        results.append(res)

    return {
        "status": "ok",
        "action": "trace_deployed",
        "total": len(results),
        "sessions": results,
    }


def audit_deployed(
    clean_stale: bool = False,
    annotations_dir: str = DEFAULT_ANNOTATIONS_DIR,
    pb_path: str = DEFAULT_PB_PATH,
    conv_dir: str = DEFAULT_CONV_DIR,
):
    """Audit all deployed sessions to see if new user messages arrived after deployment."""
    deployed = list_deployed(annotations_dir=annotations_dir, pb_path=pb_path)
    results = []

    brain_dir = os.path.expanduser(r"~\.gemini\antigravity\brain")

    for item in deployed:
        cid = item["cid"]
        title = item["title"]
        tpath = os.path.join(brain_dir, cid, ".system_generated", "logs", "transcript.jsonl")

        last_deploy_step = -1
        last_user_step = -1
        last_user_content = ""

        if os.path.exists(tpath):
            try:
                with open(tpath, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        obj = json.loads(line)
                        s_idx = obj.get("step_index", 0)
                        if "mark-deployed" in str(obj):
                            last_deploy_step = s_idx
                        if obj.get("type") == "USER_INPUT":
                            last_user_step = s_idx
                            last_user_content = obj.get("content", "").strip().replace("\n", " ")[:120]
            except Exception:
                pass

        is_stale = (last_deploy_step != -1 and last_user_step > last_deploy_step) or (
            last_deploy_step == -1 and last_user_step > 0
        )

        entry = {
            "cid": cid,
            "title": title,
            "last_deploy_step": last_deploy_step,
            "last_user_step": last_user_step,
            "last_user_content": last_user_content,
            "is_stale": is_stale,
        }

        if is_stale and clean_stale:
            res = remove_deployed(cid, pb_path=pb_path, conv_dir=conv_dir, annotations_dir=annotations_dir)
            entry["cleaned"] = res.get("status") == "success"
            entry["new_title"] = res.get("new_title")

        results.append(entry)

    return {
        "status": "ok",
        "total_deployed": len(deployed),
        "stale_count": sum(1 for r in results if r["is_stale"]),
        "cleaned": clean_stale,
        "sessions": results,
    }


def main():
    parser = argparse.ArgumentParser(description="Manage production deployment markers for conversation titles.")
    parser.add_argument(
        "action",
        choices=[
            "mark-deployed",
            "remove-deployed",
            "mark-ready",
            "remove-ready",
            "status",
            "list-deployed",
            "list-ready",
            "audit-all",
            "search",
            "mark-batch",
            "trace-deployed",
        ],
        help="Action to execute",
    )
    parser.add_argument(
        "query",
        nargs="?",
        default=None,
        help="Search query or positional argument",
    )
    parser.add_argument(
        "--cid",
        "--cids",
        type=str,
        nargs="*",
        default=None,
        help="Target conversation UUID(s). Can accept multiple CIDs. Defaults to current active if omitted.",
    )
    parser.add_argument(
        "--pattern",
        type=str,
        default=None,
        help="Search pattern or keyword to target multiple sessions.",
    )
    parser.add_argument(
        "--tasks",
        type=str,
        nargs="*",
        default=None,
        help="Task numbers to trace for trace-deployed.",
    )
    parser.add_argument(
        "--keywords",
        type=str,
        nargs="*",
        default=None,
        help="Keywords to trace for trace-deployed.",
    )
    parser.add_argument(
        "--deploy-cid",
        type=str,
        default=None,
        help="Deploy session CID to tag in trace-deployed.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Max results for search.",
    )
    parser.add_argument("--pb-path", type=str, default=DEFAULT_PB_PATH, help="Path to agyhub_summaries_proto.pb")
    parser.add_argument("--conv-dir", type=str, default=DEFAULT_CONV_DIR, help="Path to conversations directory")
    parser.add_argument(
        "--annotations-dir", type=str, default=DEFAULT_ANNOTATIONS_DIR, help="Path to annotations directory"
    )
    parser.add_argument(
        "--summaries-db", type=str, default=DEFAULT_SUMMARIES_DB, help="Path to conversation_summaries.db"
    )
    parser.add_argument(
        "--clean-stale",
        action="store_true",
        help="Automatically strip (D) from stale sessions during audit-all",
    )
    parser.add_argument(
        "--no-ready",
        action="store_true",
        help="Exclude currently readied (R) sessions from trace-deployed.",
    )

    args = parser.parse_args()

    # Normalize CIDs list
    cids = []
    if args.cid:
        for item in args.cid:
            for c in item.replace(",", " ").split():
                if c.strip():
                    cids.append(c.strip())

    if args.action == "search":
        q = args.query or args.pattern or ""
        results = search_sessions(
            q,
            limit=args.limit,
            summaries_db=args.summaries_db,
            pb_path=args.pb_path,
            annotations_dir=args.annotations_dir,
        )
        res = {
            "status": "ok",
            "query": q,
            "count": len(results),
            "sessions": results,
        }
        print(json.dumps(res, indent=2))
        return

    if args.action == "list-deployed":
        res = {
            "status": "ok",
            "sessions": list_deployed(
                annotations_dir=args.annotations_dir,
                pb_path=args.pb_path,
                summaries_db=args.summaries_db,
            ),
        }
        print(json.dumps(res, indent=2))
        return

    if args.action == "list-ready":
        res = {
            "status": "ok",
            "sessions": list_ready(
                annotations_dir=args.annotations_dir,
                pb_path=args.pb_path,
                summaries_db=args.summaries_db,
            ),
        }
        print(json.dumps(res, indent=2))
        return

    if args.action == "audit-all":
        res = audit_deployed(
            clean_stale=args.clean_stale,
            annotations_dir=args.annotations_dir,
            pb_path=args.pb_path,
            conv_dir=args.conv_dir,
        )
        print(json.dumps(res, indent=2))
        return

    if args.action == "trace-deployed":
        res = trace_deploy_sessions(
            tasks=args.tasks,
            keywords=args.keywords,
            cids=cids,
            deploy_cid=args.deploy_cid,
            include_ready=not args.no_ready,
            summaries_db=args.summaries_db,
            pb_path=args.pb_path,
            conv_dir=args.conv_dir,
            annotations_dir=args.annotations_dir,
        )
        print(json.dumps(res, indent=2))
        return

    # For mark-batch: gather CIDs from cids, query, or pattern
    if args.action == "mark-batch":
        batch_cids = list(cids)
        if args.query:
            for part in args.query.replace(",", " ").split():
                if len(part) > 20 and "-" in part:
                    batch_cids.append(part.strip())
                else:
                    found = search_sessions(part, limit=5, summaries_db=args.summaries_db, pb_path=args.pb_path, annotations_dir=args.annotations_dir)
                    batch_cids.extend([f["cid"] for f in found])
        if args.pattern:
            found = search_sessions(args.pattern, limit=20, summaries_db=args.summaries_db, pb_path=args.pb_path, annotations_dir=args.annotations_dir)
            batch_cids.extend([f["cid"] for f in found])

        batch_cids = list(dict.fromkeys(batch_cids))
        results = [
            mark_deployed(
                c,
                pb_path=args.pb_path,
                conv_dir=args.conv_dir,
                annotations_dir=args.annotations_dir,
                summaries_db=args.summaries_db,
            )
            for c in batch_cids
        ]
        res = {
            "status": "ok",
            "action": "marked_batch",
            "total": len(results),
            "results": results,
        }
        print(json.dumps(res, indent=2))
        return

    ACTION_FN_MAP = {
        "mark-deployed": mark_deployed,
        "remove-deployed": remove_deployed,
        "mark-ready": mark_ready,
        "remove-ready": remove_ready,
        "status": get_status,
    }

    # Handle pattern matching
    if args.pattern:
        matched = search_sessions(
            args.pattern,
            limit=args.limit,
            summaries_db=args.summaries_db,
            pb_path=args.pb_path,
            annotations_dir=args.annotations_dir,
        )
        target_cids = [m["cid"] for m in matched]
        fn = ACTION_FN_MAP.get(args.action, get_status)
        results = [
            fn(
                c,
                pb_path=args.pb_path,
                conv_dir=args.conv_dir,
                annotations_dir=args.annotations_dir,
                summaries_db=args.summaries_db,
            )
            for c in target_cids
        ]
        res = {
            "status": "ok",
            "action": args.action,
            "pattern": args.pattern,
            "total": len(results),
            "results": results,
        }
        print(json.dumps(res, indent=2))
        return

    # Multiple CIDs passed
    if len(cids) > 1:
        fn = ACTION_FN_MAP.get(args.action, get_status)
        results = [
            fn(
                c,
                pb_path=args.pb_path,
                conv_dir=args.conv_dir,
                annotations_dir=args.annotations_dir,
                summaries_db=args.summaries_db,
            )
            for c in cids
        ]
        res = {
            "status": "ok",
            "action": args.action,
            "total": len(results),
            "results": results,
        }
        print(json.dumps(res, indent=2))
        return

    # Single CID or default to active CID
    cid = cids[0] if len(cids) == 1 else None
    if not cid:
        try:
            cid = resolve_active_cid(args.conv_dir)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), file=sys.stderr)
            sys.exit(1)

    fn = ACTION_FN_MAP.get(args.action)
    if not fn:
        res = {"status": "error", "message": f"Unknown action {args.action}"}
    else:
        res = fn(
            cid,
            pb_path=args.pb_path,
            conv_dir=args.conv_dir,
            annotations_dir=args.annotations_dir,
            summaries_db=args.summaries_db,
        )

    print(json.dumps(res, indent=2))
    if res.get("status") == "error":
        sys.exit(1)


if __name__ == "__main__":
    main()

