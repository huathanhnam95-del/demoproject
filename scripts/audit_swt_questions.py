import json
import os
import re

SWT_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "database", "Summarize Written Text", "SWT", "swt-questions.json")

DISALLOWED_STARTINGS = {
    "and", "but", "or", "so", "nor"
}

DISALLOWED_ENDINGS = {
    "are", "is", "was", "were", "be", "been", "being",
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "which", "that", "who", "whom", "whose", "where", "when", "why", "how",
    "to", "and", "or", "but", "nor", "so", "for", "yet", "while", "as", "although", "though",
    "of", "in", "with", "by", "at", "from", "on", "into", "onto", "upon", "about", "above"
}

def is_valid_semantic_phrase(phrase: str) -> bool:
    if not phrase or not isinstance(phrase, str):
        return False
    words = phrase.strip().split()
    if len(words) < 4:
        return False
    first_word = words[0].strip(".,;:!?\"'()").lower()
    if first_word in DISALLOWED_STARTINGS:
        return False
    last_word = words[-1].strip(".,;:!?\"'()").lower()
    if last_word in DISALLOWED_ENDINGS:
        return False
    return True

def count_words(text: str) -> int:
    return len((text or "").strip().split())

def is_single_sentence(text: str) -> bool:
    t = (text or "").strip()
    if not t.endswith('.'):
        return False
    inner = t[:-1]
    if '?' in inner or '!' in inner:
        return False
    masked = re.sub(r'\d+\.\d+', 'NUM', inner)
    masked = re.sub(r'\b(?:[A-Za-z]\.){1,}', 'ABBR', masked)
    masked = re.sub(r'\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|approx|dept|vol|no)\.', 'ABBR', masked, flags=re.IGNORECASE)
    if re.search(r'\.\s+', masked) or re.search(r'\.(?!\w)', masked):
        return False
    return True

def run_audit():
    import argparse
    parser = argparse.ArgumentParser(description="Audit SWT Questions")
    parser.add_argument("--id", type=str, help="Single question ID to audit")
    parser.add_argument("--start", type=int, help="Start question ID")
    parser.add_argument("--end", type=int, help="End question ID")
    parser.add_argument("--annotated", action="store_true", help="Audit all annotated questions")
    parser.add_argument("--all", action="store_true", help="Audit all questions in database")
    args = parser.parse_args()

    with open(SWT_PATH, "r", encoding="utf-8") as f:
        questions = json.load(f)

    if args.id:
        target_qs = [q for q in questions if str(q.get("id")) == str(args.id)]
    elif args.start is not None or args.end is not None:
        s = args.start if args.start is not None else 1
        e = args.end if args.end is not None else 999999
        target_qs = [q for q in questions if str(q.get("id")).isdigit() and s <= int(q["id"]) <= e]
    elif args.all:
        target_qs = questions
    elif args.annotated:
        target_qs = [q for q in questions if q.get("answerAnalysis")]
    else:
        # Default: if any unannotated, audit annotated only; or IDs 1-50 if pilot
        annotated = [q for q in questions if q.get("answerAnalysis")]
        target_qs = annotated if annotated else [q for q in questions if str(q.get("id")).isdigit() and 1 <= int(q["id"]) <= 50]

    print(f"Loaded {len(target_qs)} questions to audit.")

    issues = {}
    pass_count = 0

    for q in target_qs:
        qid = str(q["id"])
        errs = []
        source = q.get("sourceText", "")
        source_words = count_words(source)
        min_cores = 4 if source_words >= 200 else (3 if source_words >= 100 else 2)

        aa = q.get("answerAnalysis")
        if not aa:
            errs.append("Missing answerAnalysis")
            issues[qid] = {"errors": errs, "source_words": source_words, "title": q.get("title")}
            continue

        cores = aa.get("corePoints", [])
        if len(cores) < min_cores:
            errs.append(f"Core points count ({len(cores)}) < required min ({min_cores}) for {source_words}w passage")

        # Evidence quote check
        for cp in cores:
            for ev in cp.get("evidence", []):
                actual = source[ev.get("start", 0):ev.get("end", 0)]
                if actual != ev.get("quote"):
                    errs.append(f"Core {cp.get('id')} evidence mismatch at [{ev.get('start')}:{ev.get('end')}]")

        for ip in aa.get("ignorePoints", []):
            for ev in ip.get("evidence", []):
                actual = source[ev.get("start", 0):ev.get("end", 0)]
                if actual != ev.get("quote"):
                    errs.append(f"Ignore {ip.get('id')} evidence mismatch at [{ev.get('start')}:{ev.get('end')}]")

        ss = aa.get("sampleSummary", {})
        if "versionC" in ss:
            errs.append("versionC is present")
        if "versionA" not in ss or "versionB" not in ss:
            errs.append("missing versionA or versionB")

        for v_key in ["versionA", "versionB"]:
            if v_key in ss:
                v = ss[v_key]
                text = v.get("text", "")
                wc = count_words(text)
                if wc < 50 or wc > 70:
                    errs.append(f"{v_key} word count ({wc}) out of 50-70 range")
                if not is_single_sentence(text):
                    errs.append(f"{v_key} is not strictly 1 single sentence")
                hl = v.get("pointHighlights", [])
                if not hl:
                    errs.append(f"{v_key} missing pointHighlights")
                for h in hl:
                    p = h.get("phrase", "")
                    if p not in text:
                        errs.append(f"{v_key} highlight '{p}' not found in summary text")
                    elif not is_valid_semantic_phrase(p):
                        words = p.split()
                        last_w = words[-1].strip(".,;:!?\"'()") if words else ""
                        errs.append(f"{v_key} highlight '{p}' fails semantic check (len={len(words)}, last_word='{last_w}')")

                    # Check for unclosed quotes or parens in highlight phrase
                    no_paired_sq = re.sub(r"'[^']+'", "", p)
                    no_apostrophes = re.sub(r"\b[a-zA-Z]+'[a-zA-Z]+\b", "", no_paired_sq)
                    no_possessives = re.sub(r"\b[a-zA-Z]+s'(?=\s|$|[.,;:!?])", "", no_apostrophes)
                    if no_possessives.count("'") > 0:
                        errs.append(f"{v_key} highlight '{p}' has unclosed single quote")
                    if p.count('"') % 2 != 0:
                        errs.append(f"{v_key} highlight '{p}' has unclosed double quote")
                    if p.count("(") != p.count(")"):
                        errs.append(f"{v_key} highlight '{p}' has unbalanced parentheses")

                # Check core point coverage in highlights
                core_ids = [c["id"] for c in cores]
                hl_cids = [h.get("pointId") for h in hl]
                missing_cids = [cid for cid in core_ids if cid not in hl_cids]
                if missing_cids:
                    errs.append(f"{v_key} missing highlights for core points: {missing_cids}")

                hl_phrases = [h.get("phrase", "").strip().lower() for h in hl if h.get("phrase")]
                if len(hl_phrases) != len(set(hl_phrases)):
                    errs.append(f"{v_key} has duplicate highlight phrases across different core points")
                for i in range(len(hl)):
                    for j in range(len(hl)):
                        if i != j:
                            pi = hl[i].get("phrase", "").strip().lower()
                            pj = hl[j].get("phrase", "").strip().lower()
                            if pi and pj and (pi == pj or pi in pj):
                                errs.append(f"{v_key} highlight for {hl[i].get('pointId')} ('{hl[i].get('phrase')}') overlaps or is nested inside {hl[j].get('pointId')} ('{hl[j].get('phrase')}')")

                # Check character span overlaps in summary text
                spans = []
                for h in hl:
                    phrase = h.get("phrase", "")
                    if phrase and phrase in text:
                        pos = 0
                        while True:
                            idx = text.find(phrase, pos)
                            if idx == -1:
                                break
                            spans.append((idx, idx + len(phrase), h.get("pointId"), phrase))
                            pos = idx + 1
                for i in range(len(spans)):
                    for j in range(i + 1, len(spans)):
                        s1, e1, pid1, p1 = spans[i]
                        s2, e2, pid2, p2 = spans[j]
                        if pid1 != pid2 and max(s1, s2) < min(e1, e2):
                            errs.append(f"{v_key} highlight character span overlap between {pid1} [{s1}:{e1}] and {pid2} [{s2}:{e2}]")

        pg = ss.get("versionB", {}).get("paraphrasingGuide", [])
        if len(pg) < 4:
            errs.append(f"Version B paraphrasingGuide count ({len(pg)}) < 4")

        if errs:
            issues[qid] = {
                "errors": errs,
                "source_words": source_words,
                "core_points": len(cores),
                "title": q.get("title")
            }
        else:
            pass_count += 1

    print(f"\n==========================================")
    print(f"AUDIT RESULTS SUMMARY:")
    print(f"Total Evaluated: {len(target_qs)}")
    print(f"Fully Compliant (PASS): {pass_count}")
    print(f"Questions Needing Remediation (FAIL): {len(issues)}")
    print(f"==========================================\n")

    for qid in sorted(issues.keys(), key=lambda x: int(x)):
        info = issues[qid]
        print(f"Question #{qid} (\"{info['title']}\", {info['source_words']} words, {info.get('core_points', 0)} cores):")
        for err in info["errors"]:
            print(f"   [FAIL] {err}")

    try:
        report_path = os.path.join(os.path.dirname(__file__), "..", "reports", "swt_prelim_audit_issues.json")
        tmp_report = report_path + ".tmp"
        with open(tmp_report, "w", encoding="utf-8") as f:
            json.dump(issues, f, indent=2)
        os.replace(tmp_report, report_path)
    except Exception:
        pass

    import sys
    sys.exit(1 if issues else 0)

if __name__ == "__main__":
    run_audit()
