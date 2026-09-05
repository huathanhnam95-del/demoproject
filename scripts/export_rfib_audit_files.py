import json
import os
import sys

SIDE_CAR_PATH = r"public/database/RFIB/RFIB_audited_full.jsonl"
FALLBACK_SIDE_CAR_PATH = r"public/database/RFIB/RFIB_3model_revision.jsonl"
REVIEW_METADATA_PATH = r"public/database/RFIB/review-metadata.json"
WORKBOOK_PATH = r"public/database/RFIB/RFIB Final ver.xlsx"
MD_EXPORT_PATH = r"public/database/RFIB/RFIB_Audit_Manual_Review.md"

def load_sidecar(path):
    records = {}
    paths_to_check = [path]
    if os.path.exists(FALLBACK_SIDE_CAR_PATH):
        paths_to_check.append(FALLBACK_SIDE_CAR_PATH)
    
    # Load fallback first, then override with primary audited path
    for p in reversed(paths_to_check):
        if not os.path.exists(p):
            continue
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                rec = json.loads(line)
                records[rec["id"]] = rec
    return records

def update_review_metadata(sidecar_recs, review_metadata_path):
    if not os.path.exists(review_metadata_path):
        print(f"File not found: {review_metadata_path}")
        return 0

    with open(review_metadata_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    items = metadata.get("items", {})
    updated_count = 0

    for qid, rec in sidecar_recs.items():
        try:
            numeric_id = int(qid)
            key = f"{numeric_id:04d}"
        except Exception:
            key = str(qid)

        if key not in items:
            items[key] = {}
        
        blank_analysis_list = []
        for b in rec.get("blanks", []):
            distractors = b.get("dr_distractor_analysis", [])
            blank_item = {
                "blank_index": b.get("blank_index"),
                "correct_answer": b.get("correct_answer"),
                "grammar_tag": b.get("grammar_tag", ""),
                "concise_explanation": b.get("concise_explanation", ""),
                "detailed_explanation": b.get("final_explanation", b.get("student_explanation", "")),
                "simplified_explanation": b.get("final_explanation", ""),
                "distractor_analysis": distractors,
                "audit_verdict": b.get("audit_verdict", ""),
                "audit_consensus_type": b.get("audit_consensus_type", ""),
                "vi_explanation": b.get("vi_explanation", ""),
                "confidence": b.get("confidence", "High"),
                "confidence_flags": b.get("confidence_flags", []),
                "cohesion_tie": b.get("cohesion_tie", "")
            }
            blank_analysis_list.append(blank_item)

        items[key]["blankAnalysis"] = json.dumps(blank_analysis_list, ensure_ascii=False)
        items[key]["auditStatus"] = rec.get("audit_status", "")
        updated_count += 1

    metadata["items"] = items
    with open(review_metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    return updated_count

def generate_markdown_audit_doc(sidecar_recs, export_path):
    sorted_ids = sorted(sidecar_recs.keys())
    lines = []
    lines.append("# RFIB 3-Model Revision & Vietnamese Explanation Audit Report")
    lines.append(f"**Total Questions Available for Audit:** {len(sorted_ids)}")
    lines.append("\n---\n")

    for qid in sorted_ids:
        rec = sidecar_recs[qid]
        lines.append(f"## Question {qid}")
        lines.append(f"- **Total Blanks:** {len(rec.get('blanks', []))}")
        lines.append(f"- **Revision Timestamp:** {rec.get('timestamp', 'N/A')}")
        lines.append("\n### Blanks Breakdown:\n")

        for b in rec.get("blanks", []):
            b_idx = b.get("blank_index")
            ans = b.get("correct_answer")
            tag = b.get("grammar_tag", "N/A")
            conf = b.get("confidence", "High")
            final_exp = b.get("final_explanation", b.get("student_explanation", ""))
            vi_exp = b.get("vi_explanation", "N/A")

            lines.append(f"#### Blank {b_idx}: `{ans}` ({tag}) | Confidence: `{conf}`")
            lines.append(f"**English Explanation:**\n{final_exp}\n")
            if vi_exp and vi_exp != "N/A":
                lines.append(f"**Vietnamese Explanation (Teacher Persona):**\n{vi_exp}\n")
            lines.append("---\n")

    with open(export_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

def main():
    sidecar_recs = load_sidecar(SIDE_CAR_PATH)
    print(f"Loaded {len(sidecar_recs)} records from sidecar.")

    updated_review = update_review_metadata(sidecar_recs, REVIEW_METADATA_PATH)
    print(f"Updated {updated_review} records in {REVIEW_METADATA_PATH}")

    generate_markdown_audit_doc(sidecar_recs, MD_EXPORT_PATH)
    print(f"Generated Markdown audit document: {MD_EXPORT_PATH}")

if __name__ == "__main__":
    main()
