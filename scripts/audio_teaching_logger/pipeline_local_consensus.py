import os
import sys
import time
import json
import re
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher
from pathlib import Path

from .config import (
    OLLAMA_URL,
    OLLAMA_EMBED_URL,
    OLLAMA_EMBED_MODEL,
    DEFAULT_LOCAL_MODELS,
    PEDAGOGICAL_PROMPT_REQUIREMENTS,
    ANALYSIS_JSON_SCHEMA
)
from .pipeline_gemini import format_markdown_report, generate_mermaid_fallback


# --- Transcript Chunking ---

TIMESTAMP_PATTERN = re.compile(r"\[\s*(\d+)m(\d+)s\d+ms\s*\]")


def chunk_transcript(transcript_text: str, chunk_minutes: int = 10, overlap_lines: int = 2) -> list[dict]:
    """
    Split a timestamped transcript into time-based chunks.
    Each chunk spans approximately `chunk_minutes` of dialogue.
    Adjacent chunks overlap by `overlap_lines` for cross-boundary context.

    Returns list of {"chunk_id": int, "time_range": str, "text": str, "line_count": int}.
    Falls back to line-count splitting if no timestamps are detected.
    """
    lines = transcript_text.strip().splitlines()
    if not lines:
        return [{"chunk_id": 1, "time_range": "full", "text": transcript_text, "line_count": len(lines)}]

    # Parse timestamps from each line
    line_times = []
    for line in lines:
        m = TIMESTAMP_PATTERN.search(line)
        if m:
            total_seconds = int(m.group(1)) * 60 + int(m.group(2))
            line_times.append(total_seconds)
        else:
            # Lines without timestamps inherit the previous timestamp
            line_times.append(line_times[-1] if line_times else 0)

    # Check if we actually found meaningful timestamps
    has_timestamps = any(t > 0 for t in line_times)

    if not has_timestamps:
        # Fallback: split by line count (~80 lines per chunk)
        chunk_size = 80
        chunks = []
        for i in range(0, len(lines), chunk_size - overlap_lines):
            chunk_lines = lines[i:i + chunk_size]
            if not chunk_lines:
                break
            chunks.append({
                "chunk_id": len(chunks) + 1,
                "time_range": f"lines {i+1}–{min(i + chunk_size, len(lines))}",
                "text": "\n".join(chunk_lines),
                "line_count": len(chunk_lines)
            })
        return chunks if chunks else [{"chunk_id": 1, "time_range": "full", "text": transcript_text, "line_count": len(lines)}]

    # Time-based chunking
    chunk_seconds = chunk_minutes * 60
    chunks = []
    chunk_start_idx = 0

    def _format_time(seconds):
        m, s = divmod(seconds, 60)
        h, m = divmod(m, 60)
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

    while chunk_start_idx < len(lines):
        chunk_start_time = line_times[chunk_start_idx]
        chunk_end_time = chunk_start_time + chunk_seconds

        # Find the last line within this time window
        chunk_end_idx = chunk_start_idx
        for j in range(chunk_start_idx, len(lines)):
            if line_times[j] < chunk_end_time:
                chunk_end_idx = j
            else:
                break
        else:
            # Reached end of transcript
            chunk_end_idx = len(lines) - 1

        chunk_lines = lines[chunk_start_idx:chunk_end_idx + 1]

        # If chunk is too small (< 5 lines), merge it into the previous chunk
        if len(chunk_lines) < 5 and chunks:
            prev = chunks[-1]
            prev["text"] += "\n" + "\n".join(chunk_lines)
            prev["line_count"] += len(chunk_lines)
            end_time = min(line_times[chunk_end_idx], line_times[-1])
            prev_start = prev["time_range"].split("–")[0]
            prev["time_range"] = f"{prev_start}–{_format_time(end_time)}"
        else:
            chunks.append({
                "chunk_id": len(chunks) + 1,
                "time_range": f"{_format_time(chunk_start_time)}–{_format_time(min(line_times[chunk_end_idx], line_times[-1]))}",
                "text": "\n".join(chunk_lines),
                "line_count": len(chunk_lines)
            })

        # Advance past this chunk, with overlap (no overlap for tiny merged chunks)
        next_start = chunk_end_idx + 1 - overlap_lines
        if next_start <= chunk_start_idx:
            next_start = chunk_end_idx + 1
        chunk_start_idx = next_start

        if chunk_start_idx >= len(lines):
            break

    return chunks if chunks else [{"chunk_id": 1, "time_range": "full", "text": transcript_text, "line_count": len(lines)}]


def merge_chunk_drafts(chunk_results: list[dict | None]) -> dict | None:
    """
    Merge per-chunk JSON analyses from one model into a single unified draft.
    Concatenates all teaching points, errors, solutions, and responses.
    Deduplicates action items by string similarity.
    """
    expected_keys = {"what_taught", "student_problems", "teacher_solutions"}
    # Filter out None and empty/schema-less dicts (e.g. Qwen returning {})
    valid = [r for r in chunk_results if r is not None and isinstance(r, dict) and (expected_keys & set(r.keys()))]
    if not valid:
        return None
    if len(valid) == 1:
        return valid[0]

    merged = {
        "title": "Teaching Session Analysis",
        "lesson_summary": "",
        "what_taught": [],
        "student_problems": [],
        "teacher_solutions": [],
        "student_response": [],
        "action_items": {"for_teacher": [], "for_student": []}
    }

    summaries = []
    problem_counter = 0

    for chunk_data in valid:
        # Merge lesson summary (handle non-string values from some models)
        s = chunk_data.get("lesson_summary", "")
        if s:
            summaries.append(str(s) if not isinstance(s, str) else s)

        # Merge what_taught
        for item in chunk_data.get("what_taught", []):
            merged["what_taught"].append(item)

        # Merge student_problems with renumbered IDs
        for item in chunk_data.get("student_problems", []):
            problem_counter += 1
            item_copy = dict(item)
            old_id = item_copy.get("problem_id", "")
            new_id = f"P{problem_counter}"
            item_copy["problem_id"] = new_id

            merged["student_problems"].append(item_copy)

            # Also renumber matching solutions and responses
            for sol in chunk_data.get("teacher_solutions", []):
                if sol.get("targeted_problem_id") == old_id:
                    sol_copy = dict(sol)
                    sol_copy["targeted_problem_id"] = new_id
                    merged["teacher_solutions"].append(sol_copy)
            for resp in chunk_data.get("student_response", []):
                if resp.get("targeted_problem_id") == old_id:
                    resp_copy = dict(resp)
                    resp_copy["targeted_problem_id"] = new_id
                    merged["student_response"].append(resp_copy)

        # Merge action items with deduplication (coerce to string for safety)
        ai = chunk_data.get("action_items", {})
        if isinstance(ai, dict):
            for new_item in ai.get("for_teacher", []):
                new_str = str(new_item) if not isinstance(new_item, str) else new_item
                if not any(string_similarity(new_str, existing) > 0.7 for existing in merged["action_items"]["for_teacher"]):
                    merged["action_items"]["for_teacher"].append(new_str)
            for new_item in ai.get("for_student", []):
                new_str = str(new_item) if not isinstance(new_item, str) else new_item
                if not any(string_similarity(new_str, existing) > 0.7 for existing in merged["action_items"]["for_student"]):
                    merged["action_items"]["for_student"].append(new_str)

    merged["lesson_summary"] = " ".join(summaries) if summaries else ""
    return merged


def clean_response(raw: str) -> str:
    """Clean markdown blocks, think tags (DeepSeek R1), and extract clean JSON."""
    if not raw:
        return ""
    # Strip <think>...</think>
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if "<think>" in cleaned:
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL).strip()
    cleaned = re.sub(r"</?(no_)?think>", "", cleaned).strip()

    # Extract JSON code block if wrapped
    if "```" in cleaned:
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()

    # Find start and end braces
    if not (cleaned.startswith("{") or cleaned.startswith("[")):
        match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(1).strip()

    # Pre-parse: strip "thought"/"thinking"/"reasoning" JSON fields from raw text.
    # Gemma4 wraps output in {"thought": "very long CoT...", "actual_fields": ...}
    # and the thought text consumes all output tokens, truncating the real content.
    # This regex removes the entire "thought": "..." key-value pair (including trailing comma).
    for noise_key in ("thought", "thinking", "reasoning", "chain_of_thought"):
        cleaned = re.sub(
            rf'"{noise_key}"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?\s*',
            "",
            cleaned,
            flags=re.DOTALL
        )

    return cleaned


def query_ollama(
    model_name: str,
    prompt: str,
    temperature: float = 0.2,
    max_tokens: int = 8192,
    timeout: int = 180,
    force_json: bool = True
) -> dict:
    """Query local Ollama endpoint."""
    eff_prompt = prompt
    if "qwen" in model_name.lower():
        # Qwen3 with format:json returns empty {} for chunk prompts.
        # Let it output free-text; clean_response extracts JSON from code blocks.
        eff_prompt = "Output your analysis as a single JSON code block (```json ... ```). Do NOT wrap with thinking tags.\n\n" + prompt
    elif "gemma" in model_name.lower():
        # Gemma4's format:json mode emits a "thought" CoT field that consumes output.
        # Without format:json, instruct Gemma to output clean JSON in a code block.
        eff_prompt = "Output your analysis as a single JSON code block (```json ... ```). Do NOT include any 'thought' or reasoning fields. Start directly with the JSON.\n\n" + prompt

    payload = {
        "model": model_name,
        "prompt": eff_prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "num_ctx": 32768
        }
    }
    # Disable format:json for models that misbehave with it (Gemma emits "thought"
    # field, Qwen3 returns empty {}). Only DeepSeek uses native JSON mode reliably.
    use_json_format = force_json and ("gemma" not in model_name.lower()) and ("qwen" not in model_name.lower())
    if use_json_format:
        payload["format"] = "json"

    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        if resp.status_code == 200:
            raw_text = resp.json().get("response", "")
            cleaned = clean_response(raw_text)
            parsed = None
            if force_json:
                try:
                    parsed = json.loads(cleaned)
                except Exception as e:
                    # Attempt soft repair
                    try:
                        # Try closing brackets if truncated
                        fixed = cleaned + "\n}"
                        parsed = json.loads(fixed)
                    except Exception:
                        parsed = None
                # Post-parse normalization: handle Gemma's "thought" wrapper
                if isinstance(parsed, dict):
                    # Remove chain-of-thought fields that pollute the schema
                    for noise_key in ("thought", "thinking", "reasoning", "chain_of_thought"):
                        parsed.pop(noise_key, None)
                    # If the parsed dict doesn't have expected keys, look for a nested object
                    expected_keys = {"what_taught", "student_problems", "teacher_solutions"}
                    if not (expected_keys & set(parsed.keys())):
                        # Check if the analysis is nested under a wrapper key
                        for v in parsed.values():
                            if isinstance(v, dict) and (expected_keys & set(v.keys())):
                                parsed = v
                                break
            return {
                "success": True,
                "model": model_name,
                "raw": raw_text,
                "cleaned": cleaned,
                "parsed": parsed
            }
        else:
            return {"success": False, "model": model_name, "error": f"HTTP {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"success": False, "model": model_name, "error": str(e)}



def string_similarity(a: str, b: str) -> float:
    """Calculate string sequence similarity ratio (0.0 to 1.0)."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Calculate cosine similarity between two vectors. Returns 0.0 to 1.0."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def get_embeddings(texts: list[str]) -> list[list[float]] | None:
    """
    Batch-embed a list of texts using the Ollama embedding API.
    Returns list of embedding vectors, or None if the call fails.
    Falls back gracefully so the pipeline never breaks.
    """
    if not texts:
        return None
    try:
        resp = requests.post(
            OLLAMA_EMBED_URL,
            json={"model": OLLAMA_EMBED_MODEL, "input": texts},
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            embeddings = data.get("embeddings", [])
            if len(embeddings) == len(texts):
                return embeddings
            print(f"[Embeddings] Warning: Expected {len(texts)} embeddings, got {len(embeddings)}")
            return None
        else:
            print(f"[Embeddings] API error {resp.status_code}: {resp.text[:100]}")
            return None
    except Exception as e:
        print(f"[Embeddings] Fallback to string matching — {e}")
        return None


def calculate_consensus_rate(drafts: dict[str, dict]) -> dict:
    """
    Compare structured outputs from the 3 models and calculate 2/3 consensus.
    Returns categorized items (Unanimous 3/3, Majority 2/3, Single-Model 1/3).
    """
    models = list(drafts.keys())
    consensus_summary = {
        "models_participating": models,
        "what_taught": [],
        "student_problems": [],
        "teacher_solutions": [],
        "action_items_teacher": [],
        "action_items_student": []
    }

    # Helper to match items across models using semantic embeddings
    def cluster_items(category_extractor):
        all_items = []
        for m_name, d_dict in drafts.items():
            if not d_dict:
                continue
            items = category_extractor(d_dict)
            for it in items:
                text = str(it) if not isinstance(it, str) else it
                all_items.append({"model": m_name, "data": it, "text": text})

        if not all_items:
            return []

        # Try embedding-based similarity first
        texts = [item["text"] for item in all_items]
        embeddings = get_embeddings(texts)
        use_embeddings = embeddings is not None and len(embeddings) == len(texts)

        if use_embeddings:
            sim_threshold = 0.65
        else:
            sim_threshold = 0.45

        clusters = []
        cluster_embeddings = []  # parallel list: embedding of cluster representative

        for idx, candidate in enumerate(all_items):
            matched_cluster = None
            best_sim = 0.0

            for cl_idx, cl in enumerate(clusters):
                if use_embeddings:
                    sim = cosine_similarity(embeddings[idx], cluster_embeddings[cl_idx])
                else:
                    sim = string_similarity(candidate["text"], cl["representative"]["text"])

                if sim >= sim_threshold and sim > best_sim:
                    best_sim = sim
                    matched_cluster = cl

            if matched_cluster:
                matched_cluster["votes"].append(candidate["model"])
                matched_cluster["variants"].append(candidate)
            else:
                clusters.append({
                    "representative": candidate,
                    "votes": [candidate["model"]],
                    "variants": [candidate]
                })
                cluster_embeddings.append(embeddings[idx] if use_embeddings else None)

        categorized = []
        for cl in clusters:
            unique_votes = list(set(cl["votes"]))
            vote_count = len(unique_votes)
            rate_label = "3/3 Unanimous" if vote_count >= 3 else ("2/3 Majority" if vote_count == 2 else "1/3 Single Model")
            status = "APPROVED_CONSENSUS" if vote_count >= 2 else "SUPPLEMENTARY"
            categorized.append({
                "status": status,
                "vote_count": vote_count,
                "consensus_rate": f"{vote_count}/{len(models)} ({rate_label})",
                "supporting_models": unique_votes,
                "item": cl["representative"]["data"]
            })
        return categorized

    # Log matching mode
    test_embed = get_embeddings(["test"])
    if test_embed:
        print("[Local Consensus]   Using EMBEDDING-based semantic consensus (nomic-embed-text)")
    else:
        print("[Local Consensus]   Using STRING-based consensus (fallback — install nomic-embed-text for better matching)")

    # 1. What was taught (handle both old and new schema field names)
    consensus_summary["what_taught"] = cluster_items(
        lambda d: [f"[{i.get('category', 'General')}] {i.get('topic', '')}: {i.get('key_rule', '') or i.get('details', '')}" for i in d.get("what_taught", [])]
    )

    # 2. Student problems (handle both schemas)
    def _extract_problems(d):
        # New schema: student_problems_and_solutions
        items = d.get("student_problems_and_solutions", d.get("student_problems", []))
        return [
            f"[{i.get('severity', i.get('error_type', 'General'))}] {i.get('issue_summary', '') or i.get('description', '')}: {i.get('student_error', '') or i.get('student_utterance', '')}"
            for i in items
        ]
    consensus_summary["student_problems"] = cluster_items(_extract_problems)

    # 3. Teacher solutions (handle both schemas)
    def _extract_solutions(d):
        # New schema embeds solutions in student_problems_and_solutions
        combined = d.get("student_problems_and_solutions", [])
        if combined:
            return [f"[Fix] {i.get('teacher_fix', '')}" for i in combined if i.get("teacher_fix")]
        # Old schema: separate teacher_solutions
        return [f"[{i.get('method', 'Direct')}] {i.get('explanation', '')} | Drill: {i.get('drill_guidance', '')}" for i in d.get("teacher_solutions", [])]
    consensus_summary["teacher_solutions"] = cluster_items(_extract_solutions)

    # 4. Action items (handle both schemas)
    def _extract_teacher_actions(d):
        # New schema: next_lesson_briefing.teacher_followup_focus
        nlb = d.get("next_lesson_briefing", {})
        if isinstance(nlb, dict) and nlb.get("teacher_followup_focus"):
            return [str(x) for x in nlb["teacher_followup_focus"]]
        ai = d.get("action_items", {})
        return [str(x) for x in ai.get("for_teacher", [])] if isinstance(ai, dict) else []
    consensus_summary["action_items_teacher"] = cluster_items(_extract_teacher_actions)

    def _extract_student_actions(d):
        # New schema: next_lesson_briefing.student_homework_checklist
        nlb = d.get("next_lesson_briefing", {})
        if isinstance(nlb, dict) and nlb.get("student_homework_checklist"):
            return [str(x) for x in nlb["student_homework_checklist"]]
        ai = d.get("action_items", {})
        return [str(x) for x in ai.get("for_student", [])] if isinstance(ai, dict) else []
    consensus_summary["action_items_student"] = cluster_items(_extract_student_actions)

    return consensus_summary


def run_roundtable_arbitration(
    transcript: str,
    drafts: dict[str, dict],
    consensus_metrics: dict,
    judge_model: str | None = None
) -> dict:
    """
    Stage 3: Run Roundtable Judge debate to synthesize the final master note.
    The judge reconciles 2/3 majority agreements and resolves single-model edge cases.
    """
    judge_model = judge_model or DEFAULT_LOCAL_MODELS.get("qwen", "qwen3:14b")
    drafts_json = {m: d for m, d in drafts.items() if d is not None}

    # Provide a reasonable portion of the transcript to the judge (up to ~48K chars)
    # This fits within 32K context alongside the drafts and consensus metrics
    max_transcript_chars = 48000
    transcript_for_judge = transcript[:max_transcript_chars]
    if len(transcript) > max_transcript_chars:
        transcript_for_judge += f"\n\n[... TRUNCATED — showing first {max_transcript_chars} of {len(transcript)} characters ...]"

    judge_prompt = f"""
You are the Chief Pedagogical Judge presiding over a 3-Model AI Roundtable.
Three local models (Qwen, DeepSeek-R1, and Gemma) have each analyzed a bilingual Vietnamese-English teaching session transcript and produced individual draft notes.

--- ORIGINAL TRANSCRIPT ---
{transcript_for_judge}

--- 3 MODEL DRAFTS ---
{json.dumps(drafts_json, indent=2, ensure_ascii=False)}

--- 2/3 CONSENSUS AUDIT METRICS ---
{json.dumps(consensus_metrics, indent=2, ensure_ascii=False)}

YOUR JUDICIAL MANDATE:
1. Review the 3 drafts and the 2/3 consensus analysis.
2. Accept all findings that achieved a 2/3 or 3/3 majority consensus rate, unless empirically contradicted by the transcript.
3. Critically evaluate 1/3 single-model findings: if true to the transcript, integrate them as high-value insights; if hallucinated or trivial, discard them.
4. Produce the FINAL, definitive Master Teaching Note in STRICT JSON matching this schema:
```json
{json.dumps(ANALYSIS_JSON_SCHEMA, indent=2)}
```
"""

    print(f"[Local Consensus] Running Roundtable Judge arbitration using {judge_model}...")
    judge_result = query_ollama(judge_model, judge_prompt, temperature=0.1, max_tokens=8192, timeout=300, force_json=True)
    return judge_result


def run_local_consensus_pipeline(
    transcript_text: str,
    models: dict[str, str] | None = None,
    judge_model: str | None = None
) -> dict:
    """
    Full Pipeline B runner:
    1. Query 3 local LLMs in parallel.
    2. Compute 2/3 consensus statistics.
    3. Run Roundtable Judge synthesis.
    4. Format consolidated Markdown report with full audit log.
    """
    target_models = models or DEFAULT_LOCAL_MODELS
    judge_mdl = judge_model or target_models.get("qwen", "qwen3:14b")

    start_time = time.time()

    # Step 0: Chunk the transcript into ~10-minute segments
    chunks = chunk_transcript(transcript_text, chunk_minutes=10, overlap_lines=2)
    print(f"[Local Consensus] Step 0: Split transcript into {len(chunks)} chunks: {[c['time_range'] for c in chunks]}")

    # Step 1: For each model, analyze each chunk sequentially, then merge
    print(f"[Local Consensus] Step 1: Querying 3 local models sequentially (16GB VRAM — one model at a time): {list(target_models.values())}...")
    print(f"[Local Consensus]   Each model will analyze {len(chunks)} chunks and merge results.")
    drafts_raw = {}
    drafts_parsed = {}

    schema_json = json.dumps(ANALYSIS_JSON_SCHEMA, indent=2)

    for tag, model_name in target_models.items():
        print(f"[Local Consensus]   → Running model '{tag}' ({model_name}) across {len(chunks)} chunks...")
        chunk_results = []

        for chunk in chunks:
            chunk_prompt = f"""{PEDAGOGICAL_PROMPT_REQUIREMENTS}

You are analyzing SEGMENT {chunk['chunk_id']} of {len(chunks)} from a bilingual teaching session.
Time range: {chunk['time_range']}
This is part of a longer lesson — focus on what happens in THIS segment only.
Extract all teaching points, student errors, corrections, and interactions found in this segment.

Input Teaching Session Transcript Segment (Bilingual Vietnamese & English):
---
{chunk['text']}
---

Please analyze this segment thoroughly and return STRICT JSON matching this schema:
```json
{schema_json}
```
"""
            try:
                res = query_ollama(model_name, chunk_prompt, 0.2, 8192, 300)
                chunk_parsed = res.get("parsed")
                # Validate that parsed result has actual schema content (not empty {})
                has_content = (
                    isinstance(chunk_parsed, dict)
                    and any(k in chunk_parsed for k in ("what_taught", "student_problems", "teacher_solutions"))
                )
                status = "✅" if has_content else "❌"
                print(f"[Local Consensus]     Chunk {chunk['chunk_id']}/{len(chunks)} ({chunk['time_range']}): {status}")
                if not has_content and res.get("raw"):
                    raw_preview = res["raw"][:150].replace("\n", " ")
                    print(f"[Local Consensus]     ⚠ Parse failed or empty. Preview: {raw_preview}...")
                chunk_results.append(chunk_parsed if has_content else None)
            except Exception as e:
                print(f"[Local Consensus]     ❌ Chunk {chunk['chunk_id']} exception: {e}")
                chunk_results.append(None)

        # Merge chunk results into a single draft for this model
        merged_draft = merge_chunk_drafts(chunk_results)
        success = merged_draft is not None
        successful_chunks = sum(1 for r in chunk_results if r is not None)
        print(f"[Local Consensus]   {'✅' if success else '❌'} Model '{tag}' completed ({successful_chunks}/{len(chunks)} chunks merged).")

        drafts_raw[tag] = {"success": success, "model": model_name}
        drafts_parsed[tag] = merged_draft

    # Step 2: Compute Consensus
    print("[Local Consensus] Step 2: Calculating 2/3 consensus across drafts...")
    consensus_metrics = calculate_consensus_rate(drafts_parsed)

    # Step 3: Roundtable Judge
    print("[Local Consensus] Step 3: Conducting Roundtable Debate...")
    roundtable_res = run_roundtable_arbitration(transcript_text, drafts_parsed, consensus_metrics, judge_model=judge_mdl)

    final_parsed = roundtable_res.get("parsed")
    if not final_parsed:
        # Fallback to the best individual draft if judge parse failed
        for tag in ["qwen", "deepseek", "gemma"]:
            if drafts_parsed.get(tag):
                final_parsed = drafts_parsed[tag]
                break

    elapsed = round(time.time() - start_time, 2)

    # Step 4: Build Markdown Report with Consensus Appendix
    md_content = []
    if final_parsed:
        master_report = format_markdown_report(
            final_parsed,
            source_label=f"3-Model Local Consensus (Qwen, DeepSeek-R1, Gemma with 2/3 Majority Gate)"
        )
        md_content.append(master_report)
    else:
        md_content.append("# ⚠️ 3-Model Local Consensus Pipeline: Generation Failed\n")

    md_content.append("\n\n---\n# 🏛️ Roundtable & Consensus Audit Log\n")
    md_content.append(f"- **Participating Models**: `{', '.join(target_models.values())}`")
    md_content.append(f"- **Presiding Judge**: `{judge_mdl}`")
    md_content.append(f"- **Transcript Chunks**: `{len(chunks)}` segments — {', '.join(c['time_range'] for c in chunks)}")
    md_content.append(f"- **Total Processing Latency**: `{elapsed} seconds`\n")

    md_content.append("### 📊 2/3 Consensus Audit Breakdown\n")

    for section_name in ["what_taught", "student_problems", "teacher_solutions", "action_items_teacher", "action_items_student"]:
        items = consensus_metrics.get(section_name, [])
        formatted_title = section_name.replace('_', ' ').title()
        md_content.append(f"#### {formatted_title}:")
        if items:
            for it in items:
                status_icon = "✅" if it["status"] == "APPROVED_CONSENSUS" else "🔍"
                models_str = ", ".join(it["supporting_models"])
                md_content.append(f"- {status_icon} **[{it['consensus_rate']}]** (Supported by: `{models_str}`)")
                md_content.append(f"  - *{it['item']}*")
        else:
            md_content.append("- *No items recorded.*")
        md_content.append("")

    full_markdown = "\n".join(md_content)

    # Step 5: Generate visual Mermaid diagrams (mindmap + flowchart)
    mermaid_diagrams = generate_mermaid_fallback(final_parsed) if final_parsed else {"mindmap": "", "flowchart": ""}

    return {
        "success": bool(final_parsed),
        "elapsed_seconds": elapsed,
        "final_data": final_parsed,
        "drafts_parsed": drafts_parsed,
        "consensus_metrics": consensus_metrics,
        "markdown": full_markdown,
        "mermaid_mindmap": mermaid_diagrams.get("mindmap", ""),
        "mermaid_flowchart": mermaid_diagrams.get("flowchart", "")
    }
