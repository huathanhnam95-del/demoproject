#!/usr/bin/env python3
"""
scripts/session_tagger.py

Manages production deployment markers in Google Antigravity chat session titles.
Convention:
- When a session ends with a production deployment, tag title with prefix '(D) '.
- When a conversation continues/resumes and is answered, remove prefix '(D) '.

Usage:
  python scripts/session_tagger.py mark-deployed [--cid <conversation_id>]
  python scripts/session_tagger.py remove-deployed [--cid <conversation_id>]
  python scripts/session_tagger.py status [--cid <conversation_id>]
"""

import argparse
import glob
import json
import os
import shutil
import sqlite3
import sys

DEFAULT_PB_PATH = os.path.expanduser(r"~\.gemini\antigravity\agyhub_summaries_proto.pb")
DEFAULT_CONV_DIR = os.path.expanduser(r"~\.gemini\antigravity\conversations")


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


def get_session_title(cid: str, pb_path: str = DEFAULT_PB_PATH):
    if not os.path.exists(pb_path):
        return None
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
    return None


def update_session_title(cid: str, new_title: str, pb_path: str = DEFAULT_PB_PATH) -> bool:
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


def sync_db_title(cid: str, old_title: str, new_title: str, conv_dir: str = DEFAULT_CONV_DIR):
    db_path = os.path.join(conv_dir, f"{cid}.db")
    if not os.path.exists(db_path):
        return
    try:
        con = sqlite3.connect(db_path)
        cur = con.cursor()
        # Check step 1
        rows = cur.execute("SELECT idx, step_payload FROM steps WHERE idx=1;").fetchall()
        for idx, payload in rows:
            if payload and old_title.encode("utf-8") in payload:
                new_payload = payload.replace(old_title.encode("utf-8"), new_title.encode("utf-8"))
                cur.execute("UPDATE steps SET step_payload=? WHERE idx=?;", (new_payload, idx))
                con.commit()
        con.close()
    except Exception:
        # Non-fatal if DB is locked by active session
        pass


def mark_deployed(cid: str, pb_path: str = DEFAULT_PB_PATH, conv_dir: str = DEFAULT_CONV_DIR):
    title = get_session_title(cid, pb_path=pb_path)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}

    if title.startswith("(D) "):
        return {
            "status": "noop",
            "message": "Already marked as deployed.",
            "cid": cid,
            "title": title,
            "is_deployed": True,
        }

    new_title = f"(D) {title}"
    success = update_session_title(cid, new_title, pb_path=pb_path)
    if success:
        sync_db_title(cid, title, new_title, conv_dir=conv_dir)
        return {
            "status": "success",
            "action": "marked_deployed",
            "cid": cid,
            "old_title": title,
            "new_title": new_title,
            "is_deployed": True,
        }
    return {"status": "error", "message": "Failed to update title in protobuf index."}


def remove_deployed(cid: str, pb_path: str = DEFAULT_PB_PATH, conv_dir: str = DEFAULT_CONV_DIR):
    title = get_session_title(cid, pb_path=pb_path)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}

    if not title.startswith("(D) "):
        return {
            "status": "noop",
            "message": "Title is not currently marked with (D).",
            "cid": cid,
            "title": title,
            "is_deployed": False,
        }

    new_title = title[4:].strip()
    success = update_session_title(cid, new_title, pb_path=pb_path)
    if success:
        sync_db_title(cid, title, new_title, conv_dir=conv_dir)
        return {
            "status": "success",
            "action": "removed_deployed",
            "cid": cid,
            "old_title": title,
            "new_title": new_title,
            "is_deployed": False,
        }
    return {"status": "error", "message": "Failed to update title in protobuf index."}


def get_status(cid: str, pb_path: str = DEFAULT_PB_PATH):
    title = get_session_title(cid, pb_path=pb_path)
    if not title:
        return {"status": "error", "message": f"Conversation {cid} not found in index."}
    return {
        "status": "ok",
        "cid": cid,
        "title": title,
        "is_deployed": title.startswith("(D) "),
    }


def main():
    parser = argparse.ArgumentParser(description="Manage production deployment markers for conversation titles.")
    parser.add_argument("action", choices=["mark-deployed", "remove-deployed", "status"], help="Action to execute")
    parser.add_argument("--cid", type=str, default=None, help="Target conversation UUID. Defaults to current active.")
    parser.add_argument("--pb-path", type=str, default=DEFAULT_PB_PATH, help="Path to agyhub_summaries_proto.pb")
    parser.add_argument("--conv-dir", type=str, default=DEFAULT_CONV_DIR, help="Path to conversations directory")

    args = parser.parse_args()

    cid = args.cid
    if not cid:
        try:
            cid = resolve_active_cid(args.conv_dir)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), file=sys.stderr)
            sys.exit(1)

    if args.action == "mark-deployed":
        res = mark_deployed(cid, pb_path=args.pb_path, conv_dir=args.conv_dir)
    elif args.action == "remove-deployed":
        res = remove_deployed(cid, pb_path=args.pb_path, conv_dir=args.conv_dir)
    elif args.action == "status":
        res = get_status(cid, pb_path=args.pb_path)
    else:
        res = {"status": "error", "message": f"Unknown action {args.action}"}

    print(json.dumps(res, indent=2))
    if res.get("status") == "error":
        sys.exit(1)


if __name__ == "__main__":
    main()
